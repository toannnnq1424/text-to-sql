package dev.nla;

import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.WarehouseAdapter;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.MDC;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Persisted DB-to-DB jobs with independent transformations and isolated import writers. */
@Service
public final class TransformationPipelineService {
  private static final List<String> LAYERS = List.of("RAW", "STAGING", "WAREHOUSE", "MART");
  private static final Set<String> FIELDS =
      Set.of(
          "pipelineId",
          "name",
          "sourceWarehouseId",
          "sourceDatasetId",
          "sourceTable",
          "targetWarehouseId",
          "targetSchema",
          "targetTable",
          "datasetName",
          "stages",
          "maxRows",
          "maxBytes",
          "timeoutSeconds",
          "status");
  private final Store store;
  private final Adapters adapters;
  private final CatalogService catalog;
  private final FileIngestionService files;
  private final SqlGuard guard;
  private final AiClient ai;
  private final ThreadPoolExecutor workers =
      new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));

  TransformationPipelineService(
      Store store,
      Adapters adapters,
      CatalogService catalog,
      FileIngestionService files,
      SqlGuard guard,
      AiClient ai) {
    this.store = store;
    this.adapters = adapters;
    this.catalog = catalog;
    this.files = files;
    this.guard = guard;
    this.ai = ai;
  }

  @PreDestroy
  public void stop() {
    workers.shutdownNow();
  }

  @EventListener(ApplicationReadyEvent.class)
  public void recover() {
    // A new process never blindly retries DDL: the last commit outcome may be unknown.
    var interrupted =
        store
            .jdbc()
            .query(
                "SELECT document::text FROM operation_run WHERE kind='TRANSFORM' AND"
                    + " document->>'status'='RUNNING'",
                (row, index) -> Json.read(row.getString(1)));
    for (var run : interrupted) {
      run.put("status", "FAILED");
      run.put("partialFailure", true);
      run.put("completedAt", Instant.now().toString());
      run.put(
          "error",
          Errors.body(
              "PIPELINE_INTERRUPTED",
              "Tiến trình đã dừng trong khi chạy. Kiểm tra bảng đích trước khi thử lại; kết quả"
                  + " commit có thể chưa xác định.",
              Json.obj("outcomeUnknown", true)));
      for (var stage : Json.objects(run.get("stages"))) {
        if (Set.of("RUNNING", "PENDING").contains(Json.str(stage, "status"))) {
          stage.put("status", "FAILED");
        }
      }
      persist(run);
    }
  }

  public Map<String, Object> get(String id) {
    var documents =
        store
            .jdbc()
            .query(
                "SELECT document::text FROM transformation_pipeline WHERE id=?",
                (row, index) -> Json.read(row.getString(1)),
                id);
    if (documents.isEmpty()) {
      throw ApiException.notFound();
    }
    var definition = documents.getFirst();
    authorize(definition);
    return definition;
  }

  public Object list(Map<String, String> parameters) {
    var definitions =
        store
            .jdbc()
            .query(
                "SELECT document::text FROM transformation_pipeline ORDER BY updated_at DESC,id",
                (row, index) -> Json.read(row.getString(1)))
            .stream()
            .filter(this::visible)
            .toList();
    return Page.of(definitions, parameters, "name", Set.of("name", "status", "pipelineId"));
  }

  public Object runs(Map<String, String> parameters) {
    return Page.of(
        store.runs("TRANSFORM"),
        parameters,
        "startedAt",
        Set.of("startedAt", "status", "pipelineId"));
  }

  public Map<String, Object> status(String id) {
    return store.run(id, "TRANSFORM");
  }

  private boolean visible(Map<String, Object> definition) {
    try {
      authorize(definition);
      return true;
    } catch (ApiException denied) {
      return false;
    }
  }

  private void authorize(Map<String, Object> definition) {
    store.authorize(Json.str(definition, "sourceWarehouseId"));
    store.authorize(Json.str(definition, "targetWarehouseId"));
  }

  static int integer(Map<String, Object> definition, String key, int fallback, int maximum) {
    Object value = definition.getOrDefault(key, fallback);
    if (!(value instanceof Number number)
        || number.doubleValue() != number.intValue()
        || number.intValue() < 1
        || number.intValue() > maximum) {
      throw ApiException.bad("Giới hạn " + key + " không hợp lệ.");
    }
    return number.intValue();
  }

  static Map<String, Object> definition(Map<String, Object> request) {
    if (Json.write(request).getBytes(StandardCharsets.UTF_8).length > 262144) {
      throw ApiException.bad("Cấu hình pipeline vượt 256 KiB.");
    }
    RegistryController.fields(request, FIELDS);
    RegistryController.required(
        request,
        "name",
        "sourceWarehouseId",
        "sourceDatasetId",
        "targetWarehouseId",
        "targetSchema",
        "targetTable",
        "datasetName");
    var out = Json.read(Json.write(request));
    for (String field :
        List.of(
            "name",
            "datasetName",
            "sourceWarehouseId",
            "sourceDatasetId",
            "targetWarehouseId",
            "targetSchema",
            "targetTable")) {
      if (!(out.get(field) instanceof String)) {
        throw ApiException.bad("Trường " + field + " phải là chuỗi.");
      }
    }
    for (String field : List.of("name", "datasetName")) {
      if (Json.str(out, field).length() > 200
          || Json.str(out, field).chars().anyMatch(Character::isISOControl)) {
        throw ApiException.bad("Tên pipeline/dataset không hợp lệ.");
      }
    }
    FileIngestionService.identifier(Json.str(out, "targetSchema"), 63);
    FileIngestionService.identifier(Json.str(out, "targetTable"), 45);
    if (!Set.of("ACTIVE", "DISABLED")
        .contains(Objects.toString(out.getOrDefault("status", "ACTIVE")))) {
      throw ApiException.bad("Trạng thái pipeline không hợp lệ.");
    }
    if (!(out.get("sourceTable") instanceof Map<?, ?> source)
        || !source.keySet().equals(Set.of("schema", "name"))
        || Json.str(Json.map(source), "schema").isBlank()
        || Json.str(Json.map(source), "name").isBlank()) {
      throw ApiException.bad("Chọn một bảng nguồn thuộc dataset.");
    }
    var transforms = Json.map(out.get("stages"));
    if (!transforms.keySet().equals(Set.of("staging", "warehouse", "mart"))) {
      throw ApiException.bad("Cần cấu hình đủ staging, warehouse và mart.");
    }
    for (String layer : List.of("staging", "warehouse", "mart")) {
      if (!(transforms.get(layer) instanceof Map<?, ?>)) {
        throw ApiException.bad("Cấu hình lớp không hợp lệ.");
      }
      var transform = Json.map(transforms.get(layer));
      RegistryController.fields(transform, Set.of("columns", "filter", "groupBy"));
      if (!(transform.get("columns") instanceof List<?> columns)
          || columns.isEmpty()
          || columns.size() > 200
          || columns.stream().anyMatch(column -> !(column instanceof Map<?, ?>))) {
        throw ApiException.bad("Mỗi lớp cần từ 1 đến 200 cột đầu ra.");
      }
      if (transform.get("filter") != null
          && (!(transform.get("filter") instanceof String filter) || filter.length() > 10000)) {
        throw ApiException.bad("Bộ lọc quá dài hoặc không hợp lệ.");
      }
      if (transform.get("groupBy") != null
          && (!(transform.get("groupBy") instanceof List<?> groups)
              || groups.size() > 20
              || groups.stream()
                  .anyMatch(group -> !(group instanceof String text) || text.length() > 10000))) {
        throw ApiException.bad("Nhóm tổng hợp không hợp lệ.");
      }
      transform.putIfAbsent("filter", "");
      transform.putIfAbsent("groupBy", List.of());
      for (var column : Json.objects(transform.get("columns"))) {
        RegistryController.fields(column, Set.of("name", "expression"));
        RegistryController.required(column, "name", "expression");
        if (!(column.get("name") instanceof String)
            || !(column.get("expression") instanceof String)) {
          throw ApiException.bad("Tên và biểu thức cột phải là chuỗi.");
        }
        FileIngestionService.identifier(Json.str(column, "name"), 63);
        if (Json.str(column, "expression").length() > 10000) {
          throw ApiException.bad("Biểu thức vượt giới hạn.");
        }
      }
    }
    out.put("maxRows", integer(out, "maxRows", 1000, 10000));
    out.put("maxBytes", integer(out, "maxBytes", 5242880, 52428800));
    out.put("timeoutSeconds", integer(out, "timeoutSeconds", 20, 60));
    out.putIfAbsent("status", "ACTIVE");
    return out;
  }

  public synchronized Map<String, Object> save(String id, Map<String, Object> request) {
    Map<String, Object> submitted = request;
    if (id != null) {
      submitted = new LinkedHashMap<>(get(id));
      submitted.putAll(request);
      if (request.keySet().equals(Set.of("status"))) {
        var changed = definition(submitted);
        write(id, changed, false);
        store.audit("PIPELINE_UPDATE", id);
        return changed;
      }
    }
    var prepared = definition(submitted);
    if (prepared.containsKey("pipelineId") && !Objects.equals(prepared.get("pipelineId"), id)) {
      throw ApiException.bad("Pipeline ID không khớp.");
    }
    previewPrepared(prepared);
    boolean create = id == null;
    if (create) {
      id = Json.id("pipe");
    }
    prepared.put("pipelineId", id);
    write(id, prepared, create);
    store.audit("PIPELINE_SAVE", id);
    return prepared;
  }

  private void write(String id, Map<String, Object> prepared, boolean create) {
    if (create) {
      store
          .jdbc()
          .update(
              "INSERT INTO"
                  + " transformation_pipeline(id,source_warehouse_id,target_warehouse_id,document)"
                  + " VALUES (?,?,?,?::jsonb)",
              id,
              prepared.get("sourceWarehouseId"),
              prepared.get("targetWarehouseId"),
              Json.write(prepared));
    } else {
      store
          .jdbc()
          .update(
              "UPDATE transformation_pipeline SET"
                  + " source_warehouse_id=?,target_warehouse_id=?,document=?::jsonb,updated_at=now()"
                  + " WHERE id=?",
              prepared.get("sourceWarehouseId"),
              prepared.get("targetWarehouseId"),
              Json.write(prepared),
              id);
    }
  }

  private Map<String, Object> source(Map<String, Object> definition) {
    var dataset = store.dataset(Json.str(definition, "sourceDatasetId"));
    if (!Objects.equals(dataset.get("warehouseId"), definition.get("sourceWarehouseId"))
        || !"ACTIVE".equals(dataset.get("status"))) {
      throw ApiException.bad("Dataset nguồn chưa hoạt động hoặc không thuộc warehouse nguồn.");
    }
    var requested = Json.map(definition.get("sourceTable"));
    return catalog.tables(Json.str(definition, "sourceDatasetId")).stream()
        .filter(
            table ->
                Objects.equals(table.get("schema"), requested.get("schema"))
                    && Objects.equals(table.get("name"), requested.get("name")))
        .findFirst()
        .orElseThrow(() -> ApiException.bad("Bảng nguồn không nằm trong allowlist của dataset."));
  }

  private Map<String, Object> target(Map<String, Object> definition) {
    var warehouse = store.warehouse(Json.str(definition, "targetWarehouseId"));
    if (!"ACTIVE".equals(warehouse.get("status"))) {
      throw ApiException.bad("Warehouse đích chưa hoạt động.");
    }
    var namespaces =
        (List<?>) files.targets(Json.str(definition, "targetWarehouseId")).get("namespaces");
    if (!namespaces.contains(definition.get("targetSchema"))) {
      throw ApiException.bad("Namespace đích chưa được cấp quyền CREATE cho tài khoản import.");
    }
    return warehouse;
  }

  private Map<String, Object> writer(
      Map<String, Object> definition, Map<String, Object> warehouse) {
    var writer = new LinkedHashMap<>(warehouse);
    writer.put("username", store.importUsername(Json.str(definition, "targetWarehouseId")));
    if ("MYSQL".equals(warehouse.get("engine"))) {
      writer.put("database", definition.get("targetSchema"));
    }
    return writer;
  }

  private List<Map<String, Object>> targets(Map<String, Object> definition) {
    return LAYERS.stream()
        .map(
            layer ->
                Json.obj(
                    "stage",
                    layer,
                    "schema",
                    definition.get("targetSchema"),
                    "name",
                    Json.str(definition, "targetTable") + "_" + layer.toLowerCase(Locale.ROOT)))
        .toList();
  }

  private void checkTargets(
      Connection connection, WarehouseAdapter adapter, Map<String, Object> definition)
      throws Exception {
    var tables = adapter.discoverTables(connection, Set.of(Json.str(definition, "targetSchema")));
    for (var target : targets(definition)) {
      if (tables.stream()
          .anyMatch(table -> Json.str(table, "name").equalsIgnoreCase(Json.str(target, "name")))) {
        throw new ApiException(
            HttpStatus.CONFLICT,
            "PIPELINE_TARGET_CONFLICT",
            "Bảng đích đã tồn tại; chọn tên đích khác. Pipeline không ghi đè dữ liệu.");
      }
    }
  }

  private Map<String, Object> readSource(Map<String, Object> definition, Map<String, Object> table)
      throws Exception {
    var warehouse = store.warehouse(Json.str(definition, "sourceWarehouseId"));
    if (!"ACTIVE".equals(warehouse.get("status"))) {
      throw ApiException.bad("Warehouse nguồn chưa hoạt động.");
    }
    var adapter = adapters.get(warehouse);
    var sourceColumns = TransformationData.columns(table.get("columns"));
    String sql =
        "SELECT "
            + sourceColumns.stream()
                .map(column -> adapter.quoteIdentifier(Json.str(column, "name")))
                .collect(java.util.stream.Collectors.joining(","))
            + " FROM "
            + TransformationData.qualified(
                adapter, Json.str(table, "schema"), Json.str(table, "name"));
    guard.validate(sql, adapter.engine(), List.of(table));
    var result =
        adapter.executeReadOnlyQuery(
            warehouse,
            adapters.password(store.credential(Json.str(definition, "sourceWarehouseId"))),
            sql,
            ((Number) definition.get("maxRows")).intValue(),
            ((Number) definition.get("maxBytes")).intValue(),
            ((Number) definition.get("timeoutSeconds")).intValue());
    if (!Boolean.FALSE.equals(result.get("truncated"))) {
      throw ApiException.bad(
          "Nguồn vượt giới hạn dòng/dung lượng. Tăng giới hạn phù hợp; pipeline không nạp dữ liệu"
              + " bị cắt.");
    }
    var columns = TransformationData.columns(result.get("columns"));
    var rows = Json.objects(result.get("rows"));
    for (var row : rows) {
      for (var column : columns) {
        FileTypes.convert(row.get(column.get("name")), column);
      }
    }
    return Json.obj("columns", columns, "rows", rows, "rowCount", rows.size(), "sql", sql);
  }

  private String compile(
      Map<String, Object> definition,
      Map<String, Object> input,
      String layer,
      WarehouseAdapter adapter) {
    return compile(
        definition, input, layer, adapter, ((Number) definition.get("timeoutSeconds")).intValue());
  }

  private String compile(
      Map<String, Object> definition,
      Map<String, Object> input,
      String layer,
      WarehouseAdapter adapter,
      int timeout) {
    var transform =
        Json.map(Json.map(definition.get("stages")).get(layer.toLowerCase(Locale.ROOT)));
    var compiled =
        ai.invoke(
            "transform-plan",
            Json.obj(
                "correlationId",
                Errors.correlation(),
                "sqlDialect",
                adapter.engine(),
                "columns",
                input.get("columns"),
                "transform",
                transform),
            Math.min(30, timeout));
    var expected =
        Json.objects(transform.get("columns")).stream().map(column -> column.get("name")).toList();
    if (!compiled.keySet().equals(Set.of("sql", "names"))
        || !expected.equals(compiled.get("names"))) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          "PIPELINE_VALIDATION_ERROR",
          "Compiler trả về cấu trúc không khớp cấu hình.");
    }
    String sql = Json.str(compiled, "sql");
    guard.validate(
        sql,
        adapter.engine(),
        List.of(Json.obj("schema", "nla", "name", "__nla_input", "columns", input.get("columns"))));
    return sql;
  }

  public Map<String, Object> preview(Map<String, Object> request) {
    return previewPrepared(definition(request));
  }

  private Map<String, Object> previewPrepared(Map<String, Object> definition) {
    try {
      authorize(definition);
      var source = readSource(definition, source(definition));
      var warehouse = target(definition);
      var writer = writer(definition, warehouse);
      var adapter = adapters.get(writer);
      int timeout = ((Number) definition.get("timeoutSeconds")).intValue();
      int maxBytes = ((Number) definition.get("maxBytes")).intValue();
      int sourceCount = Json.objects(source.get("rows")).size();
      int sampleSize = Math.min(20, 1900 / Json.objects(source.get("columns")).size());
      var input =
          Json.obj(
              "columns",
              source.get("columns"),
              "rows",
              Json.objects(source.get("rows")).stream().limit(sampleSize).toList(),
              "rowCount",
              Math.min(sourceCount, sampleSize));
      List<Map<String, Object>> previews = new ArrayList<>();
      previews.add(
          Json.obj(
              "name",
              "RAW",
              "columns",
              input.get("columns"),
              "rows",
              input.get("rows"),
              "rowCount",
              input.get("rowCount"),
              "sql",
              source.get("sql")));
      try (var connection =
          adapter.connectForWrite(
              writer,
              adapters.password(
                  store.importCredential(Json.str(definition, "targetWarehouseId"))))) {
        checkTargets(connection, adapter, definition);
        connection.setAutoCommit(false);
        try {
          for (String layer : LAYERS.subList(1, 4)) {
            String sql = compile(definition, input, layer, adapter);
            input = TransformationData.preview(connection, adapter, sql, input, timeout, maxBytes);
            previews.add(
                Json.obj(
                    "name",
                    layer,
                    "columns",
                    input.get("columns"),
                    "rows",
                    input.get("rows"),
                    "rowCount",
                    input.get("rowCount"),
                    "sql",
                    sql));
          }
        } finally {
          connection.rollback();
        }
      }
      return Json.obj(
          "valid",
          true,
          "sourceColumns",
          source.get("columns"),
          "stages",
          previews,
          "targetTables",
          targets(definition),
          "warnings",
          List.of(
              "Xem trước chuyển đổi trên "
                  + Math.min(sourceCount, sampleSize)
                  + "/"
                  + sourceCount
                  + " dòng nguồn. Số dòng và tổng hợp trong bản xem trước là mẫu; khi chạy pipeline"
                  + " sẽ xử lý toàn bộ nguồn trong giới hạn đã chọn."));
    } catch (ApiException failure) {
      throw failure;
    } catch (Exception failure) {
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "PIPELINE_VALIDATION_ERROR",
          "Không thể kiểm tra pipeline. Kiểm tra biểu thức, kiểu cột, nhóm tổng hợp, quyền đọc/ghi"
              + " và giới hạn dữ liệu.");
    }
  }

  private TransactionTemplate transaction() {
    return new TransactionTemplate(
        new DataSourceTransactionManager(Objects.requireNonNull(store.jdbc().getDataSource())));
  }

  private Map<String, Object> retry(String pipelineId, String key, String signature) {
    var requests =
        store
            .jdbc()
            .query(
                "SELECT signature,run_id FROM transformation_request WHERE actor=? AND"
                    + " pipeline_id=? AND request_key=?",
                (row, index) -> Map.of("signature", row.getString(1), "runId", row.getString(2)),
                store.actor(),
                pipelineId,
                key);
    if (requests.isEmpty()) {
      return null;
    }
    if (!signature.equals(requests.getFirst().get("signature"))) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "PIPELINE_IDEMPOTENCY_CONFLICT",
          "Key đã dùng với cấu hình pipeline khác; không tự chạy lại.");
    }
    return status(requests.getFirst().get("runId"));
  }

  private String revision(Map<String, Object> definition) {
    String source = Json.str(definition, "sourceWarehouseId");
    String target = Json.str(definition, "targetWarehouseId");
    return FileTypes.hash(
        Json.write(store.warehouse(source))
            + Json.write(store.warehouse(target))
            + store.credential(source)
            + store.importUsername(target)
            + store.importCredential(target));
  }

  public synchronized Map<String, Object> run(String id, String key) {
    if (!key.matches("[A-Za-z0-9_-]{1,100}")) {
      throw ApiException.bad("Idempotency key không hợp lệ.");
    }
    var definition = get(id);
    String signature = FileTypes.hash(Json.write(definition));
    var previous = retry(id, key, signature);
    if (previous != null) {
      return previous;
    }
    if (!"ACTIVE".equals(definition.get("status"))) {
      throw ApiException.bad("Pipeline đã bị vô hiệu hóa.");
    }
    source(definition);
    target(definition);
    if (workers.getQueue().remainingCapacity() == 0) {
      throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS, "PIPELINE_BUSY", "Hàng đợi pipeline đang đầy.");
    }
    String runId = Json.id("transform-run");
    var run =
        Json.obj(
            "runId",
            runId,
            "pipelineId",
            id,
            "status",
            "RUNNING",
            "datasetId",
            null,
            "warehouseId",
            definition.get("targetWarehouseId"),
            "sourceWarehouseId",
            definition.get("sourceWarehouseId"),
            "startedAt",
            Instant.now().toString(),
            "completedAt",
            null,
            "stages",
            LAYERS.stream()
                .map(layer -> Json.obj("name", layer, "status", "PENDING", "rowsWritten", 0))
                .toList(),
            "createdTables",
            new ArrayList<>(),
            "error",
            null,
            "partialFailure",
            false);
    String revision = revision(definition);
    String metadataFingerprint = FileTypes.hash(Json.write(source(definition)));
    String actor = store.actor();
    try {
      transaction()
          .executeWithoutResult(
              transaction -> {
                persist(run);
                store
                    .jdbc()
                    .update(
                        "INSERT INTO"
                            + " transformation_request(actor,pipeline_id,request_key,signature,run_id)"
                            + " VALUES (?,?,?,?,?)",
                        actor,
                        id,
                        key,
                        signature,
                        runId);
                for (var target : targets(definition)) {
                  store
                      .jdbc()
                      .update(
                          "INSERT INTO"
                              + " transformation_target_claim(warehouse_id,target_schema,target_table,run_id)"
                              + " VALUES (?,?,?,?)",
                          definition.get("targetWarehouseId"),
                          Json.str(target, "schema").toLowerCase(Locale.ROOT),
                          Json.str(target, "name").toLowerCase(Locale.ROOT),
                          runId);
                }
                store.audit("PIPELINE_START", runId);
              });
    } catch (DuplicateKeyException conflict) {
      previous = retry(id, key, signature);
      if (previous != null) {
        return previous;
      }
      throw new ApiException(
          HttpStatus.CONFLICT,
          "PIPELINE_TARGET_CONFLICT",
          "Một pipeline khác đã sử dụng các bảng đích này. Chọn tên đích khác.");
    }
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    String correlation = Errors.correlation();
    workers.execute(
        () -> {
          var context = SecurityContextHolder.createEmptyContext();
          context.setAuthentication(authentication);
          SecurityContextHolder.setContext(context);
          MDC.put("correlationId", correlation);
          try {
            execute(definition, run, revision, metadataFingerprint);
          } finally {
            SecurityContextHolder.clearContext();
            MDC.remove("correlationId");
          }
        });
    return status(runId);
  }

  private void persist(Map<String, Object> run) {
    store.run(Json.str(run, "runId"), "TRANSFORM", run);
  }

  private void check(Map<String, Object> definition, String revision, Instant deadline)
      throws Exception {
    TransformationData.interrupted();
    if (Instant.now().isAfter(deadline)) {
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "PIPELINE_TIMEOUT", "Pipeline vượt thời gian toàn tác vụ.");
    }
    authorize(definition);
    if (!revision.equals(revision(definition))) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "PIPELINE_CONFIGURATION_CHANGED",
          "Kết nối warehouse đã thay đổi trong lúc chạy.");
    }
  }

  private void commit(Connection connection, Map<String, Object> run) throws Exception {
    try {
      connection.commit();
    } catch (Exception failure) {
      // A network failure may arrive after the server committed. Never claim a clean rollback.
      run.put("outcomeUnknown", true);
      run.put("partialFailure", true);
      throw failure;
    }
  }

  private int remainingTimeout(Map<String, Object> definition, Instant deadline) {
    long remaining = Duration.between(Instant.now(), deadline).toSeconds();
    if (remaining < 1) {
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "PIPELINE_TIMEOUT", "Pipeline vượt thời gian toàn tác vụ.");
    }
    return (int) Math.min(((Number) definition.get("timeoutSeconds")).intValue(), remaining);
  }

  private void execute(
      Map<String, Object> definition,
      Map<String, Object> run,
      String revision,
      String metadataFingerprint) {
    boolean mysql = false;
    boolean committed = false;
    boolean commitAttempted = false;
    Instant deadline = Instant.now().plus(Duration.ofMinutes(5));
    try {
      check(definition, revision, deadline);
      var metadata = source(definition);
      if (!metadataFingerprint.equals(FileTypes.hash(Json.write(metadata)))) {
        throw new ApiException(
            HttpStatus.CONFLICT,
            "SCHEMA_MISMATCH",
            "Schema nguồn đã thay đổi trước khi pipeline bắt đầu.");
      }
      var data = readSource(definition, metadata);
      var warehouse = target(definition);
      var writer = writer(definition, warehouse);
      var adapter = adapters.get(writer);
      mysql = adapter.engine().equals("MYSQL");
      var targets = targets(definition);
      var stages = Json.objects(run.get("stages"));
      int maximumRows = ((Number) definition.get("maxRows")).intValue();
      int maximumBytes = ((Number) definition.get("maxBytes")).intValue();
      try (var connection =
          adapter.connectForWrite(
              writer,
              adapters.password(
                  store.importCredential(Json.str(definition, "targetWarehouseId"))))) {
        checkTargets(connection, adapter, definition);
        connection.setAutoCommit(false);
        try {
          for (int index = 0; index < LAYERS.size(); index++) {
            check(definition, revision, deadline);
            var stage = stages.get(index);
            stage.put("status", "RUNNING");
            persist(run);
            int timeout =
                Math.min(
                    ((Number) definition.get("timeoutSeconds")).intValue(),
                    Math.max(1, (int) Duration.between(Instant.now(), deadline).toSeconds()));
            if (index > 0) {
              String sql =
                  compile(
                      definition,
                      data,
                      LAYERS.get(index),
                      adapter,
                      remainingTimeout(definition, deadline));
              var previous = targets.get(index - 1);
              String executable =
                  TransformationData.targetSql(
                      sql, adapter, Json.str(previous, "schema"), Json.str(previous, "name"));
              var allowed =
                  Json.obj(
                      "schema",
                      previous.get("schema"),
                      "name",
                      previous.get("name"),
                      "columns",
                      data.get("columns"));
              guard.validate(executable, adapter.engine(), List.of(allowed));
              try (var statement = connection.createStatement()) {
                check(definition, revision, deadline);
                timeout = remainingTimeout(definition, deadline);
                adapter.configureTimeout(statement, timeout);
                statement.setMaxRows(maximumRows + 1);
                try (var rows =
                    statement.executeQuery(adapter.applySafeLimit(executable, maximumRows + 1))) {
                  data = TransformationData.read(rows, maximumRows, maximumBytes);
                }
              }
            }
            var target = targets.get(index);
            String qualified =
                TransformationData.qualified(
                    adapter, Json.str(target, "schema"), Json.str(target, "name"));
            check(definition, revision, deadline);
            timeout = remainingTimeout(definition, deadline);
            TransformationData.createAndLoad(
                connection,
                adapter,
                qualified,
                data,
                timeout,
                () -> {
                  @SuppressWarnings("unchecked")
                  var created = (List<Map<String, Object>>) run.get("createdTables");
                  created.add(Json.obj("schema", target.get("schema"), "name", target.get("name")));
                  persist(run);
                },
                deadline);
            if (mysql) {
              commit(connection, run);
            }
            stage.put("status", "SUCCESS");
            stage.put("rowsWritten", data.get("rowCount"));
            persist(run);
          }
          check(definition, revision, deadline);
          commitAttempted = true;
          commit(connection, run);
          committed = true;
        } catch (Exception failure) {
          if (commitAttempted) {
            run.put("partialFailure", true);
            run.put("outcomeUnknown", true);
          }
          try {
            connection.rollback();
          } catch (Exception rollbackFailed) {
            run.put("partialFailure", true);
          }
          if (!mysql && !Boolean.TRUE.equals(run.get("partialFailure"))) {
            run.put("createdTables", new ArrayList<>());
            for (var stage : stages) {
              if (Set.of("SUCCESS", "RUNNING").contains(Json.str(stage, "status"))) {
                stage.put("status", "ROLLED_BACK");
                stage.put("rowsWritten", 0);
              }
            }
          }
          throw failure;
        }
      }
      check(definition, revision, deadline);
      var mart = targets.getLast();
      verifyReader(
          definition,
          warehouse,
          adapter,
          mart,
          ((Number) data.get("rowCount")).intValue(),
          deadline);
      catalog.discover(Json.str(definition, "targetWarehouseId"), true);
      var dataset = dataset(definition, run, mart, ((Number) data.get("rowCount")).intValue());
      var semantic =
          Json.obj(
              "tables",
              List.of(),
              "metrics",
              List.of(),
              "dimensions",
              List.of(),
              "relationships",
              List.of(),
              "examples",
              List.of(),
              "businessRules",
              List.of(),
              "timezone",
              "UTC",
              "semanticVersion",
              "1.0.0",
              "schemaVersion",
              "1.0.0");
      transaction()
          .executeWithoutResult(
              transaction -> {
                store.insertDataset(dataset, semantic);
                run.put("datasetId", dataset.get("datasetId"));
                run.put("status", "SUCCESS");
                run.put("completedAt", Instant.now().toString());
                persist(run);
                store.audit(
                    "PIPELINE_SUCCESS",
                    Json.str(run, "runId"),
                    Json.obj("datasetId", dataset.get("datasetId")));
              });
    } catch (Exception failure) {
      Thread.interrupted();
      boolean partial =
          committed
              || mysql && !Json.objects(run.get("createdTables")).isEmpty()
              || Boolean.TRUE.equals(run.get("partialFailure"));
      run.put("partialFailure", partial);
      run.put("status", "FAILED");
      run.put("completedAt", Instant.now().toString());
      for (var stage : Json.objects(run.get("stages"))) {
        if ("RUNNING".equals(stage.get("status"))) {
          stage.put("status", "FAILED");
        }
        if ("PENDING".equals(stage.get("status"))) {
          stage.put("status", "SKIPPED");
        }
      }
      String code = failure instanceof ApiException api ? api.code : "PIPELINE_EXECUTION_ERROR";
      String message =
          failure instanceof ApiException api
              ? api.getMessage()
              : "Pipeline không hoàn tất. Kiểm tra biểu thức, quyền đọc/ghi, precision và trạng"
                  + " thái các bảng đích; không tự chạy lại.";
      run.put(
          "error",
          Errors.body(
              code,
              message,
              Json.obj(
                  "createdTables",
                  run.get("createdTables"),
                  "partialFailure",
                  partial,
                  "outcomeUnknown",
                  Boolean.TRUE.equals(run.get("outcomeUnknown")))));
      persist(run);
      store.audit("PIPELINE_FAILED", Json.str(run, "runId"));
      if (!partial) {
        store
            .jdbc()
            .update("DELETE FROM transformation_target_claim WHERE run_id=?", run.get("runId"));
      }
    }
  }

  private void verifyReader(
      Map<String, Object> definition,
      Map<String, Object> warehouse,
      WarehouseAdapter adapter,
      Map<String, Object> mart,
      int expected,
      Instant deadline)
      throws Exception {
    String sql =
        "SELECT COUNT(*) AS record_count FROM "
            + TransformationData.qualified(
                adapter, Json.str(mart, "schema"), Json.str(mart, "name"));
    var result =
        adapter.executeReadOnlyQuery(
            warehouse,
            adapters.password(store.credential(Json.str(definition, "targetWarehouseId"))),
            sql,
            1,
            4096,
            remainingTimeout(definition, deadline));
    var rows = Json.objects(result.get("rows"));
    if (!Boolean.FALSE.equals(result.get("truncated"))
        || rows.size() != 1
        || Long.parseLong(rows.getFirst().get("record_count").toString()) != expected) {
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "PIPELINE_READER_VERIFICATION_FAILED",
          "Đã ghi bảng nhưng tài khoản đọc chưa xác minh được mart; chưa đăng ký dataset.");
    }
  }

  private Map<String, Object> dataset(
      Map<String, Object> definition, Map<String, Object> run, Map<String, Object> mart, int rows) {
    return Json.obj(
        "datasetId",
        Json.id("ds"),
        "warehouseId",
        definition.get("targetWarehouseId"),
        "name",
        definition.get("datasetName"),
        "description",
        "Mart được pipeline "
            + definition.get("name")
            + " tạo và xác minh bằng tài khoản đọc; "
            + rows
            + " bản ghi.",
        "allowedSchemas",
        List.of(mart.get("schema")),
        "allowedTables",
        List.of(Json.obj("schema", mart.get("schema"), "name", mart.get("name"))),
        "semanticVersion",
        "1.0.0",
        "schemaVersion",
        "1.0.0",
        "status",
        "ACTIVE",
        "updatedAt",
        Instant.now().toString(),
        "provenance",
        Json.obj(
            "kind",
            "TRANSFORMATION_PIPELINE",
            "pipelineId",
            definition.get("pipelineId"),
            "runId",
            run.get("runId"),
            "sourceDatasetId",
            definition.get("sourceDatasetId"),
            "sourceTable",
            definition.get("sourceTable"),
            "definitionSha256",
            FileTypes.hash(Json.write(definition))));
  }
}

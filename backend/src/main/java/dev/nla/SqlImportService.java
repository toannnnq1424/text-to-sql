package dev.nla;

import dev.nla.SqlImportParser.Column;
import dev.nla.SqlImportParser.Kind;
import dev.nla.SqlImportParser.Result;
import dev.nla.SqlImportParser.Step;
import dev.nla.warehouse.Adapters;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class SqlImportService {
  private static final org.slf4j.Logger LOGGER =
      org.slf4j.LoggerFactory.getLogger(SqlImportService.class);
  private static final Set<String> DIALECTS = Set.of("POSTGRESQL", "MYSQL", "SQL_SERVER");
  private final Store store;
  private final Adapters adapters;
  private final java.util.concurrent.ThreadPoolExecutor jobs =
      new java.util.concurrent.ThreadPoolExecutor(
          2,
          2,
          0,
          java.util.concurrent.TimeUnit.SECONDS,
          new java.util.concurrent.ArrayBlockingQueue<>(16),
          task -> {
            Thread worker = new Thread(task, "sql-import-worker");
            worker.setDaemon(true);
            return worker;
          },
          new java.util.concurrent.ThreadPoolExecutor.AbortPolicy());

  @jakarta.annotation.PreDestroy
  void shutdown() {
    jobs.shutdownNow();
  }

  public SqlImportService(Store store, Adapters adapters) {
    this.store = store;
    this.adapters = adapters;
  }

  public Map<String, Object> validate(
      String warehouseId,
      String sourceDialect,
      String targetSchema,
      String filename,
      byte[] content) {
    if (!Set.of("AUTO_DETECT", "POSTGRESQL", "MYSQL", "SQL_SERVER").contains(sourceDialect))
      throw ApiException.bad("Dialect nguồn không hợp lệ.");
    if (content == null || content.length == 0 || content.length > 2 * 1024 * 1024)
      throw ApiException.bad("File SQL phải có kích thước từ 1 byte đến 2 MiB.");
    if (filename == null || !filename.toLowerCase(Locale.ROOT).endsWith(".sql"))
      throw ApiException.bad("Chỉ nhận file có phần mở rộng .sql.");
    if (!targetSchema.matches("[\\p{L}_][\\p{L}\\p{N}_$]{0,127}"))
      throw ApiException.bad("Target schema không hợp lệ.");
    Map<String, Object> warehouse = store.warehouse(warehouseId);
    if (!"ACTIVE".equals(warehouse.get("status")))
      throw new ApiException(
          HttpStatus.CONFLICT,
          "WAREHOUSE_CONNECTION_ERROR",
          "Warehouse không ở trạng thái ACTIVE.");
    requireImportRole(warehouseId);
    String importReference = store.importCredential(warehouseId);
    String importUsername = store.importUsername(warehouseId);
    if (importUsername == null
        || importUsername.isBlank()
        || importReference == null
        || importReference.isBlank())
      throw new ApiException(
          HttpStatus.CONFLICT,
          "WAREHOUSE_CONNECTION_ERROR",
          "Warehouse chưa cấu hình credential ghi riêng cho SQL Import.");
    adapters.password(importReference);
    String targetEngine = Json.str(warehouse, "engine");
    if (targetEngine.equals("MYSQL") && targetSchema.length() > 64)
      throw ApiException.bad("Tên target database MySQL không được vượt 64 ký tự.");
    String text = new String(content, StandardCharsets.UTF_8);
    if (!java.util.Arrays.equals(text.getBytes(StandardCharsets.UTF_8), content))
      throw new ApiException(
          HttpStatus.BAD_REQUEST, "SQL_IMPORT_PARSE_ERROR", "File phải dùng UTF-8 hợp lệ.");
    Result parsed = SqlImportParser.parse(text, sourceDialect, targetSchema);
    int maxIdentifierLength =
        targetEngine.equals("POSTGRESQL") ? 63 : targetEngine.equals("MYSQL") ? 64 : 128;
    if (identifierLength(targetSchema, targetEngine) > maxIdentifierLength)
      throw ApiException.bad("Tên schema vượt giới hạn target.");
    if (parsed.steps().stream()
        .anyMatch(
            step ->
                identifierLength(step.table(), targetEngine) > maxIdentifierLength
                    || step.columns().stream()
                        .anyMatch(
                            column ->
                                identifierLength(column.name(), targetEngine)
                                    > maxIdentifierLength)))
      throw ApiException.bad("Tên bảng hoặc cột vượt giới hạn của target engine.");
    validateTargets(parsed.steps(), targetSchema);
    for (Step step : parsed.steps()) {
      if (identifierLength(step.indexName(), targetEngine) > maxIdentifierLength
          || step.constraints().stream()
              .anyMatch(c -> identifierLength(c.name(), targetEngine) > maxIdentifierLength))
        throw ApiException.bad("Tên constraint/index vượt giới hạn target.");
      for (Column column : step.columns())
        if (!targetEngine.equals("SQL_SERVER")
            && (column.type().equals("TIMESTAMP(7)") || column.type().equals("TIME(7)")))
          throw new ApiException(
              HttpStatus.BAD_REQUEST,
              "UNSUPPORTED_IMPORT_FEATURE",
              "Target chỉ hỗ trợ tối đa 6 chữ số phần thập phân thời gian.");
    }
    validateDestination(warehouse, targetSchema, importUsername, importReference, parsed.steps());
    Map<String, Object> core =
        planDocument(warehouseId, targetSchema, parsed, targetEngine, sourceDialect);
    core.put("targetRevision", warehouse.get("updatedAt"));
    List<Map<String, Object>> canonicalSteps =
        parsed.steps().stream().map(SqlImportExecutor::document).toList();
    Map<String, List<Map<String, Object>>> columnsByTable = new LinkedHashMap<>();
    for (Map<String, Object> step : canonicalSteps)
      if (Json.str(step, "kind").equals(Kind.CREATE_TABLE.name()))
        columnsByTable.put(
            Json.str(step, "schema") + "." + Json.str(step, "table"),
            Json.objects(step.get("columns")));
    for (Map<String, Object> step : canonicalSteps)
      if (Json.str(step, "kind").equals(Kind.INSERT.name()))
        step.put(
            "tableColumns",
            columnsByTable.get(Json.str(step, "schema") + "." + Json.str(step, "table")));
    Map<String, Object> immutableContent = new LinkedHashMap<>(core);
    immutableContent.put("canonicalSteps", canonicalSteps);
    String digest = digest(Json.write(immutableContent));
    String planId = Json.id("plan");
    Instant expiresAt = Instant.now().plus(15, ChronoUnit.MINUTES);
    core.put("planId", planId);
    core.put("planDigest", digest);
    core.put("expiresAt", expiresAt.toString());
    core.put("canonicalSteps", canonicalSteps);
    store.removeExpiredSqlImportPlans();
    store.saveImportPlan(planId, store.actor(), warehouseId, digest, core);
    store.audit(
        "SQL_IMPORT_VALIDATE",
        warehouseId,
        Json.obj(
            "planId", planId,
            "planDigest", digest,
            "sourceDialect", parsed.detectedDialect(),
            "targetEngine", targetEngine,
            "targetSchema", targetSchema));
    return publicPlan(core);
  }

  public synchronized Map<String, Object> confirm(Map<String, Object> request) {
    RegistryController.fields(request, Set.of("planId", "planDigest", "idempotencyKey"));
    RegistryController.required(request, "planId", "planDigest", "idempotencyKey");
    String planId = Json.str(request, "planId");
    String digest = Json.str(request, "planDigest");
    String key = Json.str(request, "idempotencyKey");
    if (key.length() > 100) throw ApiException.bad("idempotencyKey vượt giới hạn 100 ký tự.");
    String requestDigest = digest(planId + ":" + digest);
    Map<String, Object> existing = store.existingSqlImport(store.actor(), key);
    if (existing != null) {
      if (!requestDigest.equals(Json.str(existing, "digest")))
        throw new ApiException(
            HttpStatus.CONFLICT,
            "INVALID_REQUEST",
            "Idempotency key đã được dùng cho một import khác.");
      Map<String, Object> previous = Json.map(existing.get("document"));
      requireImportRole(Json.str(previous, "warehouseId"));
      store.authorize(Json.str(previous, "warehouseId"));
      return previous;
    }
    Map<String, Object> planEntry = store.sqlImportPlan(planId, store.actor());
    if (!MessageDigest.isEqual(
        Json.str(planEntry, "digest").getBytes(StandardCharsets.UTF_8),
        digest.getBytes(StandardCharsets.UTF_8)))
      throw new ApiException(HttpStatus.CONFLICT, "INVALID_REQUEST", "Digest của plan không khớp.");
    Map<String, Object> plan = Json.map(planEntry.get("document"));
    if (Instant.parse(Json.str(plan, "expiresAt")).isBefore(Instant.now()))
      throw new ApiException(HttpStatus.GONE, "INVALID_REQUEST", "Import plan đã hết hạn.");
    String warehouseId = Json.str(plan, "warehouseId");
    requireImportRole(warehouseId);
    Map<String, Object> warehouse = store.warehouse(warehouseId);
    if (!java.util.Objects.equals(warehouse.get("updatedAt"), plan.get("targetRevision")))
      throw new ApiException(
          HttpStatus.CONFLICT,
          "INVALID_REQUEST",
          "Cấu hình target đã thay đổi; hãy validate lại file.");
    String importReference = store.importCredential(warehouseId);
    String importUsername = store.importUsername(warehouseId);
    if (importUsername == null || importUsername.isBlank() || importReference == null)
      throw new ApiException(
          HttpStatus.CONFLICT,
          "WAREHOUSE_CONNECTION_ERROR",
          "Warehouse chưa cấu hình credential ghi riêng cho SQL Import.");
    String runId = Json.id("import");
    Instant started = Instant.now();
    List<Map<String, Object>> steps = new ArrayList<>();
    List<Map<String, Object>> stepDocs = Json.objects(plan.get("canonicalSteps"));
    for (Map<String, Object> step : stepDocs)
      steps.add(
          Json.obj(
              "index",
              step.get("index"),
              "kind",
              step.get("kind"),
              "objectName",
              step.get("table"),
              "status",
              "PENDING",
              "rowsAffected",
              0,
              "error",
              null));
    Map<String, Object> run =
        Json.obj(
            "runId",
            runId,
            "planId",
            planId,
            "warehouseId",
            warehouseId,
            "targetSchema",
            plan.get("targetSchema"),
            "sourceDialect",
            plan.get("sourceDialect"),
            "targetEngine",
            plan.get("targetEngine"),
            "status",
            "RUNNING",
            "statementCount",
            plan.get("statementCount"),
            "completedStatements",
            0,
            "rowsAffected",
            0,
            "createdAt",
            started.toString(),
            "completedAt",
            null,
            "steps",
            steps,
            "error",
            null);
    store.saveSqlImportRun(runId, store.actor(), warehouseId, key, requestDigest, run);
    store.audit(
        "SQL_IMPORT_RUN",
        warehouseId,
        Json.obj("planId", planId, "planDigest", digest, "runId", runId));
    var snapshot = Json.read(Json.write(run));
    var context =
        org.springframework.security.core.context.SecurityContextHolder.createEmptyContext();
    context.setAuthentication(
        org.springframework.security.core.context.SecurityContextHolder.getContext()
            .getAuthentication());
    try {
      jobs.execute(
          () -> {
            org.springframework.security.core.context.SecurityContextHolder.setContext(context);
            try {
              completeImport(warehouse, importUsername, importReference, plan, stepDocs, run);
            } finally {
              org.springframework.security.core.context.SecurityContextHolder.clearContext();
            }
          });
    } catch (java.util.concurrent.RejectedExecutionException full) {
      run.put("status", "FAILED");
      run.put("completedAt", Instant.now().toString());
      run.put(
          "error",
          Errors.body(
              "SQL_IMPORT_CAPACITY",
              "Hàng đợi import đã đầy; tạo run mới khi còn tài nguyên.",
              Json.obj()));
      persistRun(run);
      return run;
    }
    return snapshot;
  }

  private void recoverAbandonedRuns() {
    // Execution is bounded to 60s with at most 18 in-flight jobs; 15min exceeds a full local queue.
    store
        .jdbc()
        .update(
            "UPDATE sql_import_run SET"
                + " document=jsonb_set(jsonb_set(jsonb_set(document,'{status}','\"PARTIAL\"'::jsonb),'{completedAt}',to_jsonb(?::text)),'{error}',?::jsonb)"
                + " WHERE document->>'status'='RUNNING' AND (document->>'createdAt')::timestamptz <"
                + " now()-interval '15 minutes'",
            Instant.now().toString(),
            Json.write(
                Errors.body(
                    "SQL_IMPORT_INTERRUPTED",
                    "Run không hoàn tất sau khi tiến trình bị ngắt; kiểm tra namespace đích trước"
                        + " khi tạo run khác.",
                    Json.obj("outcomeUnknown", true))));
  }

  private void persistRun(Map<String, Object> run) {
    store
        .jdbc()
        .update(
            "UPDATE sql_import_run SET document=?::jsonb WHERE run_id=?",
            Json.write(run),
            run.get("runId"));
  }

  private void completeImport(
      Map<String, Object> warehouse,
      String importUsername,
      String importReference,
      Map<String, Object> plan,
      List<Map<String, Object>> stepDocs,
      Map<String, Object> run) {
    String runId = Json.str(run, "runId"),
        planId = Json.str(plan, "planId"),
        warehouseId = Json.str(warehouse, "warehouseId"),
        digest = Json.str(plan, "planDigest");
    try {
      var currentWarehouse = store.warehouse(warehouseId);
      if (!java.util.Objects.equals(currentWarehouse.get("updatedAt"), plan.get("targetRevision")))
        throw new ApiException(
            HttpStatus.CONFLICT,
            "INVALID_REQUEST",
            "Cấu hình target đã thay đổi sau khi tạo plan.");
      if (!"ACTIVE".equals(currentWarehouse.get("status")))
        throw new ApiException(
            HttpStatus.CONFLICT,
            "WAREHOUSE_CONNECTION_ERROR",
            "Warehouse không ở trạng thái ACTIVE.");
      SqlImportExecutor.execute(
          adapters,
          warehouse,
          importUsername,
          importReference,
          plan,
          stepDocs,
          run,
          ignored -> persistRun(run));
      run.put("status", "SUCCESS");
    } catch (Exception e) {
      if (e instanceof SQLException sqlException)
        LOGGER.warn(
            "SQL Import statement failed with SQLState {} and vendor code {}",
            sqlException.getSQLState(),
            sqlException.getErrorCode());
      String code = e instanceof ApiException api ? api.code : "SQL_IMPORT_EXECUTION_ERROR";
      run.put(
          "status",
          e instanceof SqlImportExecutor.Failure failure && failure.partial ? "PARTIAL" : "FAILED");
      run.put(
          "error",
          Errors.body(
              code,
              e instanceof SqlImportExecutor.Failure failure && failure.partial
                  ? "Engine giữ lại một phần DDL đã commit ngầm; xem các bước và dọn namespace đích"
                      + " trước khi chạy lại."
                  : "SQL Import thất bại; transaction được rollback nếu engine hỗ trợ.",
              Json.obj()));
      List<Map<String, Object>> currentSteps = Json.objects(run.get("steps"));
      currentSteps.stream()
          .filter(
              step -> "RUNNING".equals(step.get("status")) || "PENDING".equals(step.get("status")))
          .findFirst()
          .ifPresent(
              step -> {
                step.put("status", "FAILED");
                step.put("error", Errors.body(code, "Câu lệnh không hoàn tất.", Json.obj()));
              });
    }
    run.put("completedAt", Instant.now().toString());
    store
        .jdbc()
        .update(
            "UPDATE sql_import_run SET document=?::jsonb WHERE run_id=?", Json.write(run), runId);
    store.audit(
        "SQL_IMPORT_COMPLETE",
        warehouseId,
        Json.obj(
            "planId", planId,
            "planDigest", digest,
            "runId", runId,
            "status", run.get("status")));
  }

  public Object list(Map<String, String> params) {
    recoverAbandonedRuns();
    return Page.of(
        store.sqlImportRuns(),
        params,
        "createdAt",
        Set.of("warehouseId", "targetEngine", "status", "createdAt"));
  }

  public Map<String, Object> run(String id) {
    recoverAbandonedRuns();
    return store.sqlImportRun(id);
  }

  private void validateTargets(List<Step> steps, String targetSchema) {
    Set<String> tables = new HashSet<>();
    Set<String> created = new HashSet<>();
    for (Step step : steps) {
      if (!step.schema().equals(targetSchema))
        throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "UNSUPPORTED_IMPORT_FEATURE",
            "Câu lệnh chỉ được ghi vào targetSchema đã chọn.");
      String key = step.schema() + "." + step.table();
      if (step.kind() == Kind.CREATE_TABLE && !tables.add(key))
        throw ApiException.bad("File có nhiều CREATE TABLE trùng tên.");
      if (step.kind() == Kind.CREATE_TABLE) created.add(key);
      if (step.kind() == Kind.INSERT) {
        if (!created.contains(key))
          throw ApiException.bad("INSERT chỉ được phép vào bảng vừa khai báo trong file.");
        Set<String> valid =
            steps.stream()
                .filter(candidate -> candidate.kind() == Kind.CREATE_TABLE)
                .filter(candidate -> (candidate.schema() + "." + candidate.table()).equals(key))
                .findFirst()
                .map(
                    candidate ->
                        candidate.columns().stream()
                            .map(Column::name)
                            .collect(java.util.stream.Collectors.toSet()))
                .orElse(Set.of());
        if (!valid.containsAll(step.insertColumns()))
          throw ApiException.bad("INSERT tham chiếu cột chưa khai báo trong CREATE TABLE.");
      }
    }
  }

  private void validateDestination(
      Map<String, Object> warehouse,
      String targetSchema,
      String importUsername,
      String importReference,
      List<Step> steps) {
    String engine = Json.str(warehouse, "engine");
    Map<String, Object> writer = new LinkedHashMap<>(warehouse);
    writer.put("username", importUsername);
    if (engine.equals("MYSQL")) writer.put("database", targetSchema);
    String password = adapters.password(importReference);
    try (Connection connection = adapters.get(writer).connectForWrite(writer, password)) {
      if (!engine.equals("MYSQL")
          && !adapters.get(writer).discoverSchemas(connection).contains(targetSchema))
        throw ApiException.bad("Target schema phải được tạo và cấp quyền trước khi import.");
      Set<String> existing =
          adapters.get(writer).discoverTables(connection, Set.of(targetSchema)).stream()
              .map(table -> Json.str(table, "name"))
              .collect(java.util.stream.Collectors.toSet());
      for (Step step : steps)
        if (step.kind() == Kind.CREATE_TABLE && existing.contains(step.table()))
          throw new ApiException(
              HttpStatus.CONFLICT,
              "INVALID_REQUEST",
              "Target đã có bảng " + step.table() + "; import không ghi đè.");
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "WAREHOUSE_CONNECTION_ERROR",
          "Không thể kiểm tra target warehouse trước khi import.");
    }
  }

  private Map<String, Object> planDocument(
      String warehouseId,
      String targetSchema,
      Result parsed,
      String targetEngine,
      String requestedDialect) {
    List<Map<String, Object>> schemaPreview = new ArrayList<>();
    for (Step step : parsed.steps()) {
      if (step.kind() != Kind.CREATE_TABLE) continue;
      schemaPreview.add(
          Json.obj(
              "name",
              step.table(),
              "constraints",
              SqlImportExecutor.document(step).get("constraints"),
              "indexes",
              parsed.steps().stream()
                  .filter(
                      index ->
                          index.kind() == Kind.CREATE_INDEX && index.table().equals(step.table()))
                  .map(
                      index ->
                          Json.obj(
                              "name",
                              index.indexName(),
                              "columns",
                              index.insertColumns(),
                              "unique",
                              index.uniqueIndex()))
                  .toList(),
              "columns",
              step.columns().stream()
                  .map(
                      column ->
                          Json.obj(
                              "name",
                              column.name(),
                              "dataType",
                              column.type(),
                              "nullable",
                              column.nullable()
                                  && step.constraints().stream()
                                      .noneMatch(
                                          c ->
                                              c.kind().equals("PRIMARY_KEY")
                                                  && c.columns().contains(column.name())),
                              "primaryKey",
                              step.constraints().stream()
                                  .anyMatch(
                                      c ->
                                          c.kind().equals("PRIMARY_KEY")
                                              && c.columns().contains(column.name())),
                              "identity",
                              column.type().endsWith(" IDENTITY"),
                              "unique",
                              column.unique(),
                              "hasDefault",
                              column.hasDefault(),
                              "defaultValue",
                              column.defaultValue() instanceof Number
                                  ? column.defaultValue().toString()
                                  : column.defaultValue()))
                  .toList()));
    }
    return Json.obj(
        "warehouseId",
        warehouseId,
        "targetSchema",
        targetSchema,
        "sourceDialect",
        requestedDialect,
        "detectedDialect",
        parsed.detectedDialect(),
        "targetEngine",
        targetEngine,
        "mode",
        parsed.detectedDialect().equals(targetEngine) ? "NATIVE" : "CROSS_DIALECT",
        "statementCount",
        parsed.steps().size(),
        "objectCount",
        parsed.steps().stream()
            .filter(step -> step.kind() == Kind.CREATE_TABLE || step.kind() == Kind.CREATE_INDEX)
            .count(),
        "supportedActions",
        parsed.steps().stream().map(step -> step.kind().name()).distinct().toList(),
        "warnings",
        parsed.warnings(),
        "unsupportedFeatures",
        List.of(),
        "preview",
        Json.obj(
            "schemas",
            List.of(Json.obj("name", targetSchema, "tables", schemaPreview)),
            "statements",
            previewStatements(parsed.steps())));
  }

  static List<Map<String, Object>> previewStatements(List<Step> steps) {
    List<Map<String, Object>> statements = new ArrayList<>();
    for (Step step : steps) {
      String objectName =
          switch (step.kind()) {
            case CREATE_SCHEMA -> step.schema();
            case CREATE_TABLE -> step.table();
            case CREATE_INDEX -> step.indexName();
            case INSERT -> step.table();
          };
      String summary =
          switch (step.kind()) {
            case CREATE_SCHEMA -> "Validate existing target schema namespace.";
            case CREATE_TABLE ->
                "Create table with "
                    + step.columns().size()
                    + " columns: "
                    + String.join(", ", step.columns().stream().map(Column::name).toList())
                    + ".";
            case CREATE_INDEX ->
                (step.uniqueIndex() ? "Create unique index on " : "Create index on ")
                    + String.join(", ", step.insertColumns())
                    + ".";
            case INSERT ->
                "Insert "
                    + step.rows().size()
                    + " rows into "
                    + step.table()
                    + " columns "
                    + String.join(", ", step.insertColumns())
                    + ".";
          };
      statements.add(
          Json.obj(
              "index",
              step.index(),
              "kind",
              step.kind().name(),
              "objectName",
              objectName,
              "summary",
              summary));
    }
    return List.copyOf(statements);
  }

  private Map<String, Object> publicPlan(Map<String, Object> core) {
    Map<String, Object> result = new LinkedHashMap<>(core);
    result.remove("canonicalSteps");
    result.remove("targetRevision");
    return result;
  }

  private void requireImportRole(String warehouseId) {
    var authentication =
        org.springframework.security.core.context.SecurityContextHolder.getContext()
            .getAuthentication();
    if (store.admin()) return;
    boolean operator =
        authentication != null
            && authentication.getAuthorities().stream()
                .anyMatch(authority -> authority.getAuthority().equals("ROLE_OPERATOR"));
    if (!operator)
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Cần quyền OPERATOR để nhập SQL.");
    store.authorize(warehouseId);
  }

  private static int identifierLength(String value, String engine) {
    return engine.equals("POSTGRESQL")
        ? value.getBytes(StandardCharsets.UTF_8).length
        : value.length();
  }

  private static String digest(String value) {
    try {
      byte[] hash =
          MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
    } catch (Exception e) {
      throw new IllegalStateException("SHA-256 unavailable", e);
    }
  }
}

package dev.nla;

import dev.nla.warehouse.*;
import jakarta.annotation.PreDestroy;
import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public final class FileIngestionService {
  private final Store store;
  private final FileIngestionStore files;
  private final FileParserClient parser;
  private final Adapters adapters;
  private final CatalogService catalog;
  private final Path directory;
  private final ThreadPoolExecutor workers =
      new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16));
  private final ScheduledExecutorService janitor = Executors.newSingleThreadScheduledExecutor();
  private final Map<String, Future<?>> jobs = new ConcurrentHashMap<>();
  private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
  private final Set<String> started = ConcurrentHashMap.newKeySet();
  private static final List<String> LAYERS = List.of("RAW", "STAGING", "WAREHOUSE", "MART");

  public FileIngestionService(
      Store store,
      FileIngestionStore files,
      FileParserClient parser,
      Adapters adapters,
      CatalogService catalog,
      Environment env)
      throws IOException {
    this.store = store;
    this.files = files;
    this.parser = parser;
    this.adapters = adapters;
    this.catalog = catalog;
    directory =
        Path.of(env.getProperty("FILE_UPLOAD_DIRECTORY", ".local/uploads"))
            .toAbsolutePath()
            .normalize();
    Files.createDirectories(directory);
    try {
      Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
    } catch (UnsupportedOperationException ignored) {
      /* Windows ACLs are managed by deployment. */
    }
  }

  @EventListener(ApplicationReadyEvent.class)
  public void start() {
    files.recover();
    janitor.scheduleWithFixedDelay(this::cleanup, 1, 60, TimeUnit.MINUTES);
  }

  @PreDestroy
  public void stop() {
    workers.shutdownNow();
    janitor.shutdownNow();
  }

  private Path spool(String id) {
    if (!id.matches("file-[a-f0-9-]{36}")) throw ApiException.notFound();
    return directory.resolve(id + ".ndjson");
  }

  private void cleanup() {
    try {
      var expired =
          store
              .jdbc()
              .queryForList(
                  "SELECT id FROM file_upload WHERE expires_at < now() AND NOT EXISTS (SELECT 1"
                      + " FROM file_ingestion_run r WHERE r.upload_id=file_upload.id AND"
                      + " r.document->>'status' IN ('PENDING','RUNNING'))");
      for (var row : expired) Files.deleteIfExists(spool(row.get("id").toString()));
      // Covers an interrupted upload before its metadata transaction was inserted.
      try (var paths = Files.list(directory)) {
        for (var path :
            paths
                .filter(p -> p.getFileName().toString().matches("file-[a-f0-9-]{36}\\.ndjson"))
                .toList()) {
          if (Files.getLastModifiedTime(path)
              .toInstant()
              .isBefore(Instant.now().minus(Duration.ofHours(25)))) Files.deleteIfExists(path);
        }
      }
    } catch (Exception ignored) {
      org.slf4j.LoggerFactory.getLogger(getClass())
          .warn("File spool cleanup failed; no source details logged");
    }
  }

  public synchronized Map<String, Object> upload(MultipartFile file, String sheet, String delimiter)
      throws IOException {
    if (file.isEmpty() || file.getSize() > 25L * 1024 * 1024)
      throw new ApiException(
          HttpStatus.PAYLOAD_TOO_LARGE,
          "PAYLOAD_TOO_LARGE",
          "File cần có dữ liệu và không vượt 25 MiB.");
    String name = Objects.toString(file.getOriginalFilename(), "upload").replace('\\', '/');
    name = name.substring(name.lastIndexOf('/') + 1);
    if (name.isBlank() || name.length() > 200 || name.chars().anyMatch(Character::isISOControl))
      throw ApiException.bad("Tên file không hợp lệ.");
    Integer owned =
        store
            .jdbc()
            .queryForObject(
                "SELECT count(*) FROM file_upload WHERE actor=? AND expires_at>now()",
                Integer.class,
                store.actor());
    Integer global =
        store
            .jdbc()
            .queryForObject(
                "SELECT count(*) FROM file_upload WHERE expires_at>now()", Integer.class);
    if (owned >= 8 || global >= 64)
      throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          "FILE_INGESTION_BUSY",
          "Đã đạt giới hạn file tạm; đợi file cũ hết hạn.");
    String id = Json.id("file");
    Path path = spool(id);
    try {
      var doc = parser.parse(file, sheet, delimiter, path);
      try {
        Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
      } catch (UnsupportedOperationException ignored) {
      }
      doc.putAll(
          Json.obj(
              "id",
              id,
              "fileName",
              name,
              "fileSize",
              file.getSize(),
              "expiresAt",
              Instant.now().plus(Duration.ofHours(24)).toString()));
      String digest = hashFile(path);
      var transaction =
          new org.springframework.transaction.support.TransactionTemplate(
              new org.springframework.jdbc.datasource.DataSourceTransactionManager(
                  Objects.requireNonNull(store.jdbc().getDataSource())));
      transaction.executeWithoutResult(
          status -> {
            files.upload(doc, digest);
            store.audit(
                "FILE_UPLOAD",
                id,
                Json.obj(
                    "fileSize",
                    file.getSize(),
                    "rowCount",
                    doc.get("rowCount"),
                    "fileType",
                    doc.get("fileType")));
          });
      return doc;
    } catch (Exception failure) {
      Files.deleteIfExists(path);
      throw failure;
    }
  }

  public Map<String, Object> upload(String id) {
    return files.get("upload", id);
  }

  public synchronized void discard(String id) throws IOException {
    files.get("upload", id);
    Integer active =
        store
            .jdbc()
            .queryForObject(
                "SELECT count(*) FROM file_ingestion_run WHERE upload_id=? AND document->>'status'"
                    + " IN ('PENDING','RUNNING')",
                Integer.class,
                id);
    if (active != null && active > 0)
      throw new ApiException(
          HttpStatus.CONFLICT,
          "FILE_INGESTION_BUSY",
          "File đang được nạp; hủy tác vụ trước khi xóa.");
    String now = Instant.now().toString();
    store
        .jdbc()
        .update(
            "UPDATE file_upload SET"
                + " expires_at=?::timestamptz,document=jsonb_set(document,'{expiresAt}',to_jsonb(?::text))"
                + " WHERE id=?",
            now,
            now,
            id);
    Files.deleteIfExists(spool(id));
    store.audit("FILE_UPLOAD_DISCARD", id);
  }

  static String hashFile(Path path) throws IOException {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      try (var input = new DigestInputStream(Files.newInputStream(path), digest)) {
        input.transferTo(OutputStream.nullOutputStream());
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private void ensureFile(Map<String, Object> upload) {
    if (Instant.parse(Json.str(upload, "expiresAt")).isBefore(Instant.now())
        || !Files.isRegularFile(spool(Json.str(upload, "id"))))
      throw new ApiException(HttpStatus.GONE, "FILE_EXPIRED", "File đã hết hạn; hãy tải lại.");
  }

  private String revision(Map<String, Object> warehouse) {
    String id = Json.str(warehouse, "warehouseId");
    return FileTypes.hash(
        Json.write(warehouse)
            + store.importUsername(id)
            + store.importCredential(id)
            + adapters.password(store.importCredential(id)));
  }

  private Map<String, Object> target(String id) {
    var warehouse = store.warehouse(id);
    if (!"ACTIVE".equals(warehouse.get("status")))
      throw ApiException.bad("Warehouse chưa hoạt động.");
    if (store.importUsername(id) == null
        || store.importUsername(id).isBlank()
        || store.importCredential(id) == null
        || store.importCredential(id).isBlank())
      throw ApiException.bad("Warehouse cần tài khoản import có quyền CREATE/INSERT riêng.");
    return warehouse;
  }

  static void identifier(String value, int limit) {
    if (!value.matches("[a-zA-Z_][a-zA-Z0-9_]*") || value.length() > limit)
      throw ApiException.bad(
          "Tên schema/bảng/cột cần dùng chữ, số, dấu gạch dưới và không quá " + limit + " ký tự.");
  }

  private List<Map<String, Object>> columns(Object submitted, Map<String, Object> upload) {
    var incoming = Json.objects(submitted);
    var originals = Json.objects(upload.get("columns"));
    if (incoming.size() != originals.size())
      throw ApiException.bad("Mapping phải chứa toàn bộ cột nguồn theo thứ tự.");
    var names = new HashSet<String>();
    for (int i = 0; i < incoming.size(); i++) {
      var column = incoming.get(i);
      RegistryController.fields(column, Set.of("sourceName", "name", "dataType", "nullable"));
      if (!Objects.equals(column.get("sourceName"), originals.get(i).get("sourceName"))
          || !FileTypes.TYPES.contains(Json.str(column, "dataType"))
          || !(column.get("nullable") instanceof Boolean))
        throw ApiException.bad("Mapping cột không hợp lệ.");
      identifier(Json.str(column, "name"), 48);
      if (!names.add(Json.str(column, "name").toLowerCase(Locale.ROOT)))
        throw ApiException.bad("Tên cột đích bị trùng.");
    }
    return incoming;
  }

  private void validateRows(Path path, List<Map<String, Object>> columns) throws IOException {
    try (var rows = Files.newBufferedReader(path)) {
      String line;
      int rowNumber = 0;
      while ((line = rows.readLine()) != null) {
        rowNumber++;
        var values = (List<?>) Json.read(line).get("row");
        for (int i = 0; i < columns.size(); i++) {
          try {
            FileTypes.convert(values.get(i), columns.get(i));
          } catch (RuntimeException invalid) {
            throw new ApiException(
                HttpStatus.UNPROCESSABLE_ENTITY,
                "FILE_MAPPING_INVALID",
                "Giá trị không khớp kiểu dữ liệu tại dòng " + rowNumber + ", cột " + (i + 1) + ".");
          }
        }
      }
    }
  }

  private void checkTargets(Map<String, Object> warehouse, Map<String, Object> plan) {
    String id = Json.str(warehouse, "warehouseId");
    var allowedNamespaces = (List<?>) targets(id).get("namespaces");
    if (!allowedNamespaces.contains(plan.get("targetSchema")))
      throw ApiException.bad("Namespace đích chưa được cấp quyền CREATE.");
    var writer = new LinkedHashMap<>(warehouse);
    writer.put("username", store.importUsername(id));
    if ("MYSQL".equals(warehouse.get("engine"))) writer.put("database", plan.get("targetSchema"));
    var adapter = adapters.get(writer);
    try (var connection =
        adapter.connectForWrite(writer, adapters.password(store.importCredential(id)))) {
      String schema = Json.str(plan, "targetSchema");
      if (adapter.discoverSchemas(connection).stream().noneMatch(s -> s.equals(schema)))
        throw ApiException.bad("Namespace đích chưa được quản trị cấp quyền.");
      var tables = adapter.discoverTables(connection, Set.of(schema));
      for (var layer : Json.objects(plan.get("layers"))) {
        if (tables.stream()
            .anyMatch(t -> Json.str(t, "name").equalsIgnoreCase(Json.str(layer, "table"))))
          throw new ApiException(
              HttpStatus.CONFLICT, "FILE_TARGET_CONFLICT", "Bảng đích đã tồn tại; chọn tên khác.");
      }
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "FILE_TARGET_CONFLICT",
          "Không thể truy cập namespace bằng tài khoản ghi đã đăng ký.");
    }
  }

  public Map<String, Object> targets(String warehouseId) {
    var warehouse = target(warehouseId);
    var writer = new LinkedHashMap<>(warehouse);
    writer.put("username", store.importUsername(warehouseId));
    String engine = Json.str(warehouse, "engine");
    if (engine.equals("MYSQL")) writer.put("database", "information_schema");
    String sql =
        switch (engine) {
          case "POSTGRESQL" ->
              "SELECT nspname FROM pg_namespace WHERE"
                  + " has_schema_privilege(current_user,oid,'CREATE') AND"
                  + " has_schema_privilege(current_user,oid,'USAGE') AND nspname NOT LIKE 'pg_%'"
                  + " ORDER BY nspname";
          case "MYSQL" ->
              "SELECT DISTINCT TABLE_SCHEMA FROM information_schema.SCHEMA_PRIVILEGES WHERE"
                  + " REPLACE(GRANTEE,CHAR(39),'')=CURRENT_USER() AND PRIVILEGE_TYPE='CREATE' ORDER"
                  + " BY TABLE_SCHEMA";
          case "SQL_SERVER" ->
              "SELECT name FROM sys.schemas WHERE HAS_PERMS_BY_NAME(name,'SCHEMA','ALTER')=1 AND"
                  + " HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','CREATE TABLE')=1 AND name NOT IN"
                  + " ('sys','INFORMATION_SCHEMA') ORDER BY name";
          default -> throw ApiException.bad("Engine không hợp lệ.");
        };
    List<String> namespaces = new ArrayList<>();
    try (var connection =
            adapters
                .get(writer)
                .connectForWrite(writer, adapters.password(store.importCredential(warehouseId)));
        var statement = connection.createStatement()) {
      statement.setQueryTimeout(10);
      try (var result = statement.executeQuery(sql)) {
        while (result.next()) namespaces.add(result.getString(1));
      }
      return Json.obj("warehouseId", warehouseId, "namespaces", namespaces);
    } catch (Exception e) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "FILE_TARGET_CONFLICT",
          "Không thể đọc namespace được cấp quyền CREATE bằng tài khoản ghi.");
    }
  }

  public Map<String, Object> validate(String id, Map<String, Object> request) throws IOException {
    RegistryController.fields(
        request, Set.of("warehouseId", "targetSchema", "targetTable", "datasetName", "columns"));
    RegistryController.required(
        request, "warehouseId", "targetSchema", "targetTable", "datasetName");
    var upload = files.get("upload", id);
    ensureFile(upload);
    var warehouse = target(Json.str(request, "warehouseId"));
    String schema = Json.str(request, "targetSchema");
    String table = Json.str(request, "targetTable");
    identifier(schema, 63);
    identifier(table, 40);
    if (Json.str(request, "datasetName").length() > 200)
      throw ApiException.bad("Tên dataset quá dài.");
    var columns = columns(request.get("columns"), upload);
    Path path = spool(id);
    String fileDigest = hashFile(path);
    if (!fileDigest.equals(files.uploadDigest(id)))
      throw ApiException.bad("File tạm không còn khớp.");
    validateRows(path, columns);
    var plan =
        Json.obj(
            "id",
            Json.id("file-plan"),
            "uploadId",
            id,
            "warehouseId",
            request.get("warehouseId"),
            "targetSchema",
            schema,
            "targetTable",
            table,
            "datasetName",
            request.get("datasetName"),
            "status",
            "VALIDATED",
            "fileName",
            upload.get("fileName"),
            "rowCount",
            upload.get("rowCount"),
            "columns",
            columns,
            "previewRows",
            upload.get("previewRows"),
            "layers",
            LAYERS.stream()
                .map(
                    name ->
                        Json.obj(
                            "name",
                            name,
                            "schema",
                            schema,
                            "table",
                            table + "_" + name.toLowerCase(Locale.ROOT)))
                .toList(),
            "expiresAt",
            Instant.now().plus(Duration.ofMinutes(15)).toString(),
            "warnings",
            List.of(
                "Raw lưu giá trị nguồn; các lớp còn lại dùng mapping đã kiểm tra. Bảng mart được"
                    + " đăng ký thành dataset.",
                "MySQL tự commit DDL; lỗi/hủy có thể để lại bảng hoặc lớp đã hoàn tất."),
            "warehouseRevision",
            revision(warehouse),
            "fileDigest",
            fileDigest);
    checkTargets(warehouse, plan);
    plan.put("digest", FileTypes.hash(Json.write(plan)));
    files.plan(plan);
    store.audit(
        "FILE_PLAN_VALIDATE",
        plan.get("id").toString(),
        Json.obj("warehouseId", warehouse.get("warehouseId"), "rowCount", upload.get("rowCount")));
    return publicPlan(plan);
  }

  static Map<String, Object> publicPlan(Map<String, Object> plan) {
    var out = new LinkedHashMap<>(plan);
    out.remove("warehouseRevision");
    out.remove("fileDigest");
    return out;
  }

  public synchronized Map<String, Object> confirm(Map<String, Object> request) throws IOException {
    RegistryController.fields(request, Set.of("planId", "digest", "idempotencyKey"));
    RegistryController.required(request, "planId", "digest", "idempotencyKey");
    String key = Json.str(request, "idempotencyKey");
    if (!key.matches("[a-zA-Z0-9_-]{1,100}"))
      throw ApiException.bad("Idempotency key không hợp lệ.");
    String requestDigest =
        FileTypes.hash(Json.str(request, "planId") + "/" + Json.str(request, "digest"));
    var old = files.retry(key, requestDigest);
    if (old != null) return old;
    var plan = files.get("plan", Json.str(request, "planId"));
    if (!Json.str(plan, "digest").equals(Json.str(request, "digest")))
      throw ApiException.bad("Digest không khớp plan.");
    var warehouse = target(Json.str(plan, "warehouseId"));
    var upload = files.get("upload", Json.str(plan, "uploadId"));
    ensureFile(upload);
    if (Instant.parse(Json.str(plan, "expiresAt")).isBefore(Instant.now())
        || !revision(warehouse).equals(plan.get("warehouseRevision"))
        || !hashFile(spool(Json.str(upload, "id"))).equals(plan.get("fileDigest")))
      throw new ApiException(
          HttpStatus.CONFLICT,
          "FILE_PLAN_STALE",
          "File, cấu hình đích hoặc thời hạn plan đã thay đổi; hãy kiểm tra lại.");
    checkTargets(warehouse, plan);
    if (workers.getQueue().remainingCapacity() == 0)
      throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS, "FILE_INGESTION_BUSY", "Hàng đợi nạp file đang đầy.");
    var run =
        Json.obj(
            "id",
            Json.id("file-run"),
            "sourceKind",
            "FILE",
            "status",
            "PENDING",
            "warehouseId",
            plan.get("warehouseId"),
            "datasetId",
            null,
            "fileName",
            plan.get("fileName"),
            "startedAt",
            Instant.now().toString(),
            "completedAt",
            null,
            "rowCount",
            plan.get("rowCount"),
            "rowsLoaded",
            0,
            "stages",
            LAYERS.stream()
                .map(name -> Json.obj("name", name, "status", "PENDING", "rowsLoaded", 0))
                .toList(),
            "error",
            null,
            "partialFailure",
            false,
            "createdTables",
            new ArrayList<>());
    try {
      var transaction =
          new org.springframework.transaction.support.TransactionTemplate(
              new org.springframework.jdbc.datasource.DataSourceTransactionManager(
                  Objects.requireNonNull(store.jdbc().getDataSource())));
      transaction.executeWithoutResult(
          status -> {
            files.createRun(run, plan, key, requestDigest);
            store.audit(
                "FILE_INGESTION_CONFIRM",
                Json.str(run, "id"),
                Json.obj("warehouseId", plan.get("warehouseId")));
          });
    } catch (DuplicateKeyException conflict) {
      old = files.retry(key, requestDigest);
      if (old != null) return old;
      throw new ApiException(
          HttpStatus.CONFLICT, "FILE_TARGET_CONFLICT", "Plan hoặc bảng đích đã được sử dụng.");
    }
    var context = SecurityContextHolder.getContext();
    String runId = Json.str(run, "id");
    var task =
        new FutureTask<Void>(
            () -> {
              synchronized (this) {
                if (!jobs.containsKey(runId) || cancelled.contains(runId)) return null;
                started.add(runId);
              }
              SecurityContextHolder.setContext(context);
              try {
                execute(plan, run);
              } finally {
                SecurityContextHolder.clearContext();
                jobs.remove(runId);
                cancelled.remove(runId);
                started.remove(runId);
              }
              return null;
            });
    jobs.put(runId, task);
    workers.execute(task);
    return files.get("run", runId);
  }

  private void execute(Map<String, Object> plan, Map<String, Object> run) {
    try {
      if (cancelled.contains(Json.str(run, "id"))) throw new InterruptedException();
      var warehouse = target(Json.str(plan, "warehouseId"));
      if (!revision(warehouse).equals(plan.get("warehouseRevision")))
        throw new IllegalStateException("Changed target configuration");
      run.put("status", "RUNNING");
      files.save(run);
      FileIngestionExecutor.execute(
          adapters,
          warehouse,
          store.importUsername(Json.str(plan, "warehouseId")),
          store.importCredential(Json.str(plan, "warehouseId")),
          plan,
          spool(Json.str(plan, "uploadId")),
          run,
          files::save);
      checkCancelled(run);
      var mart = Json.objects(plan.get("layers")).getLast();
      String sql =
          "SELECT COUNT(*) AS record_count FROM "
              + FileIngestionExecutor.qualified(adapters.get(warehouse), mart);
      var result =
          adapters
              .get(warehouse)
              .executeReadOnlyQuery(
                  warehouse,
                  adapters.password(store.credential(Json.str(plan, "warehouseId"))),
                  sql,
                  1,
                  4096,
                  20);
      var rows = Json.objects(result.get("rows"));
      long count = Long.parseLong(rows.getFirst().get("record_count").toString());
      if (count != ((Number) plan.get("rowCount")).longValue())
        throw new IllegalStateException("Reader verification failed");
      catalog.discover(Json.str(plan, "warehouseId"), true);
      String datasetId = Json.id("ds");
      var dataset =
          Json.obj(
              "datasetId",
              datasetId,
              "warehouseId",
              plan.get("warehouseId"),
              "name",
              plan.get("datasetName"),
              "description",
              "Nạp từ file " + plan.get("fileName") + "; " + count + " bản ghi đã được kiểm tra.",
              "allowedSchemas",
              List.of(plan.get("targetSchema")),
              "allowedTables",
              List.of(Json.obj("schema", mart.get("schema"), "name", mart.get("table"))),
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
                  "FILE_UPLOAD",
                  "fileType",
                  files.get("upload", Json.str(plan, "uploadId")).get("fileType"),
                  "sha256",
                  plan.get("fileDigest"),
                  "runId",
                  run.get("id")));
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
      synchronized (this) {
        checkCancelled(run);
        var completed = new LinkedHashMap<>(run);
        completed.put("datasetId", datasetId);
        completed.put("status", "SUCCESS");
        completed.put("completedAt", Instant.now().toString());
        var transactions =
            new org.springframework.transaction.support.TransactionTemplate(
                new org.springframework.jdbc.datasource.DataSourceTransactionManager(
                    Objects.requireNonNull(store.jdbc().getDataSource())));
        transactions.executeWithoutResult(
            transaction -> {
              store.insertDataset(dataset, semantic);
              store.audit(
                  "FILE_INGESTION_SUCCESS",
                  Json.str(run, "id"),
                  Json.obj(
                      "warehouseId",
                      run.get("warehouseId"),
                      "datasetId",
                      datasetId,
                      "rowCount",
                      count));
              files.save(completed);
            });
        run.clear();
        run.putAll(completed);
      }
    } catch (Exception failure) {
      boolean wasCancelled =
          cancelled.contains(Json.str(run, "id")) || Thread.currentThread().isInterrupted();
      Thread.interrupted(); // Persist terminal state even when JDBC batch was interrupted.
      run.put("status", wasCancelled ? "CANCELLED" : "FAILED");
      if (((Number) run.get("rowsLoaded")).longValue() > 0) run.put("partialFailure", true);
      for (var stage : Json.objects(run.get("stages"))) {
        if ("PENDING".equals(stage.get("status"))) stage.put("status", "SKIPPED");
        if ("RUNNING".equals(stage.get("status")))
          stage.put("status", wasCancelled ? "CANCELLED" : "FAILED");
      }
      run.put(
          "error",
          Errors.body(
              "FILE_INGESTION_ERROR",
              wasCancelled
                  ? "Đã hủy tác vụ; xem trạng thái từng lớp và bảng đã tạo."
                  : "Nạp file không hoàn tất; kiểm tra quyền ghi/đọc, tên đích và trạng thái từng"
                      + " lớp trước khi thử lại.",
              Json.obj()));
      store.audit(
          wasCancelled ? "FILE_INGESTION_CANCELLED" : "FILE_INGESTION_FAILED", Json.str(run, "id"));
    } finally {
      if (!"SUCCESS".equals(run.get("status"))) {
        run.put("completedAt", Instant.now().toString());
        files.save(run);
      }
    }
  }

  private void checkCancelled(Map<String, Object> run) throws InterruptedException {
    if (cancelled.contains(Json.str(run, "id")) || Thread.currentThread().isInterrupted())
      throw new InterruptedException("Cancelled file job");
  }

  public Map<String, Object> run(String id) {
    return files.get("run", id);
  }

  public Object runs(Map<String, String> parameters) {
    String warehouse = parameters.get("warehouseId");
    if (warehouse != null && !warehouse.isBlank()) store.warehouse(warehouse);
    var runs =
        files.runs().stream()
            .filter(
                run ->
                    warehouse == null
                        || warehouse.isBlank()
                        || warehouse.equals(run.get("warehouseId")))
            .toList();
    return Page.of(runs, parameters, "startedAt", Set.of("startedAt", "status", "fileName"));
  }

  public synchronized Map<String, Object> cancel(String id) {
    var run = files.get("run", id);
    if (!Set.of("PENDING", "RUNNING").contains(Json.str(run, "status"))) return run;
    cancelled.add(id);
    var job = jobs.get(id);
    if (job != null && job.cancel(true) && !started.contains(id)) {
      workers.remove((Runnable) job);
      jobs.remove(id);
      cancelled.remove(id);
      run.put("status", "CANCELLED");
      run.put("completedAt", Instant.now().toString());
      Json.objects(run.get("stages")).forEach(stage -> stage.put("status", "SKIPPED"));
      files.save(run);
    }
    store.audit("FILE_INGESTION_CANCEL_REQUEST", id);
    return files.get("run", id);
  }
}

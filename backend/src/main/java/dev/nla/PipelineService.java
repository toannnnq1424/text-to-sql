package dev.nla;

import dev.nla.warehouse.*;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class PipelineService {
  private final Store store;
  private final Adapters adapters;
  private final SqlGuard guard;
  private final CatalogService catalog;

  public PipelineService(Store s, Adapters a, SqlGuard g, CatalogService c) {
    store = s;
    adapters = a;
    guard = g;
    catalog = c;
  }

  public List<Map<String, Object>> configurations() {
    List<Map<String, Object>> configs = new ArrayList<>();
    for (String suffix : List.of("pg", "mysql", "mssql")) {
      Path p =
          Path.of(
              System.getProperty("nla.data.root", "../data"),
              "chinook",
              "pipeline-" + suffix + ".json");
      if (Files.exists(p))
        try {
          var conf = Json.read(Files.readString(p));
          store.authorize(Json.str(conf, "warehouseId"));
          store.warehouse(Json.str(conf, "warehouseId"));
          configs.add(conf);
        } catch (ApiException ignored) {
        } catch (java.io.IOException e) {
          throw new IllegalStateException("Registered pipeline unreadable");
        }
    }
    return configs;
  }

  public List<Map<String, Object>> sources() {
    return configurations().stream()
        .map(
            c ->
                Json.obj(
                    "sourceId",
                    c.get("sourceId"),
                    "name",
                    c.get("name"),
                    "type",
                    c.get("type"),
                    "status",
                    "ACTIVE",
                    "warehouseId",
                    c.get("warehouseId"),
                    "datasetId",
                    c.get("datasetId")))
        .toList();
  }

  public synchronized Map<String, Object> run(Map<String, Object> b) {
    RegistryController.fields(b, Set.of("warehouseId", "datasetId", "sourceId", "idempotencyKey"));
    RegistryController.required(b, "warehouseId", "datasetId", "sourceId", "idempotencyKey");
    String key = Json.str(b, "idempotencyKey");
    if (key.length() > 100) throw ApiException.bad("Idempotency key quá dài.");
    String signature =
        Json.str(b, "warehouseId") + "/" + Json.str(b, "datasetId") + "/" + Json.str(b, "sourceId");
    var existing =
        store
            .jdbc()
            .query(
                "SELECT signature,run_id FROM ingestion_request WHERE actor=? AND request_key=?",
                (rs, n) -> Map.of("signature", rs.getString(1), "runId", rs.getString(2)),
                store.actor(),
                key);
    if (!existing.isEmpty()) {
      if (!existing.getFirst().get("signature").equals(signature))
        throw new ApiException(
            org.springframework.http.HttpStatus.CONFLICT,
            "INVALID_REQUEST",
            "Idempotency key đã dùng với payload khác.");
      return store.run(existing.getFirst().get("runId"), "INGESTION");
    }
    var cfg =
        configurations().stream()
            .filter(
                c ->
                    Json.str(c, "sourceId").equals(b.get("sourceId"))
                        && Json.str(c, "warehouseId").equals(b.get("warehouseId"))
                        && Json.str(c, "datasetId").equals(b.get("datasetId")))
            .findFirst()
            .orElseThrow(ApiException::notFound);
    var w = store.warehouse(Json.str(b, "warehouseId"));
    var d = store.dataset(Json.str(b, "datasetId"));
    if (!"ACTIVE".equals(w.get("status")) || !"ACTIVE".equals(d.get("status")))
      throw new ApiException(
          org.springframework.http.HttpStatus.CONFLICT,
          "DATASET_UNAVAILABLE",
          "Warehouse/dataset không hoạt động.");
    String id = Json.id("ing");
    var steps = new ArrayList<Map<String, Object>>();
    for (String stage : List.of("RAW", "STAGING", "WAREHOUSE", "MART"))
      steps.add(Json.obj("stage", stage, "status", "PENDING", "durationMs", null, "error", null));
    var run =
        Json.obj(
            "runId",
            id,
            "batchId",
            Json.id("batch"),
            "warehouseId",
            w.get("warehouseId"),
            "datasetId",
            d.get("datasetId"),
            "engine",
            w.get("engine"),
            "status",
            "RUNNING",
            "sourceId",
            cfg.get("sourceId"),
            "rowsWritten",
            0,
            "rejectedCount",
            0,
            "startedAt",
            Instant.now().toString(),
            "completedAt",
            null,
            "durationMs",
            null,
            "idempotent",
            true,
            "steps",
            steps,
            "error",
            null);
    store.run(id, "INGESTION", run);
    store
        .jdbc()
        .update(
            "INSERT INTO ingestion_request(actor,request_key,signature,run_id) VALUES (?,?,?,?)",
            store.actor(),
            key,
            signature,
            id);
    long start = System.nanoTime();
    int active = 0;
    try {
      var adapter = adapters.get(w);
      var validated =
          guard.validate(
              Json.str(cfg, "readSql"),
              Json.str(w, "engine"),
              catalog.tables(Json.str(d, "datasetId")));
      var raw =
          adapter.executeReadOnlyQuery(
              w,
              adapters.password(store.credential(Json.str(w, "warehouseId"))),
              validated.sql(),
              configuredBound(cfg, "maxRows", 1000, 1, 10000),
              configuredBound(cfg, "maxBytes", 5242880, 1024, 52428800),
              configuredBound(cfg, "timeoutSeconds", 15, 1, 60));
      if (Boolean.TRUE.equals(raw.get("truncated")))
        throw ApiException.bad("Nguồn pipeline vượt giới hạn đã cấu hình.");
      done(steps.get(active++), start);
      var columns = configuredColumns(cfg);
      var columnTypes = columnTypes(Json.objects(raw.get("columns")), columns);
      var rows = Json.objects(raw.get("rows"));
      long rejected = rows.stream().filter(row -> invalidRow(row, cfg, columns)).count();
      run.put("rejectedCount", rejected);
      if (rejected > 0)
        throw ApiException.bad(
            "Dữ liệu nguồn không vượt qua kiểm tra chất lượng; không ghi vào warehouse.");
      var writer = new LinkedHashMap<>(w);
      writer.put("username", "nla_writer");
      try (Connection conn =
          adapter.connect(writer, adapters.password(Json.str(cfg, "credentialReference")))) {
        conn.setAutoCommit(false);
        try {
          String stage = qualified(adapter, Json.map(cfg.get("stage"))),
              mart = qualified(adapter, Json.map(cfg.get("mart")));
          verifyTargetColumns(conn, w, Json.map(cfg.get("stage")), columns);
          verifyTargetColumns(conn, w, Json.map(cfg.get("mart")), columns);
          String columnList =
              columns.stream()
                  .map(adapter::quoteIdentifier)
                  .collect(java.util.stream.Collectors.joining(","));
          String placeholders = String.join(",", Collections.nCopies(columns.size(), "?"));
          try (Statement stmt = conn.createStatement()) {
            adapter.configureTimeout(stmt, 15);
            stmt.executeUpdate("DELETE FROM " + stage);
          }
          try (PreparedStatement stmt =
              conn.prepareStatement(
                  "INSERT INTO " + stage + " (" + columnList + ") VALUES (" + placeholders + ")")) {
            adapter.configureTimeout(stmt, 15);
            for (var row : rows) {
              for (int i = 0; i < columns.size(); i++) {
                Object value = row.get(columns.get(i));
                if (value == null) stmt.setNull(i + 1, Types.NULL);
                else bindValue(stmt, i + 1, value, columnTypes.get(columns.get(i)));
              }
              stmt.addBatch();
            }
            stmt.executeBatch();
          }
          done(steps.get(active++), start);
          try (Statement stmt = conn.createStatement()) {
            adapter.configureTimeout(stmt, 15);
            stmt.executeUpdate("DELETE FROM " + mart);
            stmt.executeUpdate(
                "INSERT INTO "
                    + mart
                    + " ("
                    + columnList
                    + ") SELECT "
                    + columnList
                    + " FROM "
                    + stage);
          }
          done(steps.get(active++), start);
          try (Statement stmt = conn.createStatement();
              ResultSet check = stmt.executeQuery("SELECT COUNT(*) FROM " + mart)) {
            check.next();
            if (check.getInt(1) != rows.size()) throw new SQLException("Mart integrity mismatch");
          }
          conn.commit();
          done(steps.get(active++), start);
          run.put("rowsWritten", rows.size());
          run.put("status", "SUCCESS");
        } catch (Exception e) {
          conn.rollback();
          throw e;
        }
      }
    } catch (Exception e) {
      org.slf4j.LoggerFactory.getLogger(PipelineService.class)
          .warn(
              "Pipeline failure engine={} phase={} exception={} code={}",
              w.get("engine"),
              active,
              e.getClass().getSimpleName(),
              e instanceof SQLException sql
                  ? sql.getSQLState()
                  : e instanceof ApiException api ? api.code : "UNKNOWN");
      run.put("status", "FAILED");
      var error =
          Errors.body(
              "INGESTION_ERROR",
              "Pipeline thất bại; transaction được rollback, dữ liệu đích được giữ nguyên.",
              Json.obj());
      run.put("error", error);
      if (active < steps.size()) {
        steps.get(active).put("status", "FAILED");
        steps.get(active).put("error", error);
      }
      for (int i = active + 1; i < steps.size(); i++) steps.get(i).put("status", "SKIPPED");
    }
    run.put("durationMs", (System.nanoTime() - start) / 1000000);
    run.put("completedAt", Instant.now().toString());
    store.run(id, "INGESTION", run);
    store.audit("INGESTION_" + run.get("status"), id);
    return run;
  }

  private static void done(Map<String, Object> step, long start) {
    step.put("status", "SUCCESS");
    step.put("durationMs", (System.nanoTime() - start) / 1000000);
  }

  static List<String> configuredColumns(Map<String, Object> config) {
    Object configured = config.get("columns");
    if (!(configured instanceof List<?> values) || values.isEmpty() || values.size() > 100)
      throw ApiException.bad("Pipeline cần khai báo từ 1 đến 100 cột đầu ra.");
    List<String> columns = new ArrayList<>();
    Set<String> unique = new HashSet<>();
    for (Object value : values) {
      if (!(value instanceof String name)
          || !name.matches("[A-Za-z_][A-Za-z0-9_]{0,62}")
          || !unique.add(name.toLowerCase(Locale.ROOT)))
        throw ApiException.bad("Tên cột pipeline không hợp lệ hoặc bị trùng.");
      columns.add(name);
    }
    return List.copyOf(columns);
  }

  static int configuredBound(
      Map<String, Object> config, String key, int fallback, int min, int max) {
    Object value = config.get(key);
    if (value == null) return fallback;
    if (!(value instanceof Number number)
        || number.longValue() != number.doubleValue()
        || number.intValue() < min
        || number.intValue() > max)
      throw ApiException.bad("Giới hạn " + key + " của pipeline không hợp lệ.");
    return number.intValue();
  }

  static boolean invalidRow(
      Map<String, Object> row, Map<String, Object> config, List<String> columns) {
    if (!row.keySet().equals(new LinkedHashSet<>(columns))) return true;
    Object required = config.getOrDefault("requiredColumns", columns);
    if (!(required instanceof List<?> requiredColumns)
        || requiredColumns.stream().anyMatch(name -> !columns.contains(name)))
      throw ApiException.bad("Cấu hình requiredColumns của pipeline không hợp lệ.");
    for (Object name : requiredColumns) if (row.get(name.toString()) == null) return true;

    Object limits = config.getOrDefault("maxStringLengths", Map.of());
    if (!(limits instanceof Map<?, ?> maxLengths))
      throw ApiException.bad("Cấu hình maxStringLengths của pipeline không hợp lệ.");
    for (var limit : maxLengths.entrySet()) {
      if (!(limit.getKey() instanceof String name)
          || !columns.contains(name)
          || !(limit.getValue() instanceof Number max)
          || max.doubleValue() != max.intValue()
          || max.intValue() < 1
          || max.intValue() > 10000)
        throw ApiException.bad("Giới hạn chiều dài cột pipeline không hợp lệ.");
      Object value = row.get(name);
      if (value != null && value.toString().length() > max.intValue()) return true;
    }
    return false;
  }

  static Map<String, String> columnTypes(List<Map<String, Object>> metadata, List<String> columns) {
    Map<String, String> types = new LinkedHashMap<>();
    for (var column : metadata) {
      String name = Objects.toString(column.get("name"), "");
      if (columns.contains(name)) types.put(name, Objects.toString(column.get("dataType"), ""));
    }
    if (types.size() != columns.size())
      throw ApiException.bad("Cột pipeline không khớp với kết quả truy vấn nguồn.");
    return types;
  }

  private static void bindValue(PreparedStatement statement, int index, Object value, String type)
      throws SQLException {
    try {
      switch (type) {
        case "INTEGER" -> statement.setInt(index, Integer.parseInt(value.toString()));
        case "BIGINT" -> statement.setLong(index, Long.parseLong(value.toString()));
        case "DECIMAL" ->
            statement.setBigDecimal(index, new java.math.BigDecimal(value.toString()));
        case "FLOAT" -> statement.setDouble(index, Double.parseDouble(value.toString()));
        case "BOOLEAN" -> statement.setBoolean(index, Boolean.parseBoolean(value.toString()));
        case "DATE" -> statement.setDate(index, java.sql.Date.valueOf(value.toString()));
        case "TIMESTAMP" ->
            statement.setTimestamp(index, Timestamp.from(Instant.parse(value.toString())));
        case "STRING" -> statement.setString(index, value.toString());
        default -> throw ApiException.bad("Kiểu dữ liệu pipeline không được hỗ trợ.");
      }
    } catch (NumberFormatException | java.time.DateTimeException e) {
      throw ApiException.bad("Giá trị nguồn không hợp lệ theo kiểu dữ liệu đã phát hiện.");
    }
  }

  private static void verifyTargetColumns(
      Connection connection,
      Map<String, Object> warehouse,
      Map<String, Object> target,
      List<String> expected)
      throws SQLException {
    String schema = Json.str(target, "schema"), table = Json.str(target, "name");
    Set<String> actual = new HashSet<>();
    try (ResultSet columns =
        connection
            .getMetaData()
            .getColumns(
                warehouse.get("engine").equals("MYSQL") ? schema : connection.getCatalog(),
                warehouse.get("engine").equals("MYSQL") ? null : schema,
                table,
                "%")) {
      while (columns.next()) actual.add(columns.getString("COLUMN_NAME"));
    }
    if (!actual.equals(new HashSet<>(expected)))
      throw new SQLException("Configured target columns do not match the registered table.");
  }

  private static String qualified(WarehouseAdapter adapter, Map<String, Object> t) {
    return adapter.quoteIdentifier(Json.str(t, "schema"))
        + "."
        + adapter.quoteIdentifier(Json.str(t, "name"));
  }
}

package dev.nla;

import dev.nla.warehouse.*;
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
  private final IngestionSourceService sources;

  public PipelineService(
      Store s, Adapters a, SqlGuard g, CatalogService c, IngestionSourceService sources) {
    store = s;
    adapters = a;
    guard = g;
    catalog = c;
    this.sources = sources;
  }

  public List<Map<String, Object>> configurations() {
    return store.ingestionSources();
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
    Map<String, Object> cfg = store.ingestionSource(Json.str(b, "sourceId"));
    String signature = digest(Json.write(cfg));
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
    if (!Json.str(cfg, "sourceId").equals(Json.str(b, "sourceId"))
        || !Json.str(cfg, "warehouseId").equals(Json.str(b, "warehouseId"))
        || !Json.str(cfg, "datasetId").equals(Json.str(b, "datasetId")))
      throw ApiException.notFound();
    if (!"ACTIVE".equals(Json.str(cfg, "status")))
      throw new ApiException(
          org.springframework.http.HttpStatus.CONFLICT,
          "DATASET_UNAVAILABLE",
          "Ingestion source đã bị vô hiệu hóa.");
    sources.validateConfig(cfg);
    var w = store.warehouse(Json.str(b, "warehouseId"));
    var d = store.dataset(Json.str(b, "datasetId"));
    var sourceWarehouse = store.warehouse(Json.str(cfg, "sourceWarehouseId"));
    var sourceDataset = store.dataset(Json.str(cfg, "sourceDatasetId"));
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
            "sourceWarehouseId",
            cfg.get("sourceWarehouseId"),
            "sourceDatasetId",
            cfg.get("sourceDatasetId"),
            "configurationSnapshot",
            cfg,
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
    boolean rolledBack = false;
    try {
      var sourceAdapter = adapters.get(sourceWarehouse);
      var adapter = adapters.get(w);
      var validated =
          guard.validate(
              Json.str(cfg, "readSql"),
              Json.str(sourceWarehouse, "engine"),
              catalog.tables(Json.str(sourceDataset, "datasetId")));
      var raw =
          sourceAdapter.executeReadOnlyQuery(
              sourceWarehouse,
              adapters.password(store.credential(Json.str(sourceWarehouse, "warehouseId"))),
              validated.sql(),
              configuredBound(cfg, "maxRows", 1000, 1, 10000),
              configuredBound(cfg, "maxBytes", 5242880, 1024, 52428800),
              configuredBound(cfg, "timeoutSeconds", 15, 1, 60));
      List<String> configuredColumns = configuredColumns(cfg);
      List<Map<String, Object>> sourceRows = Json.objects(raw.get("rows"));
      long rejectedRows =
          sourceRows.stream().filter(row -> invalidRow(row, cfg, configuredColumns)).count();
      run.put("rejectedCount", rejectedRows);
      sources.validateOutput(cfg, raw);
      var columns = configuredColumns;
      var columnTypes = stringMap(Json.map(cfg.get("columnTypes")));
      var rows = sourceRows;
      if (rejectedRows > 0)
        throw ApiException.bad(
            "Dữ liệu nguồn không vượt qua kiểm tra chất lượng; không ghi vào warehouse.");
      var writer = new LinkedHashMap<>(w);
      writer.put("username", store.ingestionUsername(Json.str(w, "warehouseId")));
      String writerCredential = store.ingestionCredential(Json.str(w, "warehouseId"));
      try (Connection conn = adapter.connectForWrite(writer, adapters.password(writerCredential))) {
        conn.setAutoCommit(false);
        try {
          Map<String, String> targets = new LinkedHashMap<>();
          for (String layer : List.of("raw", "stage", "warehouse", "mart")) {
            Map<String, Object> target = Json.map(cfg.get(layer));
            verifyTargetColumns(conn, w, target, columns);
            targets.put(layer, qualified(adapter, target));
          }
          String columnList =
              columns.stream()
                  .map(adapter::quoteIdentifier)
                  .collect(java.util.stream.Collectors.joining(","));
          String placeholders = String.join(",", Collections.nCopies(columns.size(), "?"));
          replaceFromRows(
              conn,
              adapter,
              targets.get("raw"),
              columnList,
              placeholders,
              rows,
              columns,
              columnTypes);
          done(steps.get(active++), start);
          String previous = targets.get("raw");
          for (String layer : List.of("stage", "warehouse", "mart")) {
            String current = targets.get(layer);
            replaceFromTable(conn, adapter, current, previous, columnList, rows.size());
            previous = current;
            done(steps.get(active++), start);
          }
          conn.commit();
          run.put("rowsWritten", rows.size());
          run.put("status", "SUCCESS");
        } catch (Exception e) {
          conn.rollback();
          rolledBack = true;
          throw e;
        }
      }
    } catch (Exception e) {
      if (rolledBack)
        for (Map<String, Object> step : steps)
          if ("SUCCESS".equals(step.get("status"))) step.put("status", "ROLLED_BACK");
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
      int failedStep = Math.min(active, steps.size() - 1);
      if (failedStep >= 0 && !"ROLLED_BACK".equals(steps.get(failedStep).get("status"))) {
        steps.get(failedStep).put("status", "FAILED");
        steps.get(failedStep).put("error", error);
      }
      for (int i = failedStep + 1; i < steps.size(); i++) steps.get(i).put("status", "SKIPPED");
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

  private static Map<String, String> stringMap(Map<String, Object> values) {
    Map<String, String> result = new LinkedHashMap<>();
    values.forEach(
        (key, value) -> {
          if (value instanceof String text) result.put(key, text);
        });
    return result;
  }

  private static String digest(String value) {
    try {
      byte[] hash =
          java.security.MessageDigest.getInstance("SHA-256")
              .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      return java.util.HexFormat.of().formatHex(hash);
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is unavailable", e);
    }
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

  private static void replaceFromRows(
      Connection connection,
      WarehouseAdapter adapter,
      String target,
      String columnList,
      String placeholders,
      List<Map<String, Object>> rows,
      List<String> columns,
      Map<String, String> columnTypes)
      throws SQLException {
    try (Statement statement = connection.createStatement()) {
      adapter.configureTimeout(statement, 15);
      statement.executeUpdate("DELETE FROM " + target);
    }
    try (PreparedStatement statement =
        connection.prepareStatement(
            "INSERT INTO " + target + " (" + columnList + ") VALUES (" + placeholders + ")")) {
      adapter.configureTimeout(statement, 15);
      for (Map<String, Object> row : rows) {
        for (int index = 0; index < columns.size(); index++) {
          Object value = row.get(columns.get(index));
          if (value == null) statement.setNull(index + 1, Types.NULL);
          else bindValue(statement, index + 1, value, columnTypes.get(columns.get(index)));
        }
        statement.addBatch();
      }
      statement.executeBatch();
    }
    verifyRowCount(connection, target, rows.size());
  }

  private static void replaceFromTable(
      Connection connection,
      WarehouseAdapter adapter,
      String target,
      String source,
      String columnList,
      int expectedRows)
      throws SQLException {
    try (Statement statement = connection.createStatement()) {
      adapter.configureTimeout(statement, 15);
      statement.executeUpdate("DELETE FROM " + target);
      statement.executeUpdate(
          "INSERT INTO "
              + target
              + " ("
              + columnList
              + ") SELECT "
              + columnList
              + " FROM "
              + source);
    }
    verifyRowCount(connection, target, expectedRows);
  }

  private static void verifyRowCount(Connection connection, String target, int expectedRows)
      throws SQLException {
    try (Statement statement = connection.createStatement();
        ResultSet result = statement.executeQuery("SELECT COUNT(*) FROM " + target)) {
      if (!result.next() || result.getInt(1) != expectedRows)
        throw new SQLException("Ingestion layer integrity mismatch.");
    }
  }
}

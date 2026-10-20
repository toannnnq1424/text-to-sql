package dev.nla;

import dev.nla.warehouse.Adapters;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class IngestionSourceService {
  private static final Set<String> FIELDS =
      Set.of(
          "name",
          "warehouseId",
          "datasetId",
          "sourceWarehouseId",
          "sourceDatasetId",
          "readSql",
          "raw",
          "stage",
          "warehouse",
          "mart",
          "columns",
          "requiredColumns",
          "columnTypes",
          "maxStringLengths",
          "maxRows",
          "maxBytes",
          "timeoutSeconds",
          "status");
  private static final Set<String> TYPES =
      Set.of("STRING", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "TIMESTAMP");
  private final Store store;
  private final Adapters adapters;
  private final CatalogService catalog;
  private final SqlGuard guard;

  public IngestionSourceService(
      Store store, Adapters adapters, CatalogService catalog, SqlGuard guard) {
    this.store = store;
    this.adapters = adapters;
    this.catalog = catalog;
    this.guard = guard;
  }

  public Map<String, Object> create(Map<String, Object> request) {
    RegistryController.fields(request, FIELDS);
    RegistryController.required(
        request,
        "name",
        "warehouseId",
        "datasetId",
        "sourceWarehouseId",
        "sourceDatasetId",
        "readSql",
        "raw",
        "stage",
        "warehouse",
        "mart",
        "columns",
        "requiredColumns",
        "columnTypes",
        "maxRows",
        "maxBytes",
        "timeoutSeconds");
    Map<String, Object> source = new LinkedHashMap<>(request);
    source.put("sourceId", Json.id("src"));
    source.put("status", "ACTIVE");
    source.put("type", "REGISTERED_INGESTION");
    source.put("createdAt", Instant.now().toString());
    source.put("updatedAt", Instant.now().toString());
    validateConfig(source);
    store.insertIngestionSource(source);
    audit("INGESTION_SOURCE_CREATED", source);
    return source;
  }

  public Map<String, Object> update(String sourceId, Map<String, Object> request) {
    RegistryController.fields(request, FIELDS);
    Map<String, Object> source = new LinkedHashMap<>(store.ingestionSource(sourceId));
    source.putAll(request);
    source.put("sourceId", sourceId);
    source.put("updatedAt", Instant.now().toString());
    validateConfig(source);
    store.updateIngestionSource(source);
    audit("INGESTION_SOURCE_UPDATED", source);
    return source;
  }

  public List<Map<String, Object>> list() {
    return store.ingestionSources();
  }

  public Map<String, Object> get(String sourceId) {
    return store.ingestionSource(sourceId);
  }

  public Map<String, Object> test(String sourceId) {
    Map<String, Object> source = store.ingestionSource(sourceId);
    validateConfig(source);
    Map<String, Object> response;
    try {
      response = inspect(source);
    } catch (ApiException e) {
      audit("INGESTION_SOURCE_TEST_FAILED", source);
      throw e;
    }
    audit("INGESTION_SOURCE_TESTED", source);
    return response;
  }

  public Map<String, Object> inspect(Map<String, Object> source) {
    Map<String, Object> sourceWarehouse = store.warehouse(Json.str(source, "sourceWarehouseId"));
    Map<String, Object> targetWarehouse = store.warehouse(Json.str(source, "warehouseId"));
    List<Map<String, Object>> allowedTables = catalog.tables(Json.str(source, "sourceDatasetId"));
    var guarded =
        guard.validate(
            Json.str(source, "readSql"), Json.str(sourceWarehouse, "engine"), allowedTables);
    Map<String, Object> raw;
    try {
      raw =
          adapters
              .get(sourceWarehouse)
              .executeReadOnlyQuery(
                  sourceWarehouse,
                  adapters.password(store.credential(Json.str(sourceWarehouse, "warehouseId"))),
                  guarded.sql(),
                  integer(source, "maxRows", 1000, 1, 10000),
                  integer(source, "maxBytes", 5242880, 1024, 52428800),
                  integer(source, "timeoutSeconds", 15, 1, 60));
    } catch (Exception e) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "INGESTION_SOURCE_UNAVAILABLE",
          "Không thể chạy SELECT giới hạn trên source warehouse.");
    }
    validateOutput(source, raw);
    for (String layer : List.of("raw", "stage", "warehouse", "mart"))
      verifyTarget(
          targetWarehouse,
          Json.map(source.get(layer)),
          (List<?>) source.get("columns"),
          Json.map(source.get("columnTypes")));
    return Json.obj(
        "sourceId",
        source.get("sourceId"),
        "reachable",
        true,
        "checkedAt",
        Instant.now().toString(),
        "sourceEngine",
        sourceWarehouse.get("engine"),
        "targetEngine",
        targetWarehouse.get("engine"),
        "rowCount",
        Json.objects(raw.get("rows")).size(),
        "truncated",
        raw.get("truncated"),
        "columns",
        raw.get("columns"),
        "targets",
        List.of(
            source.get("raw"), source.get("stage"), source.get("warehouse"), source.get("mart")));
  }

  public void validateConfig(Map<String, Object> source) {
    String name = Json.str(source, "name").strip();
    if (name.isBlank() || name.length() > 120)
      throw ApiException.bad("Tên source phải có từ 1 đến 120 ký tự.");
    String status = Json.str(source, "status");
    if (!Set.of("ACTIVE", "DISABLED").contains(status))
      throw ApiException.bad("Trạng thái ingestion source không hợp lệ.");
    Map<String, Object> targetWarehouse = store.warehouse(Json.str(source, "warehouseId"));
    Map<String, Object> targetDataset = store.dataset(Json.str(source, "datasetId"));
    Map<String, Object> sourceWarehouse = store.warehouse(Json.str(source, "sourceWarehouseId"));
    Map<String, Object> sourceDataset = store.dataset(Json.str(source, "sourceDatasetId"));
    if (!Json.str(targetDataset, "warehouseId").equals(Json.str(targetWarehouse, "warehouseId")))
      throw ApiException.bad("Dataset đích không thuộc warehouse đích.");
    if (!Json.str(sourceDataset, "warehouseId").equals(Json.str(sourceWarehouse, "warehouseId")))
      throw ApiException.bad("Dataset nguồn không thuộc warehouse nguồn.");
    if (!"ACTIVE".equals(Json.str(targetWarehouse, "status"))
        || !"ACTIVE".equals(Json.str(targetDataset, "status"))
        || !"ACTIVE".equals(Json.str(sourceWarehouse, "status"))
        || !"ACTIVE".equals(Json.str(sourceDataset, "status")))
      throw new ApiException(
          HttpStatus.CONFLICT,
          "DATASET_UNAVAILABLE",
          "Warehouse và dataset nguồn/đích phải ở trạng thái ACTIVE.");
    List<String> columns = columns(source);
    Map<String, Object> declaredTypes = Json.map(source.get("columnTypes"));
    if (!declaredTypes.keySet().equals(new HashSet<>(columns))
        || declaredTypes.values().stream().anyMatch(value -> !TYPES.contains(value)))
      throw ApiException.bad("columnTypes phải khai báo đúng một kiểu canonical cho từng cột.");
    Set<String> required = new HashSet<>();
    Object requiredValue = source.get("requiredColumns");
    if (!(requiredValue instanceof List<?> requiredList))
      throw ApiException.bad("requiredColumns phải là danh sách cột.");
    for (Object value : requiredList)
      if (!(value instanceof String column) || !columns.contains(column) || !required.add(column))
        throw ApiException.bad("requiredColumns phải là tập con cột duy nhất đã khai báo.");
    Map<String, Object> maxLengths = Json.map(source.get("maxStringLengths"));
    for (var entry : maxLengths.entrySet())
      if (!columns.contains(entry.getKey())
          || !"STRING".equals(declaredTypes.get(entry.getKey()))
          || !(entry.getValue() instanceof Number length)
          || length.doubleValue() != length.intValue()
          || length.intValue() < 1
          || length.intValue() > 10000) throw ApiException.bad("maxStringLengths không hợp lệ.");
    integer(source, "maxRows", 1000, 1, 10000);
    integer(source, "maxBytes", 5242880, 1024, 52428800);
    integer(source, "timeoutSeconds", 15, 1, 60);
    Set<String> targetNames = new HashSet<>();
    for (String layer : List.of("raw", "stage", "warehouse", "mart")) {
      Map<String, Object> target = Json.map(source.get(layer));
      String qualifiedName =
          (Json.str(target, "schema") + "." + Json.str(target, "name")).toLowerCase(Locale.ROOT);
      if (!targetNames.add(qualifiedName))
        throw ApiException.bad("Mỗi layer RAW/STAGING/WAREHOUSE/MART cần một bảng đích riêng.");
      validateTarget(source, targetDataset, Json.map(source.get(layer)), layer);
    }
    List<Map<String, Object>> physical = catalog.tables(Json.str(source, "sourceDatasetId"));
    guard.validate(Json.str(source, "readSql"), Json.str(sourceWarehouse, "engine"), physical);
    String username = store.ingestionUsername(Json.str(targetWarehouse, "warehouseId"));
    String credentialReference =
        store.ingestionCredential(Json.str(targetWarehouse, "warehouseId"));
    if (username == null || username.isBlank() || credentialReference == null)
      throw new ApiException(
          HttpStatus.CONFLICT,
          "INGESTION_WRITER_NOT_CONFIGURED",
          "Target warehouse chưa có ingestion writer credential được quản trị.");
    adapters.password(credentialReference);
  }

  private void validateTarget(
      Map<String, Object> source,
      Map<String, Object> dataset,
      Map<String, Object> target,
      String field) {
    String schema = Json.str(target, "schema");
    String name = Json.str(target, "name");
    if (!schema.matches("[A-Za-z_][A-Za-z0-9_]{0,62}")
        || !name.matches("[A-Za-z_][A-Za-z0-9_]{0,62}"))
      throw ApiException.bad(field + " schema/name phải là identifier SQL hợp lệ.");
    List<String> schemas =
        dataset.get("allowedSchemas") instanceof List<?> allowed
            ? allowed.stream().map(Object::toString).toList()
            : List.of();
    if (!schemas.contains(schema))
      throw ApiException.bad(field + " schema phải nằm trong allowedSchemas của dataset đích.");
  }

  public void validateOutput(Map<String, Object> source, Map<String, Object> raw) {
    List<String> expectedColumns = columns(source);
    List<Map<String, Object>> actual = Json.objects(raw.get("columns"));
    List<String> actualNames = actual.stream().map(column -> Json.str(column, "name")).toList();
    if (!actualNames.equals(expectedColumns))
      throw ApiException.bad("Alias và thứ tự cột SELECT không khớp columns đã khai báo.");
    Map<String, Object> declaredTypes = Json.map(source.get("columnTypes"));
    for (Map<String, Object> column : actual)
      if (!compatible(
          Json.str(declaredTypes, Json.str(column, "name")), Json.str(column, "dataType")))
        throw ApiException.bad("Kiểu dữ liệu SELECT không tương thích columnTypes đã khai báo.");
    List<Map<String, Object>> rows = Json.objects(raw.get("rows"));
    if (Boolean.TRUE.equals(raw.get("truncated")))
      throw ApiException.bad("Nguồn vượt maxRows; tăng giới hạn có kiểm soát hoặc lọc query.");
    if (rows.stream().anyMatch(row -> PipelineService.invalidRow(row, source, expectedColumns)))
      throw ApiException.bad("Kết quả source vi phạm requiredColumns hoặc maxStringLengths.");
  }

  private void verifyTarget(
      Map<String, Object> warehouse,
      Map<String, Object> target,
      List<?> expectedColumns,
      Map<String, Object> declaredTypes) {
    Map<String, Object> writer = new LinkedHashMap<>(warehouse);
    writer.put("username", store.ingestionUsername(Json.str(warehouse, "warehouseId")));
    String schema = Json.str(target, "schema");
    String table = Json.str(target, "name");
    String username = store.ingestionUsername(Json.str(warehouse, "warehouseId"));
    String credentialReference = store.ingestionCredential(Json.str(warehouse, "warehouseId"));
    try (Connection connection =
        adapters.get(writer).connectForWrite(writer, adapters.password(credentialReference))) {
      Map<String, String> actual = new LinkedHashMap<>();
      try (var columns =
          connection
              .getMetaData()
              .getColumns(
                  Json.str(warehouse, "engine").equals("MYSQL") ? schema : connection.getCatalog(),
                  Json.str(warehouse, "engine").equals("MYSQL") ? null : schema,
                  table,
                  "%")) {
        while (columns.next())
          actual.put(columns.getString("COLUMN_NAME"), columns.getString("TYPE_NAME"));
      }
      Set<String> expected =
          expectedColumns.stream()
              .map(Object::toString)
              .collect(java.util.stream.Collectors.toSet());
      boolean typesMatch =
          expectedColumns.stream()
              .map(Object::toString)
              .allMatch(
                  column ->
                      actual.containsKey(column)
                          && compatible(Json.str(declaredTypes, column), actual.get(column)));
      if (!actual.keySet().equals(expected) || !typesMatch)
        throw new ApiException(
            HttpStatus.CONFLICT,
            "INGESTION_TARGET_MISMATCH",
            "Target table chưa tồn tại hoặc columns không khớp cấu hình.",
            Json.obj(
                "schema",
                schema,
                "table",
                table,
                "actualColumns",
                actual,
                "expectedColumns",
                expected));
    } catch (ApiException e) {
      throw e;
    } catch (SQLException e) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "INGESTION_TARGET_UNAVAILABLE",
          "Không thể kiểm tra target table bằng writer credential giới hạn.");
    }
  }

  static boolean compatible(String logical, String physical) {
    String type = physical.toUpperCase(Locale.ROOT);
    return switch (logical) {
      case "STRING" ->
          type.equals("STRING")
              || type.contains("CHAR")
              || type.contains("TEXT")
              || type.contains("CLOB");
      case "INTEGER" -> type.contains("INT") || type.equals("SMALLINT") || type.equals("BIGINT");
      case "DECIMAL" ->
          type.equals("INTEGER")
              || type.equals("BIGINT")
              || type.contains("DECIMAL")
              || type.contains("NUMERIC")
              || type.contains("FLOAT")
              || type.contains("DOUBLE")
              || type.equals("REAL");
      case "BOOLEAN" -> type.contains("BOOL") || type.equals("BIT");
      case "DATE" -> type.equals("DATE");
      case "TIMESTAMP" -> type.contains("TIMESTAMP") || type.contains("DATETIME");
      default -> false;
    };
  }

  private static List<String> columns(Map<String, Object> source) {
    Object configured = source.get("columns");
    if (!(configured instanceof List<?> values) || values.isEmpty() || values.size() > 100)
      throw ApiException.bad("Cần khai báo từ 1 đến 100 cột output.");
    List<String> columns = new ArrayList<>();
    Set<String> unique = new HashSet<>();
    for (Object value : values)
      if (!(value instanceof String column)
          || !column.matches("[A-Za-z_][A-Za-z0-9_]{0,62}")
          || !unique.add(column))
        throw ApiException.bad("Tên output column không hợp lệ hoặc trùng.");
      else columns.add(column);
    return columns;
  }

  private static int integer(
      Map<String, Object> source, String key, int fallback, int min, int max) {
    Object value = source.get(key);
    if (!(value instanceof Number number)
        || number.doubleValue() != number.intValue()
        || number.intValue() < min
        || number.intValue() > max) throw ApiException.bad("Giới hạn " + key + " không hợp lệ.");
    return number.intValue();
  }

  private void audit(String action, Map<String, Object> source) {
    store.audit(
        action,
        Json.str(source, "sourceId"),
        Json.obj(
            "warehouseId", source.get("warehouseId"),
            "datasetId", source.get("datasetId"),
            "sourceWarehouseId", source.get("sourceWarehouseId"),
            "sourceDatasetId", source.get("sourceDatasetId")));
  }
}

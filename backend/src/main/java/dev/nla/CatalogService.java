package dev.nla;

import dev.nla.warehouse.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {
  private final Store store;
  private final Adapters adapters;

  private record Snapshot(long at, List<Map<String, Object>> tables) {}

  private final Map<String, Snapshot> snapshots = new ConcurrentHashMap<>();

  public CatalogService(Store store, Adapters adapters) {
    this.store = store;
    this.adapters = adapters;
  }

  public List<Map<String, Object>> discover(String warehouseId, boolean fresh) {
    Map<String, Object> w = store.warehouse(warehouseId);
    if (Json.str(w, "status").equals("DISABLED"))
      throw new ApiException(
          HttpStatus.CONFLICT, "DATASET_UNAVAILABLE", "Warehouse đã bị vô hiệu hóa.");
    Snapshot cached = snapshots.get(warehouseId);
    if (!fresh && cached != null && System.currentTimeMillis() - cached.at < 15000)
      return cached.tables;
    var adapter = adapters.get(w);
    try (Connection connection =
        adapter.connect(w, adapters.password(store.credential(warehouseId)))) {
      // defaultSchema resolves unqualified SQL; access grants and Dataset allowlists
      // bound discovery. File imports may create tables in a separate writer namespace.
      Set<String> schemas = new HashSet<>(adapter.discoverSchemas(connection));
      var tables = adapter.discoverTables(connection, schemas);
      snapshots.put(warehouseId, new Snapshot(System.currentTimeMillis(), tables));
      return tables;
    } catch (SQLException e) {
      org.slf4j.LoggerFactory.getLogger(CatalogService.class)
          .warn(
              "Metadata failure engine={} SQLState={} vendorCode={} type={}",
              w.get("engine"),
              e.getSQLState(),
              e.getErrorCode(),
              e.getClass().getSimpleName());
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "WAREHOUSE_CONNECTION_ERROR",
          "Không kết nối được warehouse hoặc không đọc được metadata.");
    }
  }

  public List<Map<String, Object>> tables(String datasetId) {
    var d = store.dataset(datasetId);
    Set<String> allowed = new HashSet<>();
    Json.objects(d.get("allowedTables")).forEach(t -> allowed.add(key(t)));
    var list =
        discover(Json.str(d, "warehouseId"), false).stream()
            .filter(t -> allowed.contains(key(t)))
            .toList();
    if (list.size() != allowed.size()) {
      d.put("status", "INVALID_SCHEMA");
      store.updateDataset(d, store.semantic(datasetId));
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_MISMATCH",
          "Bảng được cấu hình không còn tồn tại trong warehouse.");
    }
    return list;
  }

  public List<Map<String, Object>> collection(String datasetId, String kind) {
    var sem = store.semantic(datasetId);
    if (kind.equals("tables")) return tables(datasetId);
    if (kind.equals("relationships")) {
      var allowed =
          tables(datasetId).stream()
              .map(CatalogService::key)
              .collect(java.util.stream.Collectors.toSet());
      var discovered =
          tables(datasetId).stream()
              .flatMap(t -> Json.objects(t.get("foreignKeys")).stream())
              .filter(rel -> allowed.contains(key(Json.map(Json.map(rel.get("to")).get("table")))))
              .toList();
      Map<String, Map<String, Object>> combined = new LinkedHashMap<>();
      for (var relation : discovered) combined.put(relationIdentity(relation), relation);
      for (var relation : Json.objects(sem.get("relationships"))) {
        if (allowed.contains(key(Json.map(Json.map(relation.get("from")).get("table"))))
            && allowed.contains(key(Json.map(Json.map(relation.get("to")).get("table")))))
          combined.put(relationIdentity(relation), relation);
      }
      return new ArrayList<>(combined.values());
    }
    if (!Set.of("metrics", "dimensions", "examples").contains(kind)) throw ApiException.notFound();
    return Json.objects(sem.get(kind));
  }

  public Map<String, Object> context(String datasetId) {
    var sem = new LinkedHashMap<>(store.semantic(datasetId));
    var physical = tables(datasetId);
    validateSemantic(sem, physical);
    sem.put("tables", physical);
    sem.put("relationships", collection(datasetId, "relationships"));
    validateJoinCardinality(datasetId, sem);
    sem.put("referenceTime", java.time.Instant.now().toString());
    return sem;
  }

  public void validateSemantic(Map<String, Object> sem, List<Map<String, Object>> tables) {
    Map<String, Set<String>> fields = new HashMap<>();
    for (var t : tables)
      fields.put(
          key(t),
          Json.objects(t.get("columns")).stream()
              .map(c -> Json.str(c, "name"))
              .collect(java.util.stream.Collectors.toSet()));
    Set<String> endpoints = new HashSet<>();
    for (var relation : Json.objects(sem.get("relationships"))) {
      String identity = relationIdentity(relation);
      if (!endpoints.add(identity))
        throw new ApiException(
            HttpStatus.CONFLICT, "SEMANTIC_MODEL_INVALID", "Join bị khai báo lặp hoặc mâu thuẫn.");
      if (!Set.of("ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY")
          .contains(Json.str(relation, "cardinality")))
        throw ApiException.bad("Cardinality không hợp lệ.");
      for (String side : List.of("from", "to")) {
        var endpoint = Json.map(relation.get(side));
        if (!fields
            .getOrDefault(key(Json.map(endpoint.get("table"))), Set.of())
            .contains(Json.str(endpoint, "column")))
          throw new ApiException(
              HttpStatus.CONFLICT, "SEMANTIC_MODEL_INVALID", "Join tham chiếu cột ngoài dataset.");
      }
    }
    for (var d : Json.objects(sem.get("dimensions")))
      if (!fields
          .getOrDefault(key(Json.map(d.get("table"))), Set.of())
          .contains(Json.str(d, "column")))
        throw new ApiException(
            HttpStatus.CONFLICT, "SEMANTIC_MODEL_INVALID", "Dimension không khớp metadata vật lý.");
    Set<String> dimensionNames =
        Json.objects(sem.get("dimensions")).stream()
            .map(d -> Json.str(d, "name"))
            .collect(java.util.stream.Collectors.toSet());
    for (var m : Json.objects(sem.get("metrics"))) {
      if (Json.objects(m.get("tableRefs")).stream().anyMatch(t -> !fields.containsKey(key(t))))
        throw new ApiException(
            HttpStatus.CONFLICT, "SEMANTIC_MODEL_INVALID", "Metric tham chiếu bảng ngoài dataset.");
      Object dimensions = m.get("compatibleDimensions");
      if (!(dimensions instanceof List<?> names) || !dimensionNames.containsAll(names))
        throw new ApiException(
            HttpStatus.CONFLICT, "SEMANTIC_MODEL_INVALID", "Compatible dimensions không hợp lệ.");
      String expression = Json.str(m, "expression");
      try {
        net.sf.jsqlparser.parser.CCJSqlParserUtil.parseExpression(expression);
      } catch (Exception e) {
        throw new ApiException(
            HttpStatus.CONFLICT, "SEMANTIC_MODEL_INVALID", "Biểu thức metric không hợp lệ.");
      }
    }
  }

  private static String relationIdentity(Map<String, Object> relation) {
    var from = Json.map(relation.get("from"));
    var to = Json.map(relation.get("to"));
    String left = key(Json.map(from.get("table"))) + "." + Json.str(from, "column");
    String right = key(Json.map(to.get("table"))) + "." + Json.str(to, "column");
    return left.compareTo(right) < 0 ? left + "|" + right : right + "|" + left;
  }

  public void validateJoinCardinality(String datasetId, Map<String, Object> semantic) {
    if (Json.objects(semantic.get("relationships")).isEmpty()) return;
    var dataset = store.dataset(datasetId);
    var warehouse = store.warehouse(Json.str(dataset, "warehouseId"));
    var adapter = adapters.get(warehouse);
    var physical = tables(datasetId);
    Set<String> verified = new HashSet<>();
    long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
    int scanned = 0;
    for (var relation : Json.objects(semantic.get("relationships"))) {
      String cardinality = Json.str(relation, "cardinality");
      List<String> uniqueSides =
          switch (cardinality) {
            case "MANY_TO_ONE" -> List.of("to");
            case "ONE_TO_MANY" -> List.of("from");
            case "ONE_TO_ONE" -> List.of("from", "to");
            default -> List.of();
          };
      for (String side : uniqueSides) {
        var endpoint = Json.map(relation.get(side));
        var table = Json.map(endpoint.get("table"));
        String column = Json.str(endpoint, "column");
        String identity = key(table) + "." + column;
        if (!verified.add(identity)) continue;
        var actual =
            physical.stream()
                .filter(item -> key(item).equals(key(table)))
                .findFirst()
                .orElseThrow(() -> ApiException.bad("Join nằm ngoài dataset."));
        if (List.of(column).equals(actual.get("primaryKey"))) continue;
        // A declared one-side is a data invariant, not an unchecked UI assertion.
        // Verify it again for query context if physical constraints do not prove it.
        long remaining =
            java.util.concurrent.TimeUnit.NANOSECONDS.toSeconds(deadline - System.nanoTime());
        if (++scanned > 8 || remaining < 1)
          throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "SEMANTIC_MODEL_INVALID",
              "Không thể chứng minh cardinality trong ngân sách kiểm tra; bổ sung khóa vật lý hoặc"
                  + " giảm quan hệ chưa có ràng buộc.");
        String identifier = adapter.quoteIdentifier(column);
        String sql =
            "SELECT "
                + identifier
                + " FROM "
                + adapter.quoteIdentifier(Json.str(table, "schema"))
                + "."
                + adapter.quoteIdentifier(Json.str(table, "name"))
                + " WHERE "
                + identifier
                + " IS NOT NULL GROUP BY "
                + identifier
                + " HAVING COUNT(*) > 1";
        try {
          var result =
              adapter.executeReadOnlyQuery(
                  warehouse,
                  adapters.password(store.credential(Json.str(warehouse, "warehouseId"))),
                  adapter.applySafeLimit(sql, 1),
                  1,
                  1024,
                  QueryDeadline.seconds((int) Math.min(3, remaining)));
          if (!Json.objects(result.get("rows")).isEmpty())
            throw new ApiException(
                HttpStatus.CONFLICT,
                "SEMANTIC_MODEL_INVALID",
                "Cardinality không khớp dữ liệu: phía khai báo duy nhất có giá trị trùng.");
        } catch (SQLException exception) {
          throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "SEMANTIC_MODEL_INVALID",
              "Không kiểm chứng được cardinality trong giới hạn an toàn; kiểm tra khóa hoặc định"
                  + " nghĩa join.");
        }
      }
    }
  }

  public Map<String, Object> summary(String id) {
    var d = store.dataset(id);
    var tables = tables(id);
    var metrics = collection(id, "metrics");
    var dims = collection(id, "dimensions");
    var examples = collection(id, "examples");
    return Json.obj(
        "datasetId",
        id,
        "semanticVersion",
        d.get("semanticVersion"),
        "schemaVersion",
        d.get("schemaVersion"),
        "tableCount",
        tables.size(),
        "metricCount",
        metrics.size(),
        "dimensionCount",
        dims.size(),
        "relationshipCount",
        collection(id, "relationships").size(),
        "exampleCount",
        examples.size(),
        "tableCategories",
        categories(tables),
        "metricCategories",
        categories(metrics),
        "exampleCategories",
        categories(examples));
  }

  static List<Map<String, Object>> categories(List<Map<String, Object>> items) {
    var counts = new TreeMap<String, Long>();
    items.stream()
        .map(i -> Json.str(i, "category"))
        .filter(s -> !s.isBlank())
        .forEach(s -> counts.merge(s, 1L, Long::sum));
    return counts.entrySet().stream()
        .map(e -> Json.obj("name", e.getKey(), "count", e.getValue()))
        .toList();
  }

  static String key(Map<String, Object> table) {
    return Json.str(table, "schema") + "." + Json.str(table, "name");
  }
}

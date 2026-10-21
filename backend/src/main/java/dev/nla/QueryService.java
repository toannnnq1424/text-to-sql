package dev.nla;

import dev.nla.warehouse.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class QueryService {
  private final Store store;
  private final CatalogService catalog;
  private final Adapters adapters;
  private final SqlGuard guard;
  private final AiClient ai;
  private final SemanticPlannerClient planner;
  private final ModelProviderService providers;

  public QueryService(
      Store s,
      CatalogService c,
      Adapters a,
      SqlGuard g,
      AiClient ai,
      SemanticPlannerClient planner,
      ModelProviderService providers) {
    store = s;
    catalog = c;
    adapters = a;
    guard = g;
    this.ai = ai;
    this.planner = planner;
    this.providers = providers;
  }

  public Map<String, Object> run(Map<String, Object> b) {
    return runPrepared(b, null);
  }

  public Map<String, Object> runSemantic(String datasetId, Map<String, Object> selection) {
    RegistryController.fields(selection, Set.of("metrics", "dimensions", "filters", "limit"));
    for (String key : List.of("metrics", "dimensions")) {
      if (!(selection.get(key) instanceof List<?> names)
          || names.stream().anyMatch(value -> !(value instanceof String text) || text.isBlank())
          || names.size() > (key.equals("metrics") ? 10 : 5)
          || (key.equals("metrics") && names.isEmpty())
          || new HashSet<>(names).size() != names.size())
        throw ApiException.bad("Metrics/dimensions không hợp lệ hoặc trùng tên.");
    }
    if (!(selection.get("filters") instanceof List<?> filters) || filters.size() > 10)
      throw ApiException.bad("Bộ lọc tối đa 10 điều kiện.");
    Object limit = selection.get("limit");
    if (!(limit instanceof Integer count) || count < 1 || count > 1000)
      throw ApiException.bad("Giới hạn kết quả phải là số nguyên từ 1 đến 1000.");
    var dataset = store.dataset(datasetId);
    String label =
        "Phân tích: "
            + String.join(
                ", ",
                ((List<?>) selection.getOrDefault("metrics", List.of()))
                    .stream().map(Object::toString).toList());
    return runPrepared(
        Json.obj(
            "warehouseId",
            dataset.get("warehouseId"),
            "datasetId",
            datasetId,
            "question",
            label,
            "mode",
            "SEMANTIC"),
        selection);
  }

  private Map<String, Object> runPrepared(Map<String, Object> b, Map<String, Object> selection) {
    RegistryController.fields(
        b, Set.of("warehouseId", "datasetId", "question", "mode", "providerId"));
    RegistryController.required(b, "warehouseId", "datasetId", "question");
    String question = Json.str(b, "question").strip();
    if (question.codePointCount(0, question.length()) > 1000)
      throw ApiException.bad("Câu hỏi tối đa 1000 ký tự.");
    String mode = Json.str(b, "mode");
    if (mode.isBlank()) mode = "AUTO";
    if (!Set.of("AUTO", "API", "DETERMINISTIC", "SEMANTIC").contains(mode)
        || (mode.equals("SEMANTIC") && selection == null))
      throw ApiException.bad("Mode không hợp lệ.");
    if (b.containsKey("providerId")
        && (!"API".equals(mode)
            || !(b.get("providerId") instanceof String providerId)
            || providerId.isBlank()
            || providerId.length() > 100))
      throw ApiException.bad("Chỉ chế độ API nhận providerId hợp lệ; AUTO dùng provider mặc định.");
    var w = store.warehouse(Json.str(b, "warehouseId"));
    var d = store.dataset(Json.str(b, "datasetId"));
    if (!w.get("warehouseId").equals(d.get("warehouseId")))
      throw ApiException.bad("Dataset không thuộc warehouse.");
    if (!Json.str(w, "status").equals("ACTIVE") || !Json.str(d, "status").equals("ACTIVE"))
      throw new ApiException(
          HttpStatus.CONFLICT, "DATASET_UNAVAILABLE", "Warehouse hoặc dataset không hoạt động.");
    String id = Json.id("qry"), now = Instant.now().toString();
    long start = System.nanoTime();
    var q =
        Json.obj(
            "queryId",
            id,
            "correlationId",
            Errors.correlation(),
            "warehouseId",
            w.get("warehouseId"),
            "datasetId",
            d.get("datasetId"),
            "engine",
            w.get("engine"),
            "question",
            question,
            "status",
            "RUNNING",
            "model",
            null,
            "provider",
            null,
            "executionMode",
            mode.equals("DETERMINISTIC")
                ? "DETERMINISTIC"
                : mode.equals("SEMANTIC") ? "SEMANTIC" : "API",
            "semanticVersion",
            d.get("semanticVersion"),
            "schemaVersion",
            d.get("schemaVersion"),
            "latencyMs",
            null,
            "createdAt",
            now,
            "completedAt",
            null,
            "generatedSql",
            null,
            "sqlDialect",
            w.get("engine"),
            "explanation",
            null,
            "assumptions",
            List.of(),
            "selectedMetrics",
            List.of(),
            "selectedDimensions",
            List.of(),
            "sourceTables",
            List.of(),
            "result",
            null,
            "chart",
            null,
            "error",
            null,
            "owner",
            store.actor());
    store.putQuery(q);
    QueryDeadline.start();
    try {
      var context = catalog.context(Json.str(d, "datasetId"));
      var request =
          Json.obj(
              "correlationId",
              Json.str(q, "correlationId"),
              "warehouseId",
              w.get("warehouseId"),
              "datasetId",
              d.get("datasetId"),
              "sqlDialect",
              w.get("engine"),
              "semanticContext",
              context);
      Map<String, Object> candidate;
      if (selection == null) {
        request.put("question", question);
        if (!"DETERMINISTIC".equals(mode)) {
          var provider =
              b.containsKey("providerId")
                  ? providers.select(Json.str(b, "providerId"))
                  : providers.selectDefault();
          q.put("provider", provider.snapshot());
          provider.apply(request);
        }
        candidate = ai.generate(request, mode);
      } else {
        request.put("selection", selection);
        candidate = ai.invoke("business-plan", request, 20);
      }
      q.put("model", candidate.get("model"));
      q.put("candidateSql", candidate.get("sql"));
      for (String field : List.of("selectedMetrics", "selectedDimensions")) {
        String category = field.equals("selectedMetrics") ? "metrics" : "dimensions";
        Set<String> names =
            Json.objects(context.get(category)).stream()
                .map(x -> Json.str(x, "name"))
                .collect(java.util.stream.Collectors.toSet());
        if (!names.containsAll((List<?>) candidate.get(field)))
          throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "SQL_VALIDATION_ERROR",
              "AI chọn metric hoặc dimension ngoài semantic context.");
      }
      var planned =
          planner.plan(
              Json.str(q, "correlationId"),
              Json.str(w, "engine"),
              Json.str(candidate, "sql"),
              context);
      q.put("generatedSql", planned.sql());
      var validated =
          guard.validate(
              planned.sql(), Json.str(w, "engine"), catalog.tables(Json.str(d, "datasetId")));
      q.put("generatedSql", validated.sql());
      Set<String> plannedSources =
          planned.sourceTables().stream()
              .map(SemanticPlannerClient::sourceKey)
              .collect(java.util.stream.Collectors.toSet());
      Set<String> guardedSources =
          validated.sourceTables().stream()
              .map(SemanticPlannerClient::sourceKey)
              .collect(java.util.stream.Collectors.toSet());
      if (!plannedSources.equals(guardedSources))
        throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "SQL_VALIDATION_ERROR",
            "Nguồn vật lý của SQL candidate không khớp với semantic planner.");
      q.put("sourceTables", validated.sourceTables());
      var limits = Json.map(store.settings().get("limits"));
      var result =
          adapters
              .get(w)
              .executeReadOnlyQuery(
                  w,
                  adapters.password(store.credential(Json.str(w, "warehouseId"))),
                  validated.sql(),
                  ((Number) limits.get("maxRows")).intValue(),
                  ((Number) limits.get("maxBytes")).intValue(),
                  QueryDeadline.seconds(
                      Math.max(1, ((Number) limits.get("statementTimeoutMs")).intValue() / 1000)));
      ResultPresentation.annotate(result, context, candidate);
      q.put("result", result);
      q.put("chart", chart(candidate.get("chartRecommendation"), result));
      q.put("explanation", candidate.get("explanation"));
      q.put("assumptions", candidate.get("assumptions"));
      q.put("selectedMetrics", candidate.get("selectedMetrics"));
      q.put("selectedDimensions", candidate.get("selectedDimensions"));
      q.put("status", "SUCCESS");
    } catch (ApiException e) {
      q.put(
          "status",
          e.code.equals("SQL_SECURITY_ERROR")
                  || Set.of("UNSUPPORTED_QUESTION", "INSUFFICIENT_CONTEXT", "LOW_CONFIDENCE")
                      .contains(e.code)
              ? "REJECTED"
              : e.code.equals("QUERY_TIMEOUT")
                  ? "TIMEOUT"
                  : Set.of(
                              "SQL_VALIDATION_ERROR",
                              "SQL_DIALECT_ERROR",
                              "SEMANTIC_MODEL_INVALID",
                              "SCHEMA_MISMATCH")
                          .contains(e.code)
                      ? "VALIDATION_ERROR"
                      : "QUERY_ERROR");
      q.put("error", Errors.body(e.code, e.getMessage(), Json.obj("queryId", id)));
    } catch (SQLException e) {
      boolean timeout = e instanceof SQLTimeoutException || "57014".equals(e.getSQLState());
      q.put("status", timeout ? "TIMEOUT" : "QUERY_ERROR");
      q.put(
          "error",
          Errors.body(
              timeout ? "QUERY_TIMEOUT" : "QUERY_ERROR",
              timeout
                  ? "Truy vấn hết thời gian xử lý."
                  : "Không thực thi được truy vấn trên warehouse.",
              Json.obj("queryId", id)));
    } catch (Exception e) {
      q.put("status", "QUERY_ERROR");
      q.put(
          "error",
          Errors.body("QUERY_ERROR", "Không xử lý được truy vấn.", Json.obj("queryId", id)));
    } finally {
      QueryDeadline.clear();
    }
    q.put("completedAt", Instant.now().toString());
    q.put("latencyMs", (System.nanoTime() - start) / 1000000);
    store.putQuery(q);
    store.audit("QUERY_" + q.get("status"), id);
    return publicQuery(q);
  }

  public Map<String, Object> stored(String id) {
    var q = store.get("query_history", id);
    store.authorize(Json.str(q, "warehouseId"));
    if (!store.admin()
        && !Json.str(q, "owner").equals(store.actor())
        && !store.actor().equals("anonymousUser"))
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Không có quyền xem truy vấn.");
    return q;
  }

  public Map<String, Object> get(String id) {
    return publicQuery(stored(id));
  }

  public Map<String, Object> publicQuery(Map<String, Object> stored) {
    var q = new LinkedHashMap<>(stored);
    q.remove("owner");
    q.putIfAbsent("candidateSql", null);
    q.putIfAbsent("provider", null);
    if (q.get("result") != null) {
      var full = Json.map(q.get("result"));
      var page = new LinkedHashMap<>(full);
      page.put("rows", Json.objects(full.get("rows")).stream().limit(20).toList());
      page.put("pageSize", 20);
      q.put("result", page);
    }
    return q;
  }

  public Map<String, Object> result(String id, Map<String, String> p) {
    var q = stored(id);
    if (Instant.parse(Json.str(q, "createdAt")).isBefore(Instant.now().minus(Duration.ofHours(24))))
      throw new ApiException(HttpStatus.GONE, "RESULT_EXPIRED", "Snapshot đã hết hạn lưu trữ.");
    var full = Json.map(q.get("result"));
    if (full.isEmpty())
      throw new ApiException(HttpStatus.CONFLICT, "QUERY_ERROR", "Query không có snapshot.");
    int page = Page.number(p, "page", 1, 1000000), size = Page.number(p, "pageSize", 20, 100);
    var rows = Json.objects(full.get("rows"));
    String search = p.getOrDefault("search", "").toLowerCase(Locale.ROOT);
    rows =
        rows.stream()
            .filter(row -> Json.write(row).toLowerCase(Locale.ROOT).contains(search))
            .toList();
    if (p.containsKey("sort") && !p.get("sort").isBlank()) {
      String sort = p.get("sort");
      var col =
          Json.objects(full.get("columns")).stream()
              .filter(c -> sort.equals(c.get("name")))
              .findFirst()
              .orElseThrow(() -> ApiException.bad("Cột sort không hợp lệ."));
      Comparator<Map<String, Object>> cmp =
          (a, b) -> {
            Object x = a.get(sort), y = b.get(sort);
            if (x == null) return y == null ? 0 : 1;
            if (y == null) return -1;
            if (Set.of("INTEGER", "BIGINT", "DECIMAL", "FLOAT").contains(col.get("dataType")))
              return new java.math.BigDecimal(x.toString())
                  .compareTo(new java.math.BigDecimal(y.toString()));
            return x.toString().compareTo(y.toString());
          };
      String direction = p.getOrDefault("direction", "ASC");
      if (!Set.of("ASC", "DESC").contains(direction))
        throw ApiException.bad("Direction không hợp lệ.");
      if (direction.equals("DESC")) cmp = cmp.reversed();
      rows = rows.stream().sorted(cmp).toList();
    }
    var result = new LinkedHashMap<>(full);
    result.put("rows", rows.stream().skip((long) (page - 1) * size).limit(size).toList());
    result.put("page", page);
    result.put("pageSize", size);
    result.put("returnedRowCount", rows.size());
    return result;
  }

  public List<Map<String, Object>> history() {
    return store.all("query_history").stream()
        .filter(
            q -> {
              try {
                stored(Json.str(q, "queryId"));
                return true;
              } catch (ApiException e) {
                return false;
              }
            })
        .map(
            q -> {
              var out = new LinkedHashMap<>(q);
              for (String key :
                  List.of(
                      "generatedSql",
                      "candidateSql",
                      "result",
                      "chart",
                      "error",
                      "owner",
                      "assumptions",
                      "sourceTables",
                      "selectedMetrics",
                      "selectedDimensions",
                      "explanation",
                      "completedAt",
                      "sqlDialect")) out.remove(key);
              out.put(
                  "rowCount",
                  q.get("result") == null
                      ? null
                      : Json.map(q.get("result")).get("returnedRowCount"));
              return (Map<String, Object>) out;
            })
        .toList();
  }

  static Map<String, Object> chart(Object raw, Map<String, Object> result) {
    return ResultPresentation.choose(raw, result);
  }
}

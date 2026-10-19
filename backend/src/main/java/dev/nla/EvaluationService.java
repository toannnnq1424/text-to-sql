package dev.nla;

import dev.nla.warehouse.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class EvaluationService {
  private final Store store;
  private final QueryService queries;
  private final Adapters adapters;
  private final SqlGuard guard;
  private final CatalogService catalog;

  public EvaluationService(Store s, QueryService q, Adapters a, SqlGuard g, CatalogService c) {
    store = s;
    queries = q;
    adapters = a;
    guard = g;
    catalog = c;
  }

  public List<Map<String, Object>> suites() {
    return List.of(
        Json.obj(
            "suiteId",
            "chinook-core",
            "name",
            "Chinook bilingual safety and result equivalence",
            "version",
            "1.0.0",
            "caseCount",
            48,
            "engines",
            List.of("POSTGRESQL", "MYSQL", "SQL_SERVER")));
  }

  public Map<String, Object> run(Map<String, Object> b) {
    RegistryController.fields(b, Set.of("warehouseId", "datasetId", "suiteId", "mode"));
    RegistryController.required(b, "warehouseId", "datasetId", "suiteId", "mode");
    if (!"chinook-core".equals(b.get("suiteId"))) throw ApiException.notFound();
    if (!Set.of("AUTO", "API", "DETERMINISTIC").contains(Json.str(b, "mode")))
      throw ApiException.bad("Mode không hợp lệ.");
    var w = store.warehouse(Json.str(b, "warehouseId"));
    var d = store.dataset(Json.str(b, "datasetId"));
    if (!w.get("warehouseId").equals(d.get("warehouseId")))
      throw ApiException.bad("Dataset không thuộc warehouse.");
    String engine = Json.str(w, "engine"),
        suffix =
            Map.of("POSTGRESQL", "postgresql", "MYSQL", "mysql", "SQL_SERVER", "mssql").get(engine);
    Map<String, Object> suite;
    try {
      suite =
          Json.read(
              Files.readString(
                  Path.of(
                      System.getProperty("nla.data.root", "../data"),
                      "chinook",
                      "evaluation-" + suffix + ".json")));
    } catch (Exception e) {
      throw new IllegalStateException("Evaluation corpus unavailable");
    }
    var cases = Json.objects(suite.get("cases"));
    String id = Json.id("eval");
    var run =
        Json.obj(
            "runId",
            id,
            "warehouseId",
            w.get("warehouseId"),
            "datasetId",
            d.get("datasetId"),
            "engine",
            engine,
            "model",
            null,
            "status",
            "RUNNING",
            "createdAt",
            Instant.now().toString(),
            "completedAt",
            null,
            "metrics",
            metrics(cases.size(), List.of()));
    store.run(id, "EVALUATION", run);
    var results = new ArrayList<Map<String, Object>>();
    for (var test : cases) {
      String resultId = Json.id("case");
      boolean reject = Boolean.TRUE.equals(test.get("expectedRejection"));
      var result =
          Json.obj(
              "resultId",
              resultId,
              "caseId",
              test.get("caseId"),
              "runId",
              id,
              "warehouseId",
              w.get("warehouseId"),
              "datasetId",
              d.get("datasetId"),
              "engine",
              engine,
              "model",
              null,
              "question",
              test.get("question"),
              "difficulty",
              test.get("difficulty"),
              "sqlDialect",
              engine,
              "status",
              "ERROR",
              "expectedSql",
              test.get("expectedSql"),
              "generatedSql",
              null,
              "validationResult",
              null,
              "resultEquivalent",
              null,
              "chartMatch",
              null,
              "latencyMs",
              null,
              "failureReason",
              null,
              "actualResult",
              null,
              "expectedResult",
              null,
              "expectedRejection",
              reject,
              "executionSuccess",
              false);
      try {
        var actual =
            queries.run(
                Json.obj(
                    "warehouseId",
                    w.get("warehouseId"),
                    "datasetId",
                    d.get("datasetId"),
                    "question",
                    test.get("question"),
                    "mode",
                    b.get("mode")));
        result.put("model", actual.get("model"));
        if (actual.get("model") != null) run.put("model", actual.get("model"));
        result.put("generatedSql", actual.get("generatedSql"));
        result.put("latencyMs", actual.get("latencyMs"));
        result.put("validationResult", actual.get("status"));
        boolean success = "SUCCESS".equals(actual.get("status"));
        result.put("executionSuccess", success);
        if (reject) {
          boolean safe = "REJECTED".equals(actual.get("status"));
          result.put("status", safe ? "PASSED" : "FAILED");
          if (!safe) result.put("failureReason", "Expected rejection was not observed.");
        } else if (success) {
          String sql =
              guard
                  .validate(
                      Json.str(test, "expectedSql"),
                      engine,
                      catalog.tables(Json.str(d, "datasetId")))
                  .sql();
          var expected =
              adapters
                  .get(w)
                  .executeReadOnlyQuery(
                      w,
                      adapters.password(store.credential(Json.str(w, "warehouseId"))),
                      sql,
                      1000,
                      5242880,
                      15);
          var full = Json.map(queries.stored(Json.str(actual, "queryId")).get("result"));
          boolean equivalent = equivalent(expected, full);
          boolean chart =
              Objects.equals(
                  Json.str(Json.map(actual.get("chart")), "type"), Json.str(test, "expectedChart"));
          result.put("resultEquivalent", equivalent);
          result.put("chartMatch", chart);
          result.put("status", equivalent && chart ? "PASSED" : "FAILED");
          result.put("actualResult", snapshot(full));
          result.put("expectedResult", snapshot(expected));
          if (!equivalent)
            result.put(
                "failureReason", "Actual result differs from independently executed expected SQL.");
        } else {
          result.put("status", "FAILED");
          result.put("failureReason", Json.str(Json.map(actual.get("error")), "code"));
        }
      } catch (Exception e) {
        result.put("failureReason", "Case execution failed; inspect correlation in query history.");
      }
      results.add(result);
      store.run(resultId, "EVALUATION_CASE", result);
      run.put("metrics", metrics(cases.size(), results));
      store.run(id, "EVALUATION", run);
    }
    run.put(
        "status",
        results.stream().allMatch(r -> r.get("status").equals("PASSED")) ? "SUCCESS" : "PARTIAL");
    run.put("completedAt", Instant.now().toString());
    store.run(id, "EVALUATION", run);
    store.audit("EVALUATION_" + run.get("status"), id);
    return run;
  }

  static Map<String, Object> snapshot(Map<String, Object> full) {
    var out = new LinkedHashMap<>(full);
    out.put("rows", Json.objects(full.get("rows")).stream().limit(20).toList());
    out.put("page", 1);
    out.put("pageSize", 20);
    return out;
  }

  public static boolean equivalent(Map<String, Object> a, Map<String, Object> b) {
    var ac = Json.objects(a.get("columns"));
    var bc = Json.objects(b.get("columns"));
    if (!ac.stream()
        .map(c -> c.get("name"))
        .toList()
        .equals(bc.stream().map(c -> c.get("name")).toList())) return false;
    return canonicalRows(a).equals(canonicalRows(b))
        && Objects.equals(a.get("truncated"), b.get("truncated"));
  }

  private static List<String> canonicalRows(Map<String, Object> r) {
    return Json.objects(r.get("rows")).stream()
        .map(
            row -> {
              var canonical = new TreeMap<String, Object>();
              for (var entry : row.entrySet()) {
                Object v = entry.getValue();
                if (v instanceof Number
                    || v instanceof String && v.toString().matches("-?\\d+(\\.\\d+)?"))
                  try {
                    v = new java.math.BigDecimal(v.toString()).stripTrailingZeros().toPlainString();
                  } catch (Exception ignored) {
                  }
                canonical.put(entry.getKey(), v);
              }
              return Json.write(canonical);
            })
        .sorted()
        .toList();
  }

  private static Map<String, Object> metrics(int total, List<Map<String, Object>> results) {
    var valid =
        results.stream().filter(r -> !Boolean.TRUE.equals(r.get("expectedRejection"))).toList();
    var invalid =
        results.stream().filter(r -> Boolean.TRUE.equals(r.get("expectedRejection"))).toList();
    var executed =
        valid.stream().filter(r -> Boolean.TRUE.equals(r.get("executionSuccess"))).toList();
    long equivalence =
        executed.stream().filter(r -> Boolean.TRUE.equals(r.get("resultEquivalent"))).count();
    long rejected = invalid.stream().filter(r -> r.get("status").equals("PASSED")).count();
    long[] latency =
        results.stream()
            .map(r -> r.get("latencyMs"))
            .filter(Number.class::isInstance)
            .map(Number.class::cast)
            .mapToLong(Number::longValue)
            .sorted()
            .toArray();
    return Json.obj(
        "totalCases",
        total,
        "completedCases",
        results.size(),
        "executionSuccessRate",
        valid.isEmpty() ? null : (double) executed.size() / valid.size(),
        "resultEquivalenceRate",
        executed.isEmpty() ? null : (double) equivalence / executed.size(),
        "invalidSqlRejectionRate",
        invalid.isEmpty() ? null : (double) rejected / invalid.size(),
        "dialectAccuracy",
        valid.isEmpty()
            ? null
            : (double)
                    valid.stream()
                        .filter(r -> Boolean.TRUE.equals(r.get("executionSuccess")))
                        .count()
                / valid.size(),
        "avgLatencyMs",
        latency.length == 0 ? null : Math.round(Arrays.stream(latency).average().orElse(0)),
        "p95LatencyMs",
        latency.length == 0 ? null : latency[(int) Math.ceil(latency.length * .95) - 1],
        "denominators",
        Json.obj(
            "validQuestions",
            valid.size(),
            "executedQueries",
            executed.size(),
            "unsafeQuestions",
            invalid.size()));
  }
}

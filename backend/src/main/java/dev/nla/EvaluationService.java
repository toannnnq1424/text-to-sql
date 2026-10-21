package dev.nla;

import dev.nla.warehouse.*;
import jakarta.annotation.PreDestroy;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.MDC;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
public class EvaluationService {
  private final Store store;
  private final QueryService queries;
  private final Adapters adapters;
  private final SqlGuard guard;
  private final CatalogService catalog;
  private final EvaluationCorpus corpus;
  private volatile boolean stopping;
  private final ThreadPoolExecutor workers =
      new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));

  @PreDestroy
  public void stop() {
    stopping = true;
    workers.shutdownNow();
  }

  @EventListener(ApplicationReadyEvent.class)
  public void recover() {
    var interrupted =
        store
            .jdbc()
            .query(
                "SELECT document::text FROM operation_run WHERE kind='EVALUATION' AND"
                    + " document->>'status'='RUNNING'",
                (row, index) -> Json.read(row.getString(1)));
    for (var run : interrupted) {
      run.put("status", "FAILED");
      run.put("completedAt", Instant.now().toString());
      run.put(
          "error",
          Errors.body(
              "EVALUATION_INTERRUPTED",
              "Dịch vụ đã khởi động lại khi đánh giá đang chạy; kết quả đã lưu được giữ nguyên và"
                  + " không tự gọi lại model.",
              Json.obj()));
      store.run(Json.str(run, "runId"), "EVALUATION", run);
    }
  }

  public EvaluationService(
      Store s, QueryService q, Adapters a, SqlGuard g, CatalogService c, EvaluationCorpus corpus) {
    store = s;
    queries = q;
    adapters = a;
    guard = g;
    catalog = c;
    this.corpus = corpus;
  }

  public List<Map<String, Object>> suites(String datasetId) {
    var summaries = corpus.summaries();
    if (datasetId == null || datasetId.isBlank()) return summaries;
    var dataset = store.dataset(datasetId);
    var warehouse = store.warehouse(Json.str(dataset, "warehouseId"));
    String engine = Json.str(warehouse, "engine");
    var tables = catalog.tables(datasetId);
    var result = new ArrayList<Map<String, Object>>();
    if (!tables.isEmpty())
      result.add(
          DatasetEvaluation.summary(
              dataset, engine, DatasetEvaluation.cases(tables, adapters.get(warehouse)).size()));
    for (var summary : summaries) {
      if (!((Collection<?>) summary.get("engines")).contains(engine)) continue;
      try {
        for (var item : corpus.cases(Json.str(summary, "suiteId"), engine))
          if (!Boolean.TRUE.equals(item.get("expectedRejection")))
            guard.validate(Json.str(item, "expectedSql"), engine, tables);
        var approved = new LinkedHashMap<>(summary);
        approved.put("origin", "PACKAGED_REGRESSION");
        approved.put(
            "description",
            "Bộ test tham chiếu được quản lý trên server, đã kiểm tra mọi bảng/cột với dataset hiện"
                + " tại. SQL mong đợi là oracle kiểm thử, không phải đáp án do AI sinh.");
        result.add(approved);
      } catch (ApiException incompatible) {
        // An unrelated suite cannot be offered merely because its dialect matches.
      }
    }
    return result;
  }

  public synchronized Map<String, Object> run(Map<String, Object> b) {
    RegistryController.fields(b, Set.of("warehouseId", "datasetId", "suiteId", "mode"));
    RegistryController.required(b, "warehouseId", "datasetId", "suiteId", "mode");
    if (!Set.of("AUTO", "API", "DETERMINISTIC").contains(Json.str(b, "mode")))
      throw ApiException.bad("Mode không hợp lệ.");
    var w = store.warehouse(Json.str(b, "warehouseId"));
    var d = store.dataset(Json.str(b, "datasetId"));
    if (!w.get("warehouseId").equals(d.get("warehouseId")))
      throw ApiException.bad("Dataset không thuộc warehouse.");
    String engine = Json.str(w, "engine");
    boolean schemaSuite = DatasetEvaluation.ID.equals(b.get("suiteId"));
    if (schemaSuite && "DETERMINISTIC".equals(b.get("mode")))
      throw ApiException.bad(
          "Kiểm tra schema hiện tại cần model API; deterministic chỉ khớp các ví dụ đã cấu hình.");
    var cases =
        schemaSuite
            ? DatasetEvaluation.cases(catalog.tables(Json.str(d, "datasetId")), adapters.get(w))
            : corpus.cases(Json.str(b, "suiteId"), engine);
    // Validate every expected statement against this authorized dataset before creating a run.
    var physical = catalog.tables(Json.str(d, "datasetId"));
    for (var test : cases)
      if (!Boolean.TRUE.equals(test.get("expectedRejection")))
        guard.validate(Json.str(test, "expectedSql"), engine, physical);
    if (cases.isEmpty()) throw ApiException.bad("Bộ đánh giá không có case hợp lệ.");
    if (workers.isShutdown() || workers.getQueue().remainingCapacity() == 0)
      throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          "EVALUATION_BUSY",
          "Hàng đợi đánh giá đang đầy; thử lại sau.");
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
    run.put("suiteId", b.get("suiteId"));
    run.put("referenceOrigin", schemaSuite ? "CURRENT_SCHEMA" : "PACKAGED_REGRESSION");
    run.put("error", null);
    store.run(id, "EVALUATION", run);
    var accepted = Json.read(Json.write(run));
    var input = Json.read(Json.write(b));
    var frozenCases = Json.objects(Json.read(Json.write(Json.obj("cases", cases))).get("cases"));
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    String correlation = Errors.correlation();
    workers.execute(
        () -> {
          var context = SecurityContextHolder.createEmptyContext();
          context.setAuthentication(authentication);
          SecurityContextHolder.setContext(context);
          MDC.put("correlationId", correlation);
          try {
            execute(input, w, d, frozenCases, run);
          } finally {
            SecurityContextHolder.clearContext();
            MDC.remove("correlationId");
          }
        });
    store.audit("EVALUATION_ACCEPTED", id);
    return accepted;
  }

  private void execute(
      Map<String, Object> b,
      Map<String, Object> w,
      Map<String, Object> d,
      List<Map<String, Object>> cases,
      Map<String, Object> run) {
    String id = Json.str(run, "runId");
    String engine = Json.str(run, "engine");
    long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(20);
    try {
      var results = new ArrayList<Map<String, Object>>();
      for (var test : cases) {
        if (stopping || Thread.currentThread().isInterrupted() || System.nanoTime() > deadline)
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT,
              "EVALUATION_TIMEOUT",
              "Tác vụ đánh giá đã dừng hoặc vượt thời gian cho phép.");
        var currentWarehouse = store.warehouse(Json.str(w, "warehouseId"));
        var currentDataset = store.dataset(Json.str(d, "datasetId"));
        if (!currentWarehouse.equals(w) || !currentDataset.equals(d))
          throw new ApiException(
              HttpStatus.CONFLICT,
              "EVALUATION_CONTEXT_CHANGED",
              "Warehouse hoặc cấu hình dataset đã thay đổi; không trộn các snapshot trong cùng một"
                  + " đánh giá.");
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
                    Json.str(Json.map(actual.get("chart")), "type"),
                    Json.str(test, "expectedChart"));
            result.put("resultEquivalent", equivalent);
            result.put("chartMatch", chart);
            result.put("status", equivalent && chart ? "PASSED" : "FAILED");
            result.put("actualResult", snapshot(full));
            result.put("expectedResult", snapshot(expected));
            if (!equivalent)
              result.put(
                  "failureReason",
                  "Actual result differs from independently executed expected SQL.");
            else if (!chart)
              result.put(
                  "failureReason",
                  "Result is equivalent, but chart type "
                      + Json.str(Json.map(actual.get("chart")), "type")
                      + " differs from expected "
                      + Json.str(test, "expectedChart")
                      + ".");
          } else {
            result.put("status", "FAILED");
            result.put("failureReason", Json.str(Json.map(actual.get("error")), "code"));
          }
        } catch (Exception e) {
          result.put(
              "failureReason", "Case execution failed; inspect correlation in query history.");
        }
        results.add(result);
        store.run(resultId, "EVALUATION_CASE", result);
        run.put("metrics", metrics(cases.size(), results));
        store.run(id, "EVALUATION", run);
      }
      if (stopping || Thread.currentThread().isInterrupted() || System.nanoTime() > deadline)
        throw new ApiException(
            HttpStatus.GATEWAY_TIMEOUT,
            "EVALUATION_INTERRUPTED",
            "Tác vụ đã dừng hoặc vượt thời gian; các kết quả đã lưu vẫn có thể xem trong lịch sử.");
      run.put(
          "status",
          results.stream().allMatch(r -> r.get("status").equals("PASSED")) ? "SUCCESS" : "PARTIAL");
      run.put("completedAt", Instant.now().toString());
      store.run(id, "EVALUATION", run);
      store.audit("EVALUATION_" + run.get("status"), id);
    } catch (Exception failure) {
      Thread.interrupted();
      run.put("status", "FAILED");
      run.put("completedAt", Instant.now().toString());
      run.put(
          "error",
          Errors.body(
              failure instanceof ApiException api ? api.code : "EVALUATION_ERROR",
              failure instanceof ApiException api
                  ? api.getMessage()
                  : "Đánh giá đã dừng; các case đã hoàn tất được lưu trong lịch sử.",
              Json.obj()));
      store.run(id, "EVALUATION", run);
      store.audit("EVALUATION_FAILED", id);
    }
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

package dev.nla;

import dev.nla.warehouse.Adapters;
import jakarta.annotation.PreDestroy;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DataQualityService {
  private static final String KIND = "DATA_QUALITY";
  private final Store store;
  private final CatalogService catalog;
  private final Adapters adapters;
  private final SqlGuard guard;
  private final ThreadPoolExecutor workers =
      new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));
  private volatile boolean stopping;
  private final long runNanos;
  private final ScheduledThreadPoolExecutor deadlines = new ScheduledThreadPoolExecutor(1);
  private final Map<String, Job> jobs = new ConcurrentHashMap<>();

  private static final class Job {
    final long deadline;
    volatile boolean expired;
    volatile Future<?> task;
    volatile ScheduledFuture<?> alarm;

    Job(long deadline) {
      this.deadline = deadline;
    }
  }

  @Autowired
  public DataQualityService(
      Store store, CatalogService catalog, Adapters adapters, SqlGuard guard) {
    this(store, catalog, adapters, guard, Duration.ofSeconds(120));
  }

  DataQualityService(
      Store store, CatalogService catalog, Adapters adapters, SqlGuard guard, Duration budget) {
    this.runNanos = budget.toNanos();
    this.deadlines.setRemoveOnCancelPolicy(true);
    this.store = store;
    this.catalog = catalog;
    this.adapters = adapters;
    this.guard = guard;
  }

  @PreDestroy
  public synchronized void stop() {
    stopping = true;
    workers.shutdownNow();
    deadlines.shutdownNow();
    jobs.clear();
    recoverInterrupted("Dịch vụ đã dừng; không tự chạy lại kiểm tra dữ liệu.");
  }

  @EventListener(ApplicationReadyEvent.class)
  public synchronized void recover() {
    recoverInterrupted("Dịch vụ đã khởi động lại; kết quả đã lưu được giữ và không tự chạy lại.");
  }

  private void recoverInterrupted(String message) {
    store
        .jdbc()
        .update(
            "UPDATE operation_run SET"
                + " document=jsonb_set(jsonb_set(jsonb_set(document,'{status}','\"ERROR\"'::jsonb),'{completedAt}',to_jsonb(?::text)),"
                + " '{error}',jsonb_set(?::jsonb,'{correlationId}',coalesce(document->'correlationId',to_jsonb('unavailable'::text))))"
                + " WHERE kind=? AND document->>'status'='RUNNING'",
            Instant.now().toString(),
            Json.write(Errors.body("QUALITY_INTERRUPTED", message, Json.obj())),
            KIND);
  }

  private synchronized void publish(Map<String, Object> run, Job job) {
    if ((job.expired || System.nanoTime() >= job.deadline) && !"ERROR".equals(run.get("status"))) {
      run.put("status", "ERROR");
      run.put("completedAt", Instant.now().toString());
      run.put(
          "error",
          Errors.body("QUALITY_TIMEOUT", "Tác vụ kiểm tra vượt giới hạn thời gian.", Json.obj()));
    }
    if (stopping && !"ERROR".equals(run.get("status"))) {
      run.put("status", "ERROR");
      run.put("completedAt", Instant.now().toString());
      run.put("error", Errors.body("QUALITY_INTERRUPTED", "Tác vụ kiểm tra đã dừng.", Json.obj()));
    }
    store.run(Json.str(run, "runId"), KIND, run);
  }

  private synchronized void expire(String id, Job job) {
    job.expired = true;
    store
        .jdbc()
        .update(
            "UPDATE operation_run SET"
                + " document=jsonb_set(jsonb_set(jsonb_set(document,'{status}','\"ERROR\"'::jsonb),'{completedAt}',to_jsonb(?::text)),"
                + " '{error}',jsonb_set(?::jsonb,'{correlationId}',coalesce(document->'correlationId',to_jsonb('unavailable'::text))))"
                + " WHERE id=? AND kind=? AND document->>'status'='RUNNING'",
            Instant.now().toString(),
            Json.write(
                Errors.body(
                    "QUALITY_TIMEOUT",
                    "Tác vụ kiểm tra vượt giới hạn thời gian chờ/chạy.",
                    Json.obj())),
            id,
            KIND);
    if (job.task != null) {
      job.task.cancel(true);
      if (job.task instanceof Runnable queued) workers.remove(queued);
    }
    jobs.remove(id, job);
  }

  private static void writeRole() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null
        || auth.getAuthorities().stream()
            .noneMatch(a -> Set.of("ROLE_ADMIN", "ROLE_OPERATOR").contains(a.getAuthority())))
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Cần quyền ADMIN hoặc OPERATOR.");
  }

  public Map<String, Object> rules(String datasetId) {
    store.dataset(datasetId);
    var rows =
        store
            .jdbc()
            .query(
                "SELECT revision,rules::text FROM data_quality_rules WHERE dataset_id=?",
                (row, index) ->
                    Json.obj(
                        "datasetId",
                        datasetId,
                        "revision",
                        Long.toString(row.getLong(1)),
                        "rules",
                        Json.read("{\"rules\":" + row.getString(2) + "}").get("rules")),
                datasetId);
    return rows.isEmpty()
        ? Json.obj("datasetId", datasetId, "revision", "0", "rules", List.of())
        : rows.getFirst();
  }

  @Transactional
  public Map<String, Object> save(String datasetId, Map<String, Object> body) {
    writeRole();
    RegistryController.fields(body, Set.of("revision", "rules"));
    if (!(body.get("revision") instanceof String revision)
        || !revision.matches("0|[1-9][0-9]{0,17}"))
      throw ApiException.bad("Revision phải là chuỗi số nguyên hiện tại.");
    active(datasetId);
    var checked = DataQualityRules.validate(body.get("rules"), catalog.tables(datasetId));
    store
        .jdbc()
        .update(
            "INSERT INTO data_quality_rules(dataset_id,revision,rules) VALUES (?,0,'[]'::jsonb) ON"
                + " CONFLICT(dataset_id) DO NOTHING",
            datasetId);
    long current =
        store
            .jdbc()
            .queryForObject(
                "SELECT revision FROM data_quality_rules WHERE dataset_id=? FOR UPDATE",
                Long.class,
                datasetId);
    if (!revision.equals(Long.toString(current)))
      throw new ApiException(
          HttpStatus.CONFLICT,
          "QUALITY_RULE_CONFLICT",
          "Quy tắc đã thay đổi; tải lại trước khi lưu.");
    long next = Math.addExact(current, 1);
    store
        .jdbc()
        .update(
            "UPDATE data_quality_rules SET revision=?,rules=?::jsonb,updated_at=now() WHERE"
                + " dataset_id=?",
            next,
            Json.write(checked),
            datasetId);
    store.audit(
        "QUALITY_RULES_SAVE",
        datasetId,
        Json.obj("revision", Long.toString(next), "ruleCount", checked.size()));
    return Json.obj("datasetId", datasetId, "revision", Long.toString(next), "rules", checked);
  }

  private Map<String, Object> active(String datasetId) {
    var dataset = store.dataset(datasetId);
    var warehouse = store.warehouse(Json.str(dataset, "warehouseId"));
    if (!"ACTIVE".equals(dataset.get("status")) || !"ACTIVE".equals(warehouse.get("status")))
      throw new ApiException(
          HttpStatus.CONFLICT, "DATASET_UNAVAILABLE", "Dataset/warehouse không hoạt động.");
    return dataset;
  }

  public synchronized Map<String, Object> run(String datasetId, Map<String, Object> body) {
    writeRole();
    RegistryController.fields(body, Set.of());
    var dataset = active(datasetId);
    var warehouse = store.warehouse(Json.str(dataset, "warehouseId"));
    var configuration = rules(datasetId);
    var physical = catalog.tables(datasetId);
    var selected =
        DataQualityRules.validate(configuration.get("rules"), physical).stream()
            .filter(rule -> Boolean.TRUE.equals(rule.get("enabled")))
            .toList();
    if (selected.isEmpty()) throw ApiException.bad("Cần ít nhất một quy tắc đang bật đã lưu.");
    if (stopping || workers.isShutdown() || workers.getQueue().remainingCapacity() == 0)
      throw busy();
    String id = Json.id("quality");
    var run =
        Json.obj(
            "runId",
            id,
            "datasetId",
            datasetId,
            "warehouseId",
            warehouse.get("warehouseId"),
            "sqlDialect",
            warehouse.get("engine"),
            "revision",
            configuration.get("revision"),
            "status",
            "RUNNING",
            "createdAt",
            Instant.now().toString(),
            "completedAt",
            null,
            "correlationId",
            Errors.correlation(),
            "consistency",
            "PER_CHECK",
            "checks",
            new ArrayList<>(),
            "error",
            null,
            "rules",
            selected);
    var job = new Job(System.nanoTime() + runNanos);
    store.run(id, KIND, run);
    jobs.put(id, job);
    var accepted = Json.read(Json.write(run));
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    try {
      job.task =
          workers.submit(
              () -> {
                var context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(authentication);
                SecurityContextHolder.setContext(context);
                MDC.put("correlationId", Json.str(run, "correlationId"));
                try {
                  execute(dataset, warehouse, selected, run, job);
                } finally {
                  SecurityContextHolder.clearContext();
                  MDC.remove("correlationId");
                }
              });
      job.alarm =
          deadlines.schedule(
              () -> expire(id, job),
              Math.max(0, job.deadline - System.nanoTime()),
              TimeUnit.NANOSECONDS);
      if (jobs.get(id) != job) job.alarm.cancel(false);
    } catch (RejectedExecutionException rejected) {
      jobs.remove(id, job);
      if (job.task != null) job.task.cancel(true);
      if (job.alarm != null) job.alarm.cancel(false);
      run.put("status", "ERROR");
      run.put("completedAt", Instant.now().toString());
      run.put(
          "error",
          Errors.body("QUALITY_BUSY", "Hàng đợi kiểm tra đang đầy; thử lại sau.", Json.obj()));
      store.run(id, KIND, run);
      throw busy();
    }
    store.audit(
        "QUALITY_RUN_ACCEPTED",
        id,
        Json.obj("datasetId", datasetId, "revision", configuration.get("revision")));
    return accepted;
  }

  private static ApiException busy() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE, "QUALITY_BUSY", "Hàng đợi kiểm tra đang đầy; thử lại sau.");
  }

  private void execute(
      Map<String, Object> dataset,
      Map<String, Object> warehouse,
      List<Map<String, Object>> rules,
      Map<String, Object> run,
      Job job) {
    long deadline = job.deadline;
    var checks = new ArrayList<Map<String, Object>>();
    run.put("checks", checks);
    Map<String, Object> currentCheck = null;
    long checkStarted = 0;
    try {
      for (var rule : rules) {
        if (job.expired)
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT,
              "QUALITY_TIMEOUT",
              "Tác vụ kiểm tra vượt giới hạn thời gian.");
        if (stopping || Thread.currentThread().isInterrupted())
          throw new ApiException(
              HttpStatus.SERVICE_UNAVAILABLE, "QUALITY_INTERRUPTED", "Tác vụ kiểm tra đã dừng.");
        long remaining = deadline - System.nanoTime();
        if (remaining < TimeUnit.SECONDS.toNanos(1))
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT,
              "QUALITY_TIMEOUT",
              "Tác vụ kiểm tra vượt giới hạn thời gian.");
        String datasetId = Json.str(dataset, "datasetId");
        var currentDataset = active(datasetId);
        var currentWarehouse = store.warehouse(Json.str(warehouse, "warehouseId"));
        if (!Objects.equals(dataset, currentDataset)
            || !Objects.equals(warehouse, currentWarehouse))
          throw new ApiException(
              HttpStatus.CONFLICT,
              "QUALITY_CONTEXT_CHANGED",
              "Cấu hình dataset/warehouse đã thay đổi khi đang kiểm tra.");
        var physical = catalog.tables(datasetId);
        DataQualityRules.validate(List.of(rule), physical);
        var adapter = adapters.get(currentWarehouse);
        String sql =
            guard.validate(DataQualityRules.sql(rule, adapter), adapter.engine(), physical).sql();
        currentCheck =
            Json.obj(
                "ruleId",
                rule.get("ruleId"),
                "name",
                rule.get("name"),
                "type",
                rule.get("type"),
                "table",
                rule.get("table"),
                "status",
                "ERROR",
                "checkedRows",
                null,
                "violations",
                null,
                "observedValue",
                null,
                "durationMs",
                0,
                "error",
                null);
        if (rule.containsKey("column")) currentCheck.put("column", rule.get("column"));
        checkStarted = System.nanoTime();
        remaining = deadline - System.nanoTime();
        if (remaining < TimeUnit.SECONDS.toNanos(1))
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT,
              "QUALITY_TIMEOUT",
              "Tác vụ kiểm tra vượt giới hạn thời gian.");
        int seconds = (int) Math.min(15, TimeUnit.NANOSECONDS.toSeconds(remaining));
        var result =
            adapter.executeReadOnlyQuery(
                currentWarehouse,
                adapters.password(store.credential(Json.str(currentWarehouse, "warehouseId"))),
                sql,
                1,
                16384,
                seconds);
        if (job.expired)
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT,
              "QUALITY_TIMEOUT",
              "Tác vụ kiểm tra vượt giới hạn thời gian.");
        if (stopping || Thread.currentThread().isInterrupted())
          throw new ApiException(
              HttpStatus.SERVICE_UNAVAILABLE, "QUALITY_INTERRUPTED", "Tác vụ kiểm tra đã dừng.");
        if (System.nanoTime() > deadline)
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT,
              "QUALITY_TIMEOUT",
              "Tác vụ kiểm tra vượt giới hạn thời gian.");
        currentCheck.putAll(DataQualityRules.counts(rule, result));
        currentCheck.put(
            "status", "0".equals(currentCheck.get("violations")) ? "PASSED" : "FAILED");
        currentCheck.put(
            "durationMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - checkStarted));
        checks.add(currentCheck);
        currentCheck = null;
        publish(run, job);
      }
      run.put(
          "status",
          checks.stream().allMatch(c -> "PASSED".equals(c.get("status"))) ? "PASSED" : "FAILED");
    } catch (Exception failure) {
      var error =
          job.expired
              ? Errors.body(
                  "QUALITY_TIMEOUT", "Tác vụ kiểm tra vượt giới hạn thời gian.", Json.obj())
              : stopping
                  ? Errors.body("QUALITY_INTERRUPTED", "Tác vụ kiểm tra đã dừng.", Json.obj())
                  : failure(failure);
      if (currentCheck != null) {
        currentCheck.put(
            "durationMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - checkStarted));
        currentCheck.put("error", error);
        checks.add(currentCheck);
      }
      run.put("status", "ERROR");
      run.put("error", error);
    } finally {
      run.put("completedAt", Instant.now().toString());
      publish(run, job);
      jobs.remove(Json.str(run, "runId"), job);
      if (job.alarm != null) job.alarm.cancel(false);
      store.audit(
          "QUALITY_RUN_COMPLETED",
          Json.str(run, "runId"),
          Json.obj("status", run.get("status"), "completedChecks", checks.size()));
    }
  }

  private static Map<String, Object> failure(Exception failure) {
    if (failure instanceof ApiException api)
      return Errors.body(api.code, api.getMessage(), Json.obj());
    if (failure instanceof SQLTimeoutException
        || (failure instanceof SQLException sql && "57014".equals(sql.getSQLState())))
      return Errors.body("QUALITY_TIMEOUT", "Warehouse vượt thời gian kiểm tra.", Json.obj());
    return Errors.body(
        "QUALITY_EXECUTION_ERROR",
        "Không thể hoàn thành kiểm tra trên warehouse; không tự thử lại.",
        Json.obj());
  }

  public Map<String, Object> get(String datasetId, String runId) {
    store.dataset(datasetId);
    var run = store.run(runId, KIND);
    if (!datasetId.equals(run.get("datasetId"))) throw ApiException.notFound();
    return run;
  }

  public Map<String, Object> runs(String datasetId, Map<String, String> parameters) {
    store.dataset(datasetId);
    if (!Set.of("page", "pageSize").containsAll(parameters.keySet()))
      throw ApiException.bad("Tham số lịch sử kiểm tra không hợp lệ.");
    int page = Page.number(parameters, "page", 1, 1000000);
    int size = Page.number(parameters, "pageSize", 20, 100);
    long count =
        store
            .jdbc()
            .queryForObject(
                "SELECT count(*) FROM operation_run WHERE kind=? AND document->>'datasetId'=?",
                Long.class,
                KIND,
                datasetId);
    var items =
        store
            .jdbc()
            .query(
                "SELECT document::text FROM operation_run WHERE kind=? AND document->>'datasetId'=?"
                    + " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
                (row, index) -> Json.read(row.getString(1)),
                KIND,
                datasetId,
                size,
                (long) (page - 1) * size);
    for (var item : items) store.authorize(Json.str(item, "warehouseId"));
    return Json.obj(
        "items",
        items,
        "page",
        page,
        "pageSize",
        size,
        "totalItems",
        count,
        "totalPages",
        (count + size - 1) / size);
  }
}

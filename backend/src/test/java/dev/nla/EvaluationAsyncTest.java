package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.WarehouseAdapter;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

class EvaluationAsyncTest {
  @Test
  void returnsPersistedRunBeforeModelCompletesAndPropagatesPrincipal() throws Exception {
    Store store = mock(Store.class);
    QueryService queries = mock(QueryService.class);
    CatalogService catalog = mock(CatalogService.class);
    EvaluationCorpus corpus = mock(EvaluationCorpus.class);
    var warehouse =
        Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL", "status", "ACTIVE");
    var dataset = Json.obj("warehouseId", "warehouse", "datasetId", "dataset", "status", "ACTIVE");
    when(store.warehouse("warehouse")).thenReturn(warehouse);
    when(store.dataset("dataset")).thenReturn(dataset);
    when(catalog.tables("dataset")).thenReturn(List.of());
    when(corpus.cases("configured", "POSTGRESQL"))
        .thenReturn(
            List.of(
                Json.obj(
                    "caseId",
                    "reject",
                    "question",
                    "Unsafe request",
                    "expectedRejection",
                    true,
                    "difficulty",
                    "EASY")));
    Map<String, Map<String, Object>> persisted = new ConcurrentHashMap<>();
    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch finished = new CountDownLatch(1);
    AtomicReference<String> principal = new AtomicReference<>();
    AtomicReference<String> mode = new AtomicReference<>();
    doAnswer(
            call -> {
              var document = Json.read(Json.write(call.getArgument(2)));
              persisted.put(call.getArgument(0), document);
              if ("EVALUATION".equals(call.getArgument(1))
                  && "SUCCESS".equals(document.get("status"))) finished.countDown();
              return null;
            })
        .when(store)
        .run(anyString(), anyString(), anyMap());
    when(queries.run(anyMap()))
        .thenAnswer(
            call -> {
              started.countDown();
              assertTrue(release.await(5, TimeUnit.SECONDS));
              principal.set(SecurityContextHolder.getContext().getAuthentication().getName());
              mode.set(Json.str(call.getArgument(0), "mode"));
              return Json.obj("status", "REJECTED", "model", "configured-model");
            });
    var context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(
        new UsernamePasswordAuthenticationToken(
            "scoped-operator", "unused", List.of(new SimpleGrantedAuthority("ROLE_OPERATOR"))));
    SecurityContextHolder.setContext(context);
    var service =
        new EvaluationService(
            store, queries, mock(Adapters.class), new SqlGuard(), catalog, corpus);
    try {
      var body =
          Json.obj(
              "warehouseId",
              "warehouse",
              "datasetId",
              "dataset",
              "suiteId",
              "configured",
              "mode",
              "API");
      long before = System.nanoTime();
      var accepted = service.run(body);
      assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - before) < 2000);
      assertEquals("RUNNING", accepted.get("status"));
      assertEquals(0, Json.map(accepted.get("metrics")).get("completedCases"));
      assertTrue(persisted.containsKey(accepted.get("runId")));
      assertTrue(started.await(2, TimeUnit.SECONDS));
      body.put("mode", "DETERMINISTIC");
      release.countDown();
      assertTrue(finished.await(5, TimeUnit.SECONDS));
      assertEquals("scoped-operator", principal.get());
      assertEquals("API", mode.get());
      assertEquals("SUCCESS", persisted.get(accepted.get("runId")).get("status"));
      assertEquals("RUNNING", accepted.get("status"));
      assertEquals(
          1, Json.map(persisted.get(accepted.get("runId")).get("metrics")).get("completedCases"));
    } finally {
      release.countDown();
      service.stop();
      SecurityContextHolder.clearContext();
    }
  }

  @Test
  void preservesEquivalentResultsAndExplainsChartMismatch() throws Exception {
    Store store = mock(Store.class);
    QueryService queries = mock(QueryService.class);
    CatalogService catalog = mock(CatalogService.class);
    EvaluationCorpus corpus = mock(EvaluationCorpus.class);
    Adapters adapters = mock(Adapters.class);
    WarehouseAdapter adapter = mock(WarehouseAdapter.class);
    SqlGuard guard = mock(SqlGuard.class);
    var warehouse = Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL");
    var dataset = Json.obj("warehouseId", "warehouse", "datasetId", "dataset");
    var data =
        Json.obj(
            "columns", List.of(Json.obj("name", "record_count")),
            "rows", List.of(Json.obj("record_count", "12")),
            "truncated", false);
    when(store.warehouse("warehouse")).thenReturn(warehouse);
    when(store.dataset("dataset")).thenReturn(dataset);
    when(store.credential("warehouse")).thenReturn("env:TEST_PASSWORD");
    when(adapters.password("env:TEST_PASSWORD")).thenReturn("test-only");
    when(adapters.get(warehouse)).thenReturn(adapter);
    when(catalog.tables("dataset")).thenReturn(List.of());
    when(guard.validate("SELECT COUNT(*) FROM readings", "POSTGRESQL", List.of()))
        .thenReturn(new SqlGuard.Validated("SELECT COUNT(*) FROM readings", List.of()));
    when(corpus.cases("configured", "POSTGRESQL"))
        .thenReturn(
            List.of(
                Json.obj(
                    "caseId",
                    "count",
                    "question",
                    "Count readings",
                    "expectedRejection",
                    false,
                    "expectedSql",
                    "SELECT COUNT(*) FROM readings",
                    "expectedChart",
                    "number",
                    "difficulty",
                    "EASY")));
    when(adapter.executeReadOnlyQuery(
            eq(warehouse), eq("test-only"), anyString(), eq(1000), eq(5242880), eq(15)))
        .thenReturn(data);
    when(queries.run(anyMap()))
        .thenReturn(
            Json.obj("queryId", "query", "status", "SUCCESS", "chart", Json.obj("type", "bar")));
    when(queries.stored("query")).thenReturn(Json.obj("result", data));
    var results = new ConcurrentHashMap<String, Map<String, Object>>();
    CountDownLatch finished = new CountDownLatch(1);
    doAnswer(
            call -> {
              var document = Json.read(Json.write(call.getArgument(2)));
              results.put(call.getArgument(0), document);
              if ("EVALUATION".equals(call.getArgument(1))
                  && "PARTIAL".equals(document.get("status"))) finished.countDown();
              return null;
            })
        .when(store)
        .run(anyString(), anyString(), anyMap());
    var service = new EvaluationService(store, queries, adapters, guard, catalog, corpus);
    try {
      var accepted =
          service.run(
              Json.obj(
                  "warehouseId",
                  "warehouse",
                  "datasetId",
                  "dataset",
                  "suiteId",
                  "configured",
                  "mode",
                  "API"));
      assertTrue(finished.await(5, TimeUnit.SECONDS));
      var result =
          results.values().stream().filter(r -> r.containsKey("caseId")).findFirst().orElseThrow();
      assertEquals("PARTIAL", results.get(accepted.get("runId")).get("status"));
      assertEquals("FAILED", result.get("status"));
      assertEquals(true, result.get("resultEquivalent"));
      assertEquals(false, result.get("chartMatch"));
      assertEquals(
          "Result is equivalent, but chart type bar differs from expected number.",
          result.get("failureReason"));
    } finally {
      service.stop();
    }
  }

  @Test
  void restartFailsInterruptedRunsWithoutCallingTheModelAgain() {
    Store store = mock(Store.class);
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    QueryService queries = mock(QueryService.class);
    when(store.jdbc()).thenReturn(jdbc);
    var interrupted =
        Json.obj(
            "runId",
            "interrupted",
            "status",
            "RUNNING",
            "completedAt",
            null,
            "metrics",
            Json.obj("completedCases", 2));
    when(jdbc.query(
            anyString(), org.mockito.ArgumentMatchers.<RowMapper<Map<String, Object>>>any()))
        .thenReturn(List.of(interrupted));
    var service =
        new EvaluationService(
            store,
            queries,
            mock(Adapters.class),
            new SqlGuard(),
            mock(CatalogService.class),
            mock(EvaluationCorpus.class));
    try {
      service.recover();
      assertEquals("FAILED", interrupted.get("status"));
      assertNotNull(interrupted.get("completedAt"));
      assertEquals(2, Json.map(interrupted.get("metrics")).get("completedCases"));
      assertEquals("EVALUATION_INTERRUPTED", Json.map(interrupted.get("error")).get("code"));
      verify(store).run("interrupted", "EVALUATION", interrupted);
      verifyNoInteractions(queries);
    } finally {
      service.stop();
    }
  }
}

package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.WarehouseAdapter;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;

class QueryServiceAdmissionTest {
  static class Fixture {
    final Store store = mock(Store.class);
    final CatalogService catalog = mock(CatalogService.class);
    final Adapters adapters = mock(Adapters.class);
    final WarehouseAdapter adapter = mock(WarehouseAdapter.class);
    final AiClient ai = mock(AiClient.class);
    final SemanticPlannerClient planner = mock(SemanticPlannerClient.class);
    final ModelProviderService providers = mock(ModelProviderService.class);
    final QueryAdmission admission = QueryAdmissionTest.gate(1);
    final Map<String, Object> warehouse =
        Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL", "status", "ACTIVE");
    final Map<String, Object> dataset =
        Json.obj("datasetId", "dataset", "warehouseId", "warehouse", "status", "ACTIVE");
    final Map<String, Object> request =
        Json.obj(
            "warehouseId",
            "warehouse",
            "datasetId",
            "dataset",
            "question",
            "Count records",
            "mode",
            "DETERMINISTIC");
    final Map<String, Object> selection =
        Json.obj(
            "metrics",
            List.of("count"),
            "dimensions",
            List.of(),
            "filters",
            List.of(),
            "limit",
            10);
    final Map<String, Object> candidate =
        Json.obj(
            "sql", "SELECT COUNT(*) AS amount FROM public.items",
            "model", "test-only",
            "explanation", "Count",
            "assumptions", List.of(),
            "selectedMetrics", List.of(),
            "selectedDimensions", List.of(),
            "chartRecommendation",
                Json.obj("type", "number", "title", "Count", "series", List.of()));

    Fixture() throws Exception {
      when(store.warehouse("warehouse")).thenReturn(warehouse);
      when(store.dataset("dataset")).thenReturn(dataset);
      when(catalog.context("dataset"))
          .thenReturn(Json.obj("metrics", List.of(), "dimensions", List.of()));
      when(catalog.tables("dataset"))
          .thenReturn(
              List.of(
                  Json.obj(
                      "schema",
                      "public",
                      "name",
                      "items",
                      "columns",
                      List.of(Json.obj("name", "id", "dataType", "INTEGER")))));
      when(ai.generate(anyMap(), anyString())).thenReturn(candidate);
      when(ai.invoke(eq("business-plan"), anyMap(), eq(20))).thenReturn(candidate);
      when(planner.plan(anyString(), anyString(), anyString(), anyMap()))
          .thenReturn(
              new SemanticPlannerClient.PlanResult(
                  (String) candidate.get("sql"),
                  List.of(),
                  List.of(Json.obj("schema", "public", "name", "items"))));
      when(adapters.get(anyMap())).thenReturn(adapter);
      when(store.credential("warehouse")).thenReturn("env:TEST_ONLY");
      when(adapters.password(anyString())).thenReturn("not-a-live-secret");
      when(store.settings())
          .thenReturn(
              Json.obj(
                  "limits",
                  Json.obj("maxRows", 1000, "maxBytes", 100000, "statementTimeoutMs", 15000)));
      when(adapter.executeReadOnlyQuery(
              anyMap(), anyString(), anyString(), anyInt(), anyInt(), anyInt()))
          .thenReturn(
              Json.obj(
                  "columns",
                  List.of(
                      Json.obj(
                          "name",
                          "amount",
                          "label",
                          "Count",
                          "dataType",
                          "BIGINT",
                          "semanticRole",
                          "METRIC")),
                  "rows",
                  List.of(Json.obj("amount", "3")),
                  "returnedRowCount",
                  1,
                  "truncated",
                  false,
                  "page",
                  1,
                  "pageSize",
                  20));
    }

    QueryService service() {
      return new QueryService(
          store, catalog, adapters, new SqlGuard(), ai, planner, providers, admission);
    }

    void slotAvailable() {
      try (var lease = admission.enter()) {
        assertNotNull(lease);
      }
    }
  }

  @Test
  void regularAndStructuredShareOneGateAndRejectedCallsDoNotCreateHistoryOrCallPython()
      throws Exception {
    var fixture = new Fixture();
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    when(fixture.ai.generate(anyMap(), anyString()))
        .thenAnswer(
            invocation -> {
              entered.countDown();
              assertTrue(release.await(5, TimeUnit.SECONDS));
              return fixture.candidate;
            });
    var service = fixture.service();
    try (var pool = Executors.newSingleThreadExecutor()) {
      var running = pool.submit(() -> service.run(fixture.request));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      try {
        assertEquals(
            "QUERY_BUSY",
            assertThrows(
                    ApiException.class, () -> service.runSemantic("dataset", fixture.selection))
                .code);
        assertEquals(
            "QUERY_BUSY",
            assertThrows(ApiException.class, () -> service.run(fixture.request)).code);
        verify(fixture.store, times(1)).putQuery(anyMap());
        verify(fixture.ai, never()).invoke(anyString(), anyMap(), anyInt());
      } finally {
        release.countDown();
      }
      assertEquals("SUCCESS", running.get(5, TimeUnit.SECONDS).get("status"));
    }
    assertEquals("SUCCESS", service.runSemantic("dataset", fixture.selection).get("status"));
    fixture.slotAvailable();
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2})
  void persistenceFaultAtEitherWriteCannotLeakAPermit(int failureAt) throws Exception {
    var fixture = new Fixture();
    var writes = new AtomicInteger();
    doAnswer(
            invocation -> {
              if (writes.incrementAndGet() == failureAt)
                throw new IllegalStateException("simulated metadata outage");
              return null;
            })
        .when(fixture.store)
        .putQuery(anyMap());
    assertThrows(IllegalStateException.class, () -> fixture.service().run(fixture.request));
    fixture.slotAvailable();
    QueryDeadline.start();
    QueryDeadline.clear();
    assertEquals(120, QueryDeadline.seconds(120));
  }

  @Test
  void providerFailureInterruptionAndPublicMappingFailureReleaseAPermit() throws Exception {
    var fixture = new Fixture();
    when(fixture.ai.generate(anyMap(), anyString()))
        .thenThrow(new ApiException(HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Unavailable"));
    assertEquals("QUERY_ERROR", fixture.service().run(fixture.request).get("status"));
    fixture.slotAvailable();
    clearInvocations(fixture.planner, fixture.adapter);
    doAnswer(
            invocation -> {
              Thread.currentThread().interrupt();
              return fixture.candidate;
            })
        .when(fixture.ai)
        .generate(anyMap(), anyString());
    try {
      assertEquals("TIMEOUT", fixture.service().run(fixture.request).get("status"));
      assertTrue(Thread.currentThread().isInterrupted());
      verifyNoInteractions(fixture.planner, fixture.adapter);
    } finally {
      Thread.interrupted();
    }
    fixture.slotAvailable();
    doReturn(fixture.candidate).when(fixture.ai).generate(anyMap(), anyString());
    var failed = new AtomicBoolean();
    var service =
        new QueryService(
            fixture.store,
            fixture.catalog,
            fixture.adapters,
            new SqlGuard(),
            fixture.ai,
            fixture.planner,
            fixture.providers,
            fixture.admission) {
          @Override
          public Map<String, Object> publicQuery(Map<String, Object> query) {
            if (failed.compareAndSet(false, true))
              throw new IllegalStateException("test mapper fault");
            return super.publicQuery(query);
          }
        };
    assertThrows(IllegalStateException.class, () -> service.run(fixture.request));
    fixture.slotAvailable();
    assertEquals("SUCCESS", service.run(fixture.request).get("status"));
  }

  @Test
  void authorizationAndValidationRemainAuthoritativeEvenWhenCapacityIsFull() throws Exception {
    var fixture = new Fixture();
    try (var lease = fixture.admission.enter()) {
      when(fixture.store.warehouse("warehouse"))
          .thenThrow(new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "No grant"));
      assertEquals(
          "FORBIDDEN",
          assertThrows(ApiException.class, () -> fixture.service().run(fixture.request)).code);
      var invalid = Json.obj("unexpected", true);
      assertEquals(
          "INVALID_REQUEST",
          assertThrows(ApiException.class, () -> fixture.service().run(invalid)).code);
      verifyNoInteractions(fixture.ai, fixture.planner);
      verify(fixture.store, never()).putQuery(anyMap());
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"grant", "warehouse", "dataset"})
  void changedAuthorizationOrContextDuringInferenceNeverReachesTheExecutor(String change)
      throws Exception {
    var fixture = new Fixture();
    when(fixture.ai.generate(anyMap(), anyString()))
        .thenAnswer(
            invocation -> {
              if (change.equals("grant")) {
                when(fixture.store.warehouse("warehouse"))
                    .thenThrow(
                        new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Grant revoked"));
              } else if (change.equals("warehouse")) {
                when(fixture.store.warehouse("warehouse"))
                    .thenReturn(
                        Json.obj(
                            "warehouseId",
                            "warehouse",
                            "engine",
                            "POSTGRESQL",
                            "status",
                            "DISABLED"));
              } else {
                when(fixture.store.dataset("dataset"))
                    .thenReturn(
                        Json.obj(
                            "datasetId",
                            "dataset",
                            "warehouseId",
                            "warehouse",
                            "status",
                            "ACTIVE",
                            "schemaVersion",
                            "changed"));
              }
              return fixture.candidate;
            });
    var result = fixture.service().run(fixture.request);
    assertEquals(
        change.equals("grant") ? "FORBIDDEN" : "SCHEMA_MISMATCH",
        Json.map(result.get("error")).get("code"));
    verifyNoInteractions(fixture.adapters);
    fixture.slotAvailable();
  }
}

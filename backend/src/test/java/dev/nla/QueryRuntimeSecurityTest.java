package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class QueryRuntimeSecurityTest {
  @ParameterizedTest
  @ValueSource(strings = {"DROP TABLE public.invoice", "SELECT * FROM private.payroll"})
  void rejectedCandidateCannotReachAnExecutor(String sql) {
    Store store = mock(Store.class);
    CatalogService catalog = mock(CatalogService.class);
    Adapters adapters = mock(Adapters.class);
    AiClient ai = mock(AiClient.class);
    when(store.warehouse("warehouse"))
        .thenReturn(
            Json.obj("warehouseId", "warehouse", "status", "ACTIVE", "engine", "POSTGRESQL"));
    when(store.dataset("dataset"))
        .thenReturn(
            Json.obj("warehouseId", "warehouse", "datasetId", "dataset", "status", "ACTIVE"));
    when(catalog.context("dataset"))
        .thenReturn(Json.obj("metrics", List.of(), "dimensions", List.of()));
    when(catalog.tables("dataset"))
        .thenReturn(
            List.of(
                Json.obj(
                    "schema",
                    "public",
                    "name",
                    "invoice",
                    "columns",
                    List.of(Json.obj("name", "id")))));
    when(ai.generate(anyMap(), anyString()))
        .thenReturn(
            Json.obj(
                "sql",
                sql,
                "model",
                "test",
                "selectedMetrics",
                List.of(),
                "selectedDimensions",
                List.of()));
    SemanticPlannerClient planner = mock(SemanticPlannerClient.class);
    when(planner.plan(anyString(), anyString(), eq(sql), anyMap()))
        .thenReturn(
            new SemanticPlannerClient.PlanResult(
                sql,
                List.of("nla_model_0"),
                List.of(Json.obj("schema", "public", "name", "invoice"))));
    var service = new QueryService(store, catalog, adapters, new SqlGuard(), ai, planner);
    var result =
        service.run(
            Json.obj(
                "warehouseId", "warehouse", "datasetId", "dataset", "question", "unsafe request"));
    assertNotEquals("SUCCESS", result.get("status"));
    verifyNoInteractions(adapters);
  }
}

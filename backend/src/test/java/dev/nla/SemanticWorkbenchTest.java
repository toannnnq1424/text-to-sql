package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.PostgreSqlWarehouseAdapter;
import dev.nla.warehouse.WarehouseAdapter;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SemanticWorkbenchTest {
  private static Map<String, Object> relation() {
    return Json.obj(
        "from",
            Json.obj(
                "table", Json.obj("schema", "public", "name", "facts"), "column", "customer_id"),
        "to", Json.obj("table", Json.obj("schema", "public", "name", "customers"), "column", "id"),
        "cardinality", "MANY_TO_ONE");
  }

  private static List<Map<String, Object>> tables(boolean primaryKey) {
    return List.of(
        Json.obj(
            "schema",
            "public",
            "name",
            "facts",
            "columns",
            List.of(Json.obj("name", "customer_id")),
            "primaryKey",
            List.of()),
        Json.obj(
            "schema",
            "public",
            "name",
            "customers",
            "columns",
            List.of(Json.obj("name", "id")),
            "primaryKey",
            primaryKey ? List.of("id") : List.of()));
  }

  @Test
  void oneSideCannotBeDeclaredWithoutPhysicalProof() throws Exception {
    Store store = mock(Store.class);
    Adapters adapters = mock(Adapters.class);
    WarehouseAdapter adapter = spy(new PostgreSqlWarehouseAdapter(false));
    var warehouse = Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL");
    when(store.dataset("dataset")).thenReturn(Json.obj("warehouseId", "warehouse"));
    when(store.warehouse("warehouse")).thenReturn(warehouse);
    when(store.credential("warehouse")).thenReturn("env:READER");
    when(adapters.password("env:READER")).thenReturn("test-only");
    when(adapters.get(warehouse)).thenReturn(adapter);
    doReturn(Json.obj("rows", List.of(List.of("duplicate-id"))))
        .when(adapter)
        .executeReadOnlyQuery(eq(warehouse), anyString(), anyString(), eq(1), eq(1024), eq(3));
    CatalogService catalog = spy(new CatalogService(store, adapters));
    doReturn(tables(false)).when(catalog).tables("dataset");
    ApiException error =
        assertThrows(
            ApiException.class,
            () ->
                catalog.validateJoinCardinality(
                    "dataset", Json.obj("relationships", List.of(relation()))));
    assertEquals("SEMANTIC_MODEL_INVALID", error.code);
    verify(adapter)
        .executeReadOnlyQuery(
            eq(warehouse), anyString(), contains("HAVING COUNT(*) > 1"), eq(1), eq(1024), eq(3));
  }

  @Test
  void physicalPrimaryKeyProvesUniquenessWithoutScanning() throws Exception {
    Store store = mock(Store.class);
    Adapters adapters = mock(Adapters.class);
    WarehouseAdapter adapter = spy(new PostgreSqlWarehouseAdapter(false));
    var warehouse = Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL");
    when(store.dataset("dataset")).thenReturn(Json.obj("warehouseId", "warehouse"));
    when(store.warehouse("warehouse")).thenReturn(warehouse);
    when(adapters.get(warehouse)).thenReturn(adapter);
    CatalogService catalog = spy(new CatalogService(store, adapters));
    doReturn(tables(true)).when(catalog).tables("dataset");
    catalog.validateJoinCardinality("dataset", Json.obj("relationships", List.of(relation())));
    verify(adapter, never())
        .executeReadOnlyQuery(anyMap(), anyString(), anyString(), anyInt(), anyInt(), anyInt());
  }

  @Test
  void duplicateAndOutOfScopeRelationshipsAreRejected() {
    CatalogService catalog = new CatalogService(mock(Store.class), mock(Adapters.class));
    assertThrows(
        ApiException.class,
        () ->
            catalog.validateSemantic(
                Json.obj("relationships", List.of(relation(), relation())), tables(true)));
    var invalid = relation();
    invalid.put(
        "to", Json.obj("table", Json.obj("schema", "private", "name", "payroll"), "column", "id"));
    assertThrows(
        ApiException.class,
        () -> catalog.validateSemantic(Json.obj("relationships", List.of(invalid)), tables(true)));
  }

  @Test
  void invalidSelectionIsRejectedBeforeCreatingHistoryOrCallingPython() {
    Store store = mock(Store.class);
    AiClient ai = mock(AiClient.class);
    QueryService queries =
        new QueryService(
            store,
            mock(CatalogService.class),
            mock(Adapters.class),
            new SqlGuard(),
            ai,
            mock(SemanticPlannerClient.class),
            mock(ModelProviderService.class),
            new QueryAdmission(new org.springframework.mock.env.MockEnvironment()));
    for (Object metrics : List.of("wrong type", List.of(), List.of("sales", "sales"), List.of(7))) {
      assertThrows(
          ApiException.class,
          () ->
              queries.runSemantic(
                  "dataset",
                  Json.obj(
                      "metrics",
                      metrics,
                      "dimensions",
                      List.of(),
                      "filters",
                      List.of(),
                      "limit",
                      10)));
    }
    verifyNoInteractions(store, ai);
  }

  @Test
  void candidateContractRejectsWrongTypesNonFiniteAndUnexpectedFields() {
    var candidate =
        Json.obj(
            "sql",
            "SELECT 1",
            "explanation",
            "",
            "assumptions",
            List.of(),
            "selectedMetrics",
            List.of(),
            "selectedDimensions",
            List.of(),
            "chartRecommendation",
            Json.obj("type", "number"),
            "confidence",
            1.0,
            "model",
            "semantic-compiler");
    assertDoesNotThrow(() -> AiClient.validateCandidate(candidate));
    candidate.put("confidence", Double.NaN);
    assertThrows(ApiException.class, () -> AiClient.validateCandidate(candidate));
    candidate.put("confidence", 1.0);
    candidate.put("selectedMetrics", List.of(1));
    assertThrows(ApiException.class, () -> AiClient.validateCandidate(candidate));
    candidate.put("selectedMetrics", List.of());
    candidate.put("unexpected", "field");
    assertThrows(ApiException.class, () -> AiClient.validateCandidate(candidate));
  }
}

package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class ModelProviderRoutingTest {
  @Test
  void apiOverrideAndAutoDefaultHaveSafeSnapshotsWhileDeterministicNeverResolvesProvider() {
    Store store = mock(Store.class);
    CatalogService catalog = mock(CatalogService.class);
    AiClient ai = mock(AiClient.class);
    var providers = mock(ModelProviderService.class);
    var planner = mock(SemanticPlannerClient.class);
    when(store.warehouse("warehouse"))
        .thenReturn(
            Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL", "status", "ACTIVE"));
    when(store.dataset("dataset"))
        .thenReturn(
            Json.obj("datasetId", "dataset", "warehouseId", "warehouse", "status", "ACTIVE"));
    when(catalog.context("dataset"))
        .thenReturn(Json.obj("metrics", List.of(), "dimensions", List.of()));
    var snapshot =
        Json.obj(
            "providerId",
            "chosen",
            "revision",
            "2",
            "name",
            "Local model",
            "kind",
            "OLLAMA",
            "model",
            "configured-model",
            "source",
            "APPLICATION");
    var config =
        Json.obj(
            "kind",
            "OLLAMA",
            "baseUrl",
            "http://localhost:11434/v1",
            "model",
            "configured-model",
            "apiKey",
            "private-routing-key",
            "structuredOutput",
            true);
    when(providers.select("chosen"))
        .thenReturn(new ModelProviderService.Selection(snapshot, config));
    when(providers.selectDefault())
        .thenReturn(new ModelProviderService.Selection(snapshot, config));
    when(ai.generate(anyMap(), anyString()))
        .thenReturn(
            Json.obj(
                "sql",
                "DROP TABLE private",
                "model",
                "actual-model",
                "selectedMetrics",
                List.of(),
                "selectedDimensions",
                List.of()));
    when(planner.plan(anyString(), anyString(), anyString(), anyMap()))
        .thenReturn(
            new SemanticPlannerClient.PlanResult("DROP TABLE private", List.of(), List.of()));
    var service =
        new QueryService(
            store,
            catalog,
            mock(Adapters.class),
            new SqlGuard(),
            ai,
            planner,
            providers,
            new QueryAdmission(new org.springframework.mock.env.MockEnvironment()));
    var request =
        Json.obj(
            "warehouseId",
            "warehouse",
            "datasetId",
            "dataset",
            "question",
            "Test",
            "mode",
            "API",
            "providerId",
            "chosen");
    var api = service.run(request);
    assertEquals(snapshot, api.get("provider"));
    assertEquals("actual-model", api.get("model"));
    assertFalse(Json.write(api).contains("private-routing-key"));
    ArgumentCaptor<Map<String, Object>> outbound = ArgumentCaptor.captor();
    verify(ai).generate(outbound.capture(), eq("API"));
    assertEquals(
        "private-routing-key", Json.map(outbound.getValue().get("modelConfig")).get("apiKey"));
    assertEquals(true, Json.map(outbound.getValue().get("modelConfig")).get("structuredOutput"));
    assertFalse(
        Json.write(outbound.getValue().get("semanticContext")).contains("private-routing-key"));
    request.remove("providerId");
    request.put("mode", "AUTO");
    service.run(request);
    verify(providers).selectDefault();
    clearInvocations(providers, ai);
    request.put("mode", "DETERMINISTIC");
    assertNull(service.run(request).get("provider"));
    verifyNoInteractions(providers);
    verify(ai).generate(argThat(value -> !value.containsKey("modelConfig")), eq("DETERMINISTIC"));
    request.put("providerId", "chosen");
    assertThrows(ApiException.class, () -> service.run(request));
    request.put("mode", "AUTO");
    assertThrows(ApiException.class, () -> service.run(request));
  }
}

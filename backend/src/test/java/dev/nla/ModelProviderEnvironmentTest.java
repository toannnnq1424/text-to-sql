package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.env.MockEnvironment;

class ModelProviderEnvironmentTest {
  @Test
  void environmentIsReadOnlyAndSelectedWithoutPassingAnyKeyOrOverride() {
    var jdbc = mock(JdbcTemplate.class);
    var store = mock(Store.class);
    var ai = mock(AiClient.class);
    when(store.jdbc()).thenReturn(jdbc);
    when(jdbc.query(
            anyString(), org.mockito.ArgumentMatchers.<RowMapper<Map<String, Object>>>any()))
        .thenReturn(List.of());
    var safe =
        Json.obj(
            "providerId",
            "environment",
            "revision",
            "safe-config-hash",
            "name",
            "Deployment model",
            "kind",
            "OLLAMA",
            "baseUrl",
            "http://localhost:11434/v1",
            "model",
            "qwen3:4b",
            "hasApiKey",
            false,
            "enabled",
            true,
            "configured",
            true,
            "source",
            "ENVIRONMENT",
            "readOnly",
            true,
            "updatedAt",
            null);
    when(ai.invoke(eq("model-provider/status"), anyMap(), eq(5)))
        .thenReturn(Json.obj("provider", safe));
    var env = new MockEnvironment();
    var service =
        new ModelProviderService(
            store, new ModelProviderSecrets(env), new ModelProviderPolicy(env), ai);
    var profiles = service.list();
    assertEquals("environment", profiles.get("defaultProviderId"));
    assertEquals(false, profiles.get("configurationAvailable"));
    assertEquals(safe, Json.objects(profiles.get("items")).getFirst());
    var selection = service.selectDefault();
    var outbound = Json.obj();
    selection.apply(outbound);
    assertTrue(outbound.isEmpty());
    assertEquals("ENVIRONMENT", selection.snapshot().get("source"));
    assertFalse(selection.snapshot().containsKey("baseUrl"));
    safe.put("configured", false);
    assertNull(service.list().get("defaultProviderId"));
    assertEquals(
        "MODEL_PROVIDER_UNAVAILABLE",
        assertThrows(ApiException.class, service::selectDefault).code);
  }

  @Test
  void failedPrivateStatusIsAnErrorRatherThanAnInventedMissingEnvironment() {
    var jdbc = mock(JdbcTemplate.class);
    var store = mock(Store.class);
    var ai = mock(AiClient.class);
    when(store.jdbc()).thenReturn(jdbc);
    when(jdbc.query(
            anyString(), org.mockito.ArgumentMatchers.<RowMapper<Map<String, Object>>>any()))
        .thenReturn(List.of());
    when(ai.invoke(eq("model-provider/status"), anyMap(), eq(5)))
        .thenThrow(
            new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "LLM_ERROR", "Private service unavailable"));
    var env = new MockEnvironment();
    var service =
        new ModelProviderService(
            store, new ModelProviderSecrets(env), new ModelProviderPolicy(env), ai);
    assertEquals("LLM_ERROR", assertThrows(ApiException.class, service::list).code);
  }
}

package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

class ModelProviderValidationTest {
  @ParameterizedTest
  @ValueSource(
      strings = {
        "unknown",
        "key-null",
        "key-newline",
        "key-space",
        "key-unicode-space",
        "key-control",
        "key-long",
        "key-in-url",
        "key-in-name",
        "no-online-key",
        "bad-model",
        "name-long",
        "not-enabled",
        "raw-secret-clear"
      })
  void rejectsInvalidInputBeforePersistenceAndNeverEchoesKey(String mutation) {
    var env =
        new MockEnvironment()
            .withProperty("NLA_MODEL_MASTER_KEY", ModelProviderSecretsTest.master(1));
    var store = mock(Store.class);
    when(store.admin()).thenReturn(true);
    var service =
        new ModelProviderService(
            store,
            new ModelProviderSecrets(env),
            new ModelProviderPolicy(env),
            mock(AiClient.class));
    Map<String, Object> body =
        Json.obj(
            "name",
            "A profile",
            "kind",
            "ONLINE",
            "baseUrl",
            "https://api.openai.com/v1",
            "model",
            "a-model",
            "enabled",
            true,
            "apiKey",
            "test-private-key");
    switch (mutation) {
      case "unknown" -> body.put("providerSecret", "test-private-key");
      case "key-null" -> body.put("apiKey", null);
      case "key-newline" -> body.put("apiKey", "test-private-key\n");
      case "key-space" -> body.put("apiKey", "test-private-key with-space");
      case "key-unicode-space" -> body.put("apiKey", "test-private-key\u00a0");
      case "key-control" -> body.put("apiKey", "test-private-key\u0001");
      case "key-long" -> body.put("apiKey", "x".repeat(8193));
      case "key-in-url" -> body.put("baseUrl", "https://api.openai.com/test-private-key");
      case "key-in-name" -> body.put("name", "test-private-key");
      case "no-online-key" -> body.remove("apiKey");
      case "bad-model" -> body.put("model", "model with control\n");
      case "name-long" -> body.put("name", "x".repeat(121));
      case "not-enabled" -> body.put("enabled", "true");
      case "raw-secret-clear" -> body.put("clearApiKey", true);
    }
    var error = assertThrows(ApiException.class, () -> service.create(body));
    assertFalse(error.getMessage().contains("test-private-key"));
    verify(store, never()).jdbc();
  }

  @Test
  void readOnlyEnvironmentCannotBeMutatedOrDeleted() {
    var env =
        new MockEnvironment()
            .withProperty("NLA_MODEL_MASTER_KEY", ModelProviderSecretsTest.master(1));
    var store = mock(Store.class);
    when(store.admin()).thenReturn(true);
    var service =
        new ModelProviderService(
            store,
            new ModelProviderSecrets(env),
            new ModelProviderPolicy(env),
            mock(AiClient.class));
    assertThrows(ApiException.class, () -> service.update("environment", Json.obj()));
    assertThrows(ApiException.class, () -> service.delete("environment"));
    verify(store, never()).jdbc();
  }
}

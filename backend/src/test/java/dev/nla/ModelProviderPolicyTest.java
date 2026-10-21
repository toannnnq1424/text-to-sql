package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

class ModelProviderPolicyTest {
  @ParameterizedTest
  @ValueSource(
      strings = {
        "https://evil.example/v1",
        "https://key@api.openai.com/v1",
        "https://api.openai.com/v1?key=secret",
        "https://api.openai.com/v1#secret",
        "http://api.openai.com/v1",
        "file:///tmp/private",
        "https://api.openai.com/%2e%2e/private",
        "https://api.openai.com/../private",
        "https://api.openai.com/v1\n",
        "https://api.openai.com:0/v1"
      })
  void rejectsUntrustedOrCredentialBearingDestinations(String url) {
    var policy = new ModelProviderPolicy(new MockEnvironment());
    assertThrows(ApiException.class, () -> policy.url("ONLINE", url));
  }

  @Test
  void permitsKnownHttpsAndOllamaButHttpOnlineNeedsExplicitPrivateDeploymentHost() {
    var env = new MockEnvironment();
    var policy = new ModelProviderPolicy(env);
    assertEquals("https://api.openai.com/v1", policy.url("ONLINE", "https://api.openai.com/v1/"));
    assertEquals(
        "http://host.docker.internal:11434/v1",
        policy.url("OLLAMA", "http://host.docker.internal:11434/v1"));
    assertThrows(ApiException.class, () -> policy.url("ONLINE", "http://localhost:11434/v1"));
    assertThrows(ApiException.class, () -> policy.url("OLLAMA", "https://api.openai.com/v1"));
    env.setProperty(
        "NLA_MODEL_PROVIDER_HOSTS", "localhost,api.openai.com,169.254.169.254,0.0.0.0,224.0.0.1");
    assertEquals("http://localhost:1234/v1", policy.url("ONLINE", "http://localhost:1234/v1"));
    assertThrows(ApiException.class, () -> policy.url("ONLINE", "http://api.openai.com/v1"));
    assertThrows(ApiException.class, () -> policy.url("ONLINE", "http://169.254.169.254/v1"));
    assertThrows(ApiException.class, () -> policy.url("ONLINE", "https://169.254.169.254/v1"));
    assertThrows(ApiException.class, () -> policy.url("ONLINE", "https://0.0.0.0/v1"));
    assertThrows(ApiException.class, () -> policy.url("ONLINE", "https://224.0.0.1/v1"));
  }
}

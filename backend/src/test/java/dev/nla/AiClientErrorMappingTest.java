package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;

class AiClientErrorMappingTest {
  @Test
  void explainsLowConfidenceAsModelRejectionInsteadOfProviderOutage() throws Exception {
    var error = request("LOW_CONFIDENCE", 422);

    assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, error.status);
    assertEquals("LOW_CONFIDENCE", error.code);
    assertTrue(error.getMessage().contains("Model chưa tạo được SQL đủ tin cậy"));
  }

  @Test
  void explainsMalformedModelOutputWithoutLeakingProviderBody() throws Exception {
    var error = request("INVALID_MODEL_RESPONSE", 502);

    assertEquals(HttpStatus.BAD_GATEWAY, error.status);
    assertEquals("LLM_ERROR", error.code);
    assertTrue(error.getMessage().contains("Model có phản hồi"));
    assertFalse(error.getMessage().contains("private provider trace"));
  }

  @Test
  void reportsUnavailableProviderAsServiceUnavailable() throws Exception {
    var error = request("PROVIDER_UNAVAILABLE", 503);

    assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.status);
    assertEquals("LLM_ERROR", error.code);
    assertTrue(error.getMessage().contains("Ollama/model local"));
  }

  private static ApiException request(String code, int status) throws Exception {
    var executor = Executors.newSingleThreadExecutor();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(executor);
    server.createContext(
        "/internal/v1/text-to-sql",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          var body =
              Json.write(
                      Json.obj(
                          "error", Json.obj("code", code, "message", "private provider trace")))
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(status, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      var environment =
          new MockEnvironment()
              .withProperty("nla.python-url", "http://127.0.0.1:" + server.getAddress().getPort())
              .withProperty("nla.python-token", "test-private-service-token-not-a-live-key");
      return assertThrows(
          ApiException.class,
          () ->
              new AiClient(environment)
                  .generate(Json.obj("correlationId", "ai-error-test"), "API"));
    } finally {
      server.stop(0);
      executor.shutdownNow();
    }
  }
}

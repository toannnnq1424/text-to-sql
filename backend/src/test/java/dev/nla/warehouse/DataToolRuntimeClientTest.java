package dev.nla.warehouse;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import dev.nla.Json;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class DataToolRuntimeClientTest {
  private HttpServer server;
  private final String token = "test-private-service-token-of-at-least-32-characters";
  private final Map<String, Object> warehouse =
      Json.obj(
          "warehouseId",
          "registered",
          "engine",
          "POSTGRESQL",
          "host",
          "postgres",
          "port",
          5432,
          "database",
          "domain_warehouse",
          "username",
          "reader");

  @AfterEach
  void stop() {
    if (server != null) server.stop(0);
  }

  DataToolRuntimeClient endpoint(
      int status, String body, AtomicReference<Map<String, Object>> input) throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/internal/v1/query",
        exchange -> {
          assertEquals("Bearer " + token, exchange.getRequestHeaders().getFirst("Authorization"));
          input.set(
              Json.read(
                  new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
          byte[] response = body.getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(status, response.length);
          exchange.getResponseBody().write(response);
          exchange.close();
        });
    server.start();
    return new DataToolRuntimeClient("http://127.0.0.1:" + server.getAddress().getPort(), token);
  }

  @Test
  void sendsOnlyReaderConnectionAndPreservesCanonicalTypedResult() throws Exception {
    var received = new AtomicReference<Map<String, Object>>();
    var client =
        endpoint(
            200,
            "{\"columns\":[{\"name\":\"large_id\",\"label\":\"large_id\",\"dataType\":\"BIGINT\",\"semanticRole\":\"METRIC\"}],"
                + "\"rows\":[{\"large_id\":\"9007199254740993\"}],\"returnedRowCount\":1,\"page\":1,\"pageSize\":20,\"truncated\":false}",
            received);
    var result =
        client.execute(
            warehouse,
            "private-reader-password",
            true,
            "SELECT id FROM sales LIMIT 11",
            10,
            4096,
            2);
    assertEquals("9007199254740993", Json.objects(result.get("rows")).getFirst().get("large_id"));
    assertEquals("registered", received.get().get("warehouseId"));
    assertEquals(2000, ((Number) received.get().get("timeoutMs")).intValue());
    assertEquals("SELECT id FROM sales LIMIT 11", received.get().get("sql"));
    assertEquals(
        "private-reader-password", Json.map(received.get().get("connection")).get("password"));
    assertFalse(received.get().containsKey("semanticContext"));
    assertFalse(received.get().containsKey("credentialRef"));
  }

  @Test
  void runtimeFailureDoesNotFallBackOrExposeResponse() throws Exception {
    var client = endpoint(502, "driver-secret-not-for-public", new AtomicReference<>());
    SQLException error =
        assertThrows(
            SQLException.class,
            () -> client.execute(warehouse, "secret", false, "SELECT 1", 10, 4096, 2));
    assertFalse(error.toString().contains("driver-secret"));
    assertNull(error.getCause());
  }

  @Test
  void runtimeTimeoutMapsToExistingQueryTimeoutState() throws Exception {
    var client = endpoint(504, "{\"code\":\"QUERY_TIMEOUT\"}", new AtomicReference<>());
    assertThrows(
        SQLTimeoutException.class,
        () -> client.execute(warehouse, "secret", false, "SELECT 1", 10, 4096, 2));
  }

  @Test
  void malformedAndOversizedRuntimeResponsesAreRejected() throws Exception {
    var client = endpoint(200, "x".repeat(210000), new AtomicReference<>());
    assertThrows(
        SQLException.class,
        () -> client.execute(warehouse, "secret", false, "SELECT 1", 10, 100, 2));
  }
}

package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

class QueryInterruptionTest {
  @ParameterizedTest
  @ValueSource(strings = {"generation", "business-plan", "semantic-plan"})
  void cancelledHttpCallsRestoreInterruptionAndUseTheExistingTimeoutError(String capability)
      throws Exception {
    var received = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var executor = Executors.newSingleThreadExecutor();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(executor);
    server.createContext(
        "/",
        exchange -> {
          try {
            exchange.getRequestBody().readAllBytes();
            received.countDown();
            if (release.await(5, TimeUnit.SECONDS)) {
              byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
              exchange.sendResponseHeaders(200, body.length);
              exchange.getResponseBody().write(body);
            }
          } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
          } catch (java.io.IOException disconnected) {
            // The client deliberately cancels its HTTP request in this test.
          } finally {
            exchange.close();
          }
        });
    server.start();
    var environment =
        new MockEnvironment()
            .withProperty("nla.python-url", "http://127.0.0.1:" + server.getAddress().getPort())
            .withProperty("nla.python-token", "test-private-service-token-not-a-live-key");
    var preserved = new AtomicBoolean();
    var observed = new AtomicReference<Throwable>();
    var client =
        new Thread(
            () -> {
              try {
                if (capability.equals("generation")) {
                  new AiClient(environment)
                      .generate(Json.obj("correlationId", "interruption-test"), "API");
                } else if (capability.equals("business-plan")) {
                  new AiClient(environment)
                      .invoke("business-plan", Json.obj("correlationId", "interruption-test"), 5);
                } else {
                  var physical =
                      Json.obj(
                          "tables",
                          List.of(
                              Json.obj(
                                  "schema",
                                  "public",
                                  "name",
                                  "items",
                                  "columns",
                                  List.of(Json.obj("name", "id", "dataType", "INTEGER")))),
                          "relationships",
                          List.of());
                  new SemanticPlannerClient(environment)
                      .plan(
                          "interruption-test",
                          "POSTGRESQL",
                          "SELECT COUNT(*) FROM public.items",
                          physical);
                }
                observed.set(new AssertionError("Cancelled request unexpectedly returned"));
              } catch (Throwable failure) {
                observed.set(failure);
                preserved.set(Thread.currentThread().isInterrupted());
              } finally {
                QueryDeadline.clear();
              }
            });
    try {
      client.start();
      assertTrue(received.await(5, TimeUnit.SECONDS));
      client.interrupt();
      client.join(3000);
      assertFalse(client.isAlive(), "HTTP cancellation must release the request thread");
      assertInstanceOf(ApiException.class, observed.get());
      assertEquals("QUERY_TIMEOUT", ((ApiException) observed.get()).code);
      assertTrue(preserved.get(), "InterruptedException must not erase the cancellation signal");
    } finally {
      release.countDown();
      client.interrupt();
      client.join(3000);
      server.stop(0);
      executor.shutdownNow();
      assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
    }
  }
}

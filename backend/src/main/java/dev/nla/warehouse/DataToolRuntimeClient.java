package dev.nla.warehouse;

import dev.nla.Json;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

/** Private, bounded transport to native database pools. Java validates SQL before this call. */
public final class DataToolRuntimeClient {
  private static final Set<String> TYPES =
      Set.of("INTEGER", "BIGINT", "DECIMAL", "FLOAT", "BOOLEAN", "DATE", "TIMESTAMP", "STRING");
  private final String endpoint;
  private final String token;
  private final HttpClient client;

  public DataToolRuntimeClient(String endpoint, String token) {
    this.endpoint = endpoint.replaceAll("/+$", "");
    this.token = token;
    this.client =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
  }

  public static DataToolRuntimeClient configured() {
    String url = System.getenv("DATA_TOOL_RUNTIME_URL");
    return url == null || url.isBlank()
        ? null
        : new DataToolRuntimeClient(
            url, System.getenv().getOrDefault("DATA_TOOL_RUNTIME_TOKEN", ""));
  }

  public Map<String, Object> execute(
      Map<String, Object> warehouse,
      String password,
      boolean tls,
      String boundedSql,
      int maxRows,
      int maxBytes,
      int timeoutSeconds)
      throws SQLException {
    try {
      URI uri = URI.create(endpoint + "/internal/v1/query");
      if (!Set.of("http", "https").contains(uri.getScheme())
          || uri.getHost() == null
          || uri.getUserInfo() != null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || token.length() < 32) {
        throw new SQLException("Private data runtime configuration is invalid", "08001");
      }
      var connection =
          Json.obj(
              "host", warehouse.get("host"),
              "port", warehouse.get("port"),
              "database", warehouse.get("database"),
              "username", warehouse.get("username"),
              "password", password,
              "tls", tls);
      var body =
          Json.obj(
              "correlationId",
              UUID.randomUUID().toString(),
              "warehouseId",
              warehouse.getOrDefault("warehouseId", "registered-warehouse"),
              "engine",
              warehouse.get("engine"),
              "connection",
              connection,
              "sql",
              boundedSql,
              "maxRows",
              maxRows,
              "maxBytes",
              maxBytes,
              "timeoutMs",
              Math.multiplyExact(timeoutSeconds, 1000));
      HttpRequest request =
          HttpRequest.newBuilder(uri)
              .timeout(Duration.ofSeconds(timeoutSeconds + 2L))
              .header("Content-Type", "application/json")
              .header("Authorization", "Bearer " + token)
              .POST(HttpRequest.BodyPublishers.ofString(Json.write(body)))
              .build();
      HttpResponse<byte[]> response =
          client.send(request, ignored -> new BoundedBody(maxBytes + 200_000));
      if (response.statusCode() == 504) {
        throw new SQLTimeoutException("Private data runtime query timed out", "57014");
      }
      if (response.statusCode() != 200) {
        throw new SQLException("Private data runtime query failed", "08006");
      }
      var result = Json.read(new String(response.body(), StandardCharsets.UTF_8));
      validateResult(result, maxRows, maxBytes);
      return result;
    } catch (SQLTimeoutException error) {
      throw error;
    } catch (java.net.http.HttpTimeoutException error) {
      throw new SQLTimeoutException("Private data runtime query timed out", "57014");
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new SQLTimeoutException("Private data runtime query interrupted", "57014");
    } catch (SQLException error) {
      throw error;
    } catch (Exception error) {
      // Never attach HTTP bodies, credentials, SQL text or driver errors to public errors.
      throw new SQLException(
          "Private data runtime is unavailable or returned an invalid result", "08006");
    }
  }

  private static void validateResult(Map<String, Object> result, int maxRows, int maxBytes)
      throws SQLException {
    var columns = Json.objects(result.get("columns"));
    var rows = Json.objects(result.get("rows"));
    if (!(result.get("columns") instanceof List<?>)
        || columns.isEmpty()
        || columns.size() > 1000
        || !(result.get("rows") instanceof List<?>)
        || rows.size() > maxRows
        || !(result.get("returnedRowCount") instanceof Number count)
        || count.intValue() != rows.size()
        || !(result.get("truncated") instanceof Boolean)
        || columns.stream().anyMatch(column -> !TYPES.contains(Json.str(column, "dataType")))) {
      throw new SQLException("Private data runtime returned an invalid result", "08006");
    }
    int bytes = 0;
    for (var row : rows) {
      bytes += Json.write(row).getBytes(StandardCharsets.UTF_8).length;
      if (bytes > maxBytes) {
        throw new SQLException("Private data runtime exceeded the result byte limit", "08006");
      }
    }
  }

  private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final int limit;
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private final CompletableFuture<byte[]> completion = new CompletableFuture<>();
    private Flow.Subscription subscription;

    BoundedBody(int limit) {
      this.limit = limit;
    }

    public CompletionStage<byte[]> getBody() {
      return completion;
    }

    public void onSubscribe(Flow.Subscription subscription) {
      this.subscription = subscription;
      subscription.request(1);
    }

    public void onNext(List<ByteBuffer> buffers) {
      for (ByteBuffer buffer : buffers) {
        if ((long) bytes.size() + buffer.remaining() > limit) {
          subscription.cancel();
          completion.completeExceptionally(
              new IllegalStateException("Response size limit exceeded"));
          return;
        }
        byte[] chunk = new byte[buffer.remaining()];
        buffer.get(chunk);
        bytes.writeBytes(chunk);
      }
      subscription.request(1);
    }

    public void onError(Throwable error) {
      completion.completeExceptionally(error);
    }

    public void onComplete() {
      completion.complete(bytes.toByteArray());
    }
  }
}

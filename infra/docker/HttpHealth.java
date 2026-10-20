import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Small JRE health probe; no shell tools, credentials, or response body logging. */
public final class HttpHealth {
  public static void main(String[] args) throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create(args[0])).timeout(Duration.ofSeconds(3)).build();
    var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    var response = client.send(request, HttpResponse.BodyHandlers.discarding());
    System.exit(response.statusCode() == 200 ? 0 : 1);
  }
}

package dev.nla;

import java.net.InetAddress;
import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Exact deployment-owned destination policy, independent from any user/model metadata. */
@Component
public class ModelProviderPolicy {
  private static final Set<String> DEFAULTS =
      Set.of(
          "api.openai.com",
          "api.groq.com",
          "api.deepseek.com",
          "openrouter.ai",
          "generativelanguage.googleapis.com",
          "api.mistral.ai",
          "api.together.xyz",
          "api.fireworks.ai",
          "localhost",
          "127.0.0.1",
          "::1",
          "host.docker.internal");
  private static final Set<String> LOCAL =
      Set.of("localhost", "127.0.0.1", "::1", "host.docker.internal");
  private final Environment env;

  public ModelProviderPolicy(Environment env) {
    this.env = env;
  }

  public String url(String kind, String value) {
    try {
      if (value.length() > 2048 || value.chars().anyMatch(c -> c <= 32 || c == 127))
        throw new IllegalArgumentException();
      URI uri = URI.create(value);
      String host = uri.getHost();
      if (host == null) throw new IllegalArgumentException();
      host = host.toLowerCase(Locale.ROOT).replace("[", "").replace("]", "");
      var explicit = new HashSet<String>();
      Arrays.stream(env.getProperty("NLA_MODEL_PROVIDER_HOSTS", "").split(","))
          .map(String::strip)
          .map(s -> s.toLowerCase(Locale.ROOT))
          .filter(s -> !s.isBlank())
          .forEach(explicit::add);
      if (!DEFAULTS.contains(host) && !explicit.contains(host))
        throw new IllegalArgumentException();
      if (host.matches("[0-9.]+") || host.contains(":")) {
        var address = InetAddress.getByName(host);
        if (address.isAnyLocalAddress()
            || address.isLinkLocalAddress()
            || address.isMulticastAddress()) throw new IllegalArgumentException();
      }
      if (uri.getUserInfo() != null
          || uri.getRawQuery() != null
          || uri.getRawFragment() != null
          || uri.getPort() == 0
          || uri.getPort() > 65535
          || !Set.of("https", "http").contains(uri.getScheme())
          || value.contains("%")
          || value.contains("\\")) throw new IllegalArgumentException();
      if ("http".equals(uri.getScheme())
          && !("OLLAMA".equals(kind) && LOCAL.contains(host))
          && !(explicit.contains(host) && privateHost(host))) throw new IllegalArgumentException();
      if ("OLLAMA".equals(kind) && !privateHost(host)) throw new IllegalArgumentException();
      String path = uri.getPath();
      if (path != null && !path.matches("(?:/[A-Za-z0-9._~-]+)*/?"))
        throw new IllegalArgumentException();
      if (path != null
          && Arrays.stream(path.split("/")).anyMatch(s -> s.equals(".") || s.equals("..")))
        throw new IllegalArgumentException();
      return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    } catch (Exception invalid) {
      throw ApiException.bad(
          "URL model không hợp lệ hoặc host/protocol không được deployment cho phép.");
    }
  }

  private static boolean privateHost(String host) {
    if (LOCAL.contains(host)) return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    if (!host.matches("[0-9.]+") && !host.contains(":")) return false;
    try {
      var addresses = InetAddress.getAllByName(host);
      return addresses.length > 0
          && Arrays.stream(addresses)
              .allMatch(
                  address ->
                      address.isLoopbackAddress()
                          || address.isSiteLocalAddress()
                          || (address.getAddress().length == 16
                              && (address.getAddress()[0] & 0xfe) == 0xfc));
    } catch (Exception ignored) {
      return false;
    }
  }

  static String text(Object value, int max, String field) {
    if (!(value instanceof String text)
        || text.isBlank()
        || text.length() > max
        || text.chars().anyMatch(c -> Character.isISOControl(c)))
      throw ApiException.bad(field + " không hợp lệ.");
    return text.strip();
  }

  static String model(Object value) {
    String model = text(value, 200, "Model");
    if (!model.matches("[A-Za-z0-9][A-Za-z0-9_.:/@+\\-]{0,199}"))
      throw ApiException.bad("Tên model không hợp lệ.");
    return model;
  }
}

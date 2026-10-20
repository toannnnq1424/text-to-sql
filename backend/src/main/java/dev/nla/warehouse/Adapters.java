package dev.nla.warehouse;

import dev.nla.*;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class Adapters {
  private final Map<String, WarehouseAdapter> adapters;
  private final Environment env;
  private final Set<String> hosts;

  public Adapters(Environment env) {
    this.env = env;
    boolean tls = env.getProperty("nla.warehouse-tls", Boolean.class, true);
    this.adapters =
        Map.of(
            "POSTGRESQL",
            new PostgreSqlWarehouseAdapter(tls),
            "MYSQL",
            new MySqlWarehouseAdapter(tls),
            "SQL_SERVER",
            new SqlServerWarehouseAdapter(tls));
    hosts =
        new HashSet<>(
            Arrays.asList(env.getProperty("nla.allowed-hosts", "127.0.0.1,localhost").split(",")));
  }

  public WarehouseAdapter get(Map<String, Object> w) {
    validate(w);
    return adapters.get(Json.str(w, "engine"));
  }

  public void validate(Map<String, Object> w) {
    if (!adapters.containsKey(Json.str(w, "engine")))
      throw ApiException.bad("Engine không hợp lệ.");
    if (!hosts.contains(Json.str(w, "host")))
      throw new ApiException(
          HttpStatus.FORBIDDEN,
          "FORBIDDEN",
          "Host warehouse không nằm trong allowlist của server.");
    for (String field : List.of("host", "database", "username"))
      if (!Json.str(w, field).matches("[\\p{L}\\p{N}_. -]{1,253}"))
        throw ApiException.bad("Cấu hình kết nối không hợp lệ.");
    if (!(w.get("port") instanceof Number port) || port.intValue() < 1 || port.intValue() > 65535)
      throw ApiException.bad("Port không hợp lệ.");
  }

  public String password(String reference) {
    if (!reference.matches("env:[A-Z][A-Z0-9_]{1,99}"))
      throw ApiException.bad("Credential reference phải là env:NAME được cấu hình trên server.");
    String value = env.getProperty(reference.substring(4));
    if (value == null || value.isBlank())
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "WAREHOUSE_CONNECTION_ERROR",
          "Credential reference chưa được cấu hình.");
    return value;
  }
}

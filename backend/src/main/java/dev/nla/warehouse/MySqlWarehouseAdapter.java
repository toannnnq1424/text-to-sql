package dev.nla.warehouse;

import dev.nla.Json;
import java.util.Map;

public final class MySqlWarehouseAdapter extends JdbcWarehouseAdapter {
  public MySqlWarehouseAdapter(boolean tls) {
    super(tls);
  }

  public String engine() {
    return "MYSQL";
  }

  public SqlDialect getSqlDialect() {
    return new MySqlDialect();
  }

  protected String jdbcUrl(Map<String, Object> w) {
    return "jdbc:mysql://"
        + Json.str(w, "host")
        + ":"
        + w.get("port")
        + "/"
        + Json.str(w, "database")
        + "?sslMode="
        + (tls ? "VERIFY_IDENTITY" : "DISABLED")
        + "&connectTimeout=5000&socketTimeout=20000&allowMultiQueries=false&allowLoadLocalInfile=false&allowUrlInLocalInfile=false&serverTimezone=UTC";
  }
}

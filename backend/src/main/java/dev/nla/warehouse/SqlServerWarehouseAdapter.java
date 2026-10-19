package dev.nla.warehouse;

import dev.nla.Json;
import java.util.Map;

public final class SqlServerWarehouseAdapter extends JdbcWarehouseAdapter {
  public SqlServerWarehouseAdapter(boolean tls) {
    super(tls);
  }

  public String engine() {
    return "SQL_SERVER";
  }

  public SqlDialect getSqlDialect() {
    return new SqlServerDialect();
  }

  protected String jdbcUrl(Map<String, Object> w) {
    return "jdbc:sqlserver://"
        + Json.str(w, "host")
        + ":"
        + w.get("port")
        + ";databaseName="
        + Json.str(w, "database")
        + ";encrypt="
        + tls
        + ";trustServerCertificate=false;loginTimeout=5;socketTimeout=20000;applicationIntent=ReadOnly";
  }
}

package dev.nla.warehouse;

import dev.nla.Json;
import java.sql.*;
import java.time.*;
import java.util.*;

public abstract class JdbcWarehouseAdapter implements WarehouseAdapter {
  protected final boolean tls;
  private final DataToolRuntimeClient dataRuntime = DataToolRuntimeClient.configured();

  protected JdbcWarehouseAdapter(boolean tls) {
    this.tls = tls;
  }

  protected abstract String jdbcUrl(Map<String, Object> w);

  protected String jdbcWriterUrl(Map<String, Object> warehouse) {
    return jdbcUrl(warehouse);
  }

  public Connection connect(Map<String, Object> w, String password) throws SQLException {
    Properties props = new Properties();
    props.setProperty("user", Json.str(w, "username"));
    props.setProperty("password", password);
    props.setProperty("connectTimeout", engine().equals("POSTGRESQL") ? "5" : "5000");
    props.setProperty("socketTimeout", engine().equals("POSTGRESQL") ? "20" : "20000");
    if (engine().equals("MYSQL") && !tls) {
      String key = System.getenv("NLA_MYSQL_RSA_PUBLIC_KEY");
      if (key != null && !key.isBlank()) props.setProperty("serverRSAPublicKeyFile", key);
    }
    return DriverManager.getConnection(jdbcUrl(w), props);
  }

  public Connection connectForWrite(Map<String, Object> warehouse, String password)
      throws SQLException {
    Properties props = new Properties();
    props.setProperty("user", Json.str(warehouse, "username"));
    props.setProperty("password", password);
    props.setProperty("connectTimeout", engine().equals("POSTGRESQL") ? "5" : "5000");
    props.setProperty("socketTimeout", engine().equals("POSTGRESQL") ? "20" : "20000");
    if (engine().equals("MYSQL") && !tls) {
      String key = System.getenv("NLA_MYSQL_RSA_PUBLIC_KEY");
      if (key != null && !key.isBlank()) props.setProperty("serverRSAPublicKeyFile", key);
    }
    return DriverManager.getConnection(jdbcWriterUrl(warehouse), props);
  }

  public boolean testConnection(Map<String, Object> w, String password) throws SQLException {
    try (Connection c = connect(w, password)) {
      return c.isValid(5);
    }
  }

  public Map<String, Boolean> getCapabilities() {
    return Map.of("readOnlyQuery", true, "metadataDiscovery", true);
  }

  public String applySafeLimit(String sql, int rows) {
    return getSqlDialect().applySafeLimit(sql, rows);
  }

  public void configureTimeout(Statement stmt, int seconds) throws SQLException {
    stmt.setQueryTimeout(seconds);
  }

  public String quoteIdentifier(String id) {
    return getSqlDialect().quoteIdentifier(id);
  }

  public String normalizeIdentifier(Connection c, String id, boolean quoted) throws SQLException {
    var m = c.getMetaData();
    if (quoted) return id;
    if (m.storesLowerCaseIdentifiers()) return id.toLowerCase(Locale.ROOT);
    if (m.storesUpperCaseIdentifiers()) return id.toUpperCase(Locale.ROOT);
    return id;
  }

  protected String catalog(Connection c, String schema) throws SQLException {
    return engine().equals("MYSQL") ? schema : c.getCatalog();
  }

  protected String schemaPattern(String schema) {
    return engine().equals("MYSQL") ? null : schema;
  }

  public List<String> discoverSchemas(Connection c) throws SQLException {
    List<String> names = new ArrayList<>();
    if (engine().equals("MYSQL")) {
      try (ResultSet catalogs = c.getMetaData().getCatalogs()) {
        while (catalogs.next()) {
          String name = catalogs.getString("TABLE_CAT");
          if (!Set.of("information_schema", "mysql", "performance_schema", "sys").contains(name)) {
            names.add(name);
          }
        }
      }
      return names;
    }
    try (ResultSet rs = c.getMetaData().getSchemas()) {
      while (rs.next()) {
        String n = rs.getString("TABLE_SCHEM");
        if (!Set.of("information_schema", "sys", "guest").contains(n)
            && !n.startsWith("pg_")
            && !n.startsWith("db_")) names.add(n);
      }
    }
    return names;
  }

  public List<Map<String, Object>> discoverTables(Connection c, Set<String> requested)
      throws SQLException {
    List<Map<String, Object>> tables = new ArrayList<>();
    for (String schema : discoverSchemas(c)) {
      if (!requested.isEmpty() && !requested.contains(schema)) continue;
      var descriptions = NativeMetadataDescriptions.load(c, engine(), schema);
      try (ResultSet rs =
          c.getMetaData()
              .getTables(
                  catalog(c, schema), schemaPattern(schema), "%", new String[] {"TABLE", "VIEW"})) {
        while (rs.next()) {
          String name = rs.getString("TABLE_NAME");
          List<String> pk = new ArrayList<>();
          try (ResultSet keys =
              c.getMetaData().getPrimaryKeys(catalog(c, schema), schemaPattern(schema), name)) {
            while (keys.next()) pk.add(keys.getString("COLUMN_NAME"));
          }
          String id =
              Base64.getUrlEncoder()
                  .withoutPadding()
                  .encodeToString(
                      (schema + "\u0000" + name).getBytes(java.nio.charset.StandardCharsets.UTF_8));
          tables.add(
              Json.obj(
                  "tableId",
                  id,
                  "schema",
                  schema,
                  "name",
                  name,
                  "logicalName",
                  name,
                  "description",
                  descriptions.table(name, rs.getString("REMARKS")),
                  "grain",
                  pk.isEmpty() ? "Physical table/view" : "One row per " + String.join(", ", pk),
                  "columns",
                  discoverColumns(c, schema, name, descriptions),
                  "queryable",
                  true,
                  "category",
                  schema,
                  "status",
                  "PUBLISHED",
                  "primaryKey",
                  pk,
                  "foreignKeys",
                  discoverRelationships(c, schema, name)));
        }
      }
    }
    return tables;
  }

  public List<Map<String, Object>> discoverColumns(Connection c, String schema, String table)
      throws SQLException {
    return discoverColumns(c, schema, table, NativeMetadataDescriptions.load(c, engine(), schema));
  }

  private List<Map<String, Object>> discoverColumns(
      Connection c, String schema, String table, NativeMetadataDescriptions descriptions)
      throws SQLException {
    List<Map<String, Object>> columns = new ArrayList<>();
    try (ResultSet rs =
        c.getMetaData().getColumns(catalog(c, schema), schemaPattern(schema), table, "%")) {
      while (rs.next())
        columns.add(
            Json.obj(
                "name",
                rs.getString("COLUMN_NAME"),
                "dataType",
                canonicalType(rs.getInt("DATA_TYPE")),
                "nullable",
                rs.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls,
                "description",
                descriptions.column(table, rs.getString("COLUMN_NAME"), rs.getString("REMARKS")),
                "synonyms",
                List.of()));
    }
    return columns;
  }

  public List<Map<String, Object>> discoverRelationships(Connection c, String schema, String table)
      throws SQLException {
    List<Map<String, Object>> rel = new ArrayList<>();
    try (ResultSet rs =
        c.getMetaData().getImportedKeys(catalog(c, schema), schemaPattern(schema), table)) {
      while (rs.next()) {
        String targetSchema =
            engine().equals("MYSQL") ? rs.getString("PKTABLE_CAT") : rs.getString("PKTABLE_SCHEM");
        rel.add(
            Json.obj(
                "from",
                Json.obj(
                    "table",
                    Json.obj("schema", schema, "name", table),
                    "column",
                    rs.getString("FKCOLUMN_NAME")),
                "to",
                Json.obj(
                    "table",
                    Json.obj("schema", targetSchema, "name", rs.getString("PKTABLE_NAME")),
                    "column",
                    rs.getString("PKCOLUMN_NAME")),
                "cardinality",
                "MANY_TO_ONE"));
      }
    }
    return rel;
  }

  public Map<String, Object> executeReadOnlyQuery(
      Map<String, Object> w, String password, String sql, int maxRows, int maxBytes, int timeout)
      throws SQLException {
    if (dataRuntime != null) {
      return dataRuntime.execute(
          w, password, tls, applySafeLimit(sql, maxRows + 1), maxRows, maxBytes, timeout);
    }
    try (Connection c = connect(w, password)) {
      c.setReadOnly(true);
      c.setAutoCommit(false);
      try {
        if (engine().equals("POSTGRESQL")) {
          try (Statement config = c.createStatement()) {
            config.execute("SET LOCAL statement_timeout = " + (timeout * 1000));
          }
        }
        try (Statement statement = c.createStatement()) {
          configureTimeout(statement, timeout);
          statement.setMaxRows(maxRows + 1);
          statement.setFetchSize(Math.min(maxRows + 1, 100));
          try (ResultSet rs = statement.executeQuery(applySafeLimit(sql, maxRows + 1))) {
            List<Map<String, Object>> columns = new ArrayList<>(), rows = new ArrayList<>();
            var meta = rs.getMetaData();
            Set<String> used = new HashSet<>();
            for (int i = 1; i <= meta.getColumnCount(); i++) {
              String label = meta.getColumnLabel(i), name = label;
              int suffix = 2;
              while (!used.add(name)) name = label + "_" + suffix++;
              String type = canonicalType(meta.getColumnType(i));
              columns.add(
                  Json.obj(
                      "name",
                      name,
                      "label",
                      label,
                      "dataType",
                      type,
                      "semanticRole",
                      Set.of("INTEGER", "BIGINT", "DECIMAL", "FLOAT").contains(type)
                          ? "METRIC"
                          : Set.of("DATE", "TIMESTAMP").contains(type) ? "TIME" : "DIMENSION"));
            }
            int bytes = 0;
            boolean truncated = false;
            while (rs.next()) {
              if (rows.size() == maxRows) {
                truncated = true;
                break;
              }
              Map<String, Object> row = new LinkedHashMap<>();
              for (int i = 1; i <= columns.size(); i++) {
                String type = columns.get(i - 1).get("dataType").toString();
                Object value = rs.getObject(i);
                if (value != null)
                  value =
                      switch (type) {
                        case "DECIMAL" -> rs.getBigDecimal(i).toPlainString();
                        case "BIGINT" -> rs.getString(i);
                        case "BOOLEAN" -> rs.getBoolean(i);
                        case "TIMESTAMP" -> {
                          if (value instanceof OffsetDateTime od) yield od.toInstant().toString();
                          if (value instanceof Timestamp ts)
                            yield ts.toLocalDateTime().toInstant(ZoneOffset.UTC).toString();
                          yield value.toString();
                        }
                        case "DATE" -> rs.getDate(i).toLocalDate().toString();
                        case "FLOAT" -> rs.getDouble(i);
                        case "INTEGER" -> rs.getInt(i);
                        default -> value.toString();
                      };
                row.put(columns.get(i - 1).get("name").toString(), value);
              }
              int n = Json.write(row).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
              if (bytes + n > maxBytes) {
                truncated = true;
                break;
              }
              bytes += n;
              rows.add(row);
            }
            return Json.obj(
                "columns",
                columns,
                "rows",
                rows,
                "returnedRowCount",
                rows.size(),
                "page",
                1,
                "pageSize",
                Math.min(100, Math.max(20, rows.size())),
                "truncated",
                truncated);
          }
        }
      } finally {
        c.rollback();
      }
    }
  }

  public static String canonicalType(int type) {
    return switch (type) {
      case Types.TINYINT, Types.SMALLINT, Types.INTEGER -> "INTEGER";
      case Types.BIGINT -> "BIGINT";
      case Types.NUMERIC, Types.DECIMAL -> "DECIMAL";
      case Types.FLOAT, Types.DOUBLE, Types.REAL -> "FLOAT";
      case Types.BOOLEAN, Types.BIT -> "BOOLEAN";
      case Types.DATE -> "DATE";
      case Types.TIMESTAMP, Types.TIMESTAMP_WITH_TIMEZONE -> "TIMESTAMP";
      default -> "STRING";
    };
  }
}

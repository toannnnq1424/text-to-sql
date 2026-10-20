package dev.nla.warehouse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Description-only native catalog queries adapted from the Apache-2.0 data-tool-runtime source. No
 * SQL supplied by a caller is executed. JDBC still owns physical identity, types and keys.
 */
public final class NativeMetadataDescriptions {
  static final int MAX_ROWS = 10000;
  static final int MAX_DESCRIPTION_CHARS = 4000;
  static final int MAX_TOTAL_BYTES = 2 * 1024 * 1024;
  private static final Map<String, String> QUERIES = loadQueries();
  private final Map<String, String> tables;
  private final Map<String, Map<String, String>> columns;

  private NativeMetadataDescriptions(
      Map<String, String> tables, Map<String, Map<String, String>> columns) {
    this.tables = Map.copyOf(tables);
    var frozen = new HashMap<String, Map<String, String>>();
    columns.forEach((table, comments) -> frozen.put(table, Map.copyOf(comments)));
    this.columns = Map.copyOf(frozen);
  }

  public static NativeMetadataDescriptions load(Connection connection, String engine, String schema)
      throws SQLException {
    String query = QUERIES.get(engine);
    if (query == null) throw new SQLException("Unsupported metadata engine.", "0A000");
    var tables = new HashMap<String, String>();
    var columns = new HashMap<String, Map<String, String>>();
    try (var statement = connection.prepareStatement(query)) {
      statement.setString(1, schema);
      statement.setQueryTimeout(5);
      statement.setMaxRows(MAX_ROWS + 1);
      statement.setFetchSize(128);
      try (var rows = statement.executeQuery()) {
        int count = 0;
        int bytes = 0;
        while (rows.next()) {
          if (++count > MAX_ROWS) throw boundsExceeded();
          String table = rows.getString("table_name");
          String column = rows.getString("column_name");
          String description = bounded(rows.getString("description"));
          bytes += description.getBytes(StandardCharsets.UTF_8).length;
          if (bytes > MAX_TOTAL_BYTES) throw boundsExceeded();
          if (table == null || description.isBlank()) continue;
          if (column == null) tables.put(table, description);
          else columns.computeIfAbsent(table, ignored -> new HashMap<>()).put(column, description);
        }
      }
    }
    return new NativeMetadataDescriptions(tables, columns);
  }

  public String table(String table, String jdbcRemark) {
    return tables.getOrDefault(table, bounded(jdbcRemark));
  }

  public String column(String table, String column, String jdbcRemark) {
    return columns.getOrDefault(table, Map.of()).getOrDefault(column, bounded(jdbcRemark));
  }

  private static String bounded(String value) {
    String text = Objects.toString(value, "");
    int size = text.codePointCount(0, text.length());
    return size <= MAX_DESCRIPTION_CHARS
        ? text
        : text.substring(0, text.offsetByCodePoints(0, MAX_DESCRIPTION_CHARS));
  }

  private static SQLException boundsExceeded() {
    return new SQLException("Metadata descriptions exceed server bounds.", "54000");
  }

  private static Map<String, String> loadQueries() {
    Map<String, String> paths =
        Map.of(
            "POSTGRESQL", "postgresql-descriptions.sql",
            "MYSQL", "mysql-descriptions.sql",
            "SQL_SERVER", "sql-server-descriptions.sql");
    var result = new HashMap<String, String>();
    paths.forEach(
        (engine, filename) -> {
          try (var resource =
              NativeMetadataDescriptions.class.getResourceAsStream("/metadata/" + filename)) {
            if (resource == null) throw new IOException("Missing metadata query resource.");
            result.put(engine, new String(resource.readAllBytes(), StandardCharsets.UTF_8));
          } catch (IOException error) {
            throw new ExceptionInInitializerError(error);
          }
        });
    return Map.copyOf(result);
  }
}

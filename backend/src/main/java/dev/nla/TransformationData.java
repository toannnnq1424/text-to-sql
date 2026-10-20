package dev.nla;

import dev.nla.warehouse.JdbcWarehouseAdapter;
import dev.nla.warehouse.WarehouseAdapter;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.schema.Table;
import net.sf.jsqlparser.statement.select.Select;

/** Typed preview parameters and bounded JDBC rows; source values never reach Python. */
final class TransformationData {
  private TransformationData() {}

  static void interrupted() throws SQLException {
    if (Thread.currentThread().isInterrupted()) {
      throw new SQLException("Transformation interrupted", "57014");
    }
  }

  static List<Map<String, Object>> columns(Object value) {
    var incoming = Json.objects(value);
    if (incoming.isEmpty() || incoming.size() > 200) {
      throw ApiException.bad("Pipeline cần từ 1 đến 200 cột.");
    }
    Set<String> names = new HashSet<>();
    List<Map<String, Object>> columns = new ArrayList<>();
    for (var column : incoming) {
      String name = Json.str(column, "name");
      // Physical metadata can contain spaces, punctuation and Unicode. It is always quoted;
      // the UTF-8 byte bound keeps the new RAW table portable to PostgreSQL's identifier limit.
      if (name.isBlank()
          || name.getBytes(StandardCharsets.UTF_8).length > 63
          || name.chars().anyMatch(Character::isISOControl)
          || !names.add(name.toLowerCase(java.util.Locale.ROOT))) {
        throw ApiException.bad(
            "Tên cột không hợp lệ hoặc trùng nhau khi chuyển sang warehouse đích.");
      }
      String type = Json.str(column, "dataType");
      if (type.equals("INTEGER")) {
        type = "BIGINT";
      }
      if (type.equals("FLOAT")) {
        type = "DECIMAL";
      }
      if (!FileTypes.TYPES.contains(type)) {
        throw ApiException.bad("Kiểu cột không được pipeline hỗ trợ.");
      }
      columns.add(Json.obj("name", name, "dataType", type, "nullable", true));
    }
    return columns;
  }

  static Map<String, Object> read(ResultSet rows, int maxRows, int maxBytes) throws SQLException {
    var metadata = rows.getMetaData();
    List<Map<String, Object>> original = new ArrayList<>();
    for (int index = 1; index <= metadata.getColumnCount(); index++) {
      original.add(
          Json.obj(
              "name",
              metadata.getColumnLabel(index),
              "dataType",
              JdbcWarehouseAdapter.canonicalType(metadata.getColumnType(index))));
    }
    var columns = columns(original);
    List<Map<String, Object>> values = new ArrayList<>();
    int bytes = 0;
    while (rows.next()) {
      interrupted();
      if (values.size() >= maxRows) {
        throw ApiException.bad("Kết quả pipeline vượt giới hạn dòng; chưa nạp toàn bộ dữ liệu.");
      }
      Map<String, Object> row = new LinkedHashMap<>();
      for (int index = 1; index <= columns.size(); index++) {
        var column = columns.get(index - 1);
        Object value = rows.getObject(index);
        if (value != null) {
          String type = Json.str(column, "dataType");
          value =
              switch (type) {
                case "DECIMAL" -> rows.getBigDecimal(index).toPlainString();
                case "BOOLEAN" -> rows.getBoolean(index);
                case "TIMESTAMP" -> {
                  if (value instanceof java.time.OffsetDateTime offset) {
                    yield offset
                        .withOffsetSameInstant(java.time.ZoneOffset.UTC)
                        .toLocalDateTime()
                        .toString();
                  }
                  if (metadata.getColumnType(index) == java.sql.Types.TIMESTAMP_WITH_TIMEZONE) {
                    yield rows.getTimestamp(index)
                        .toInstant()
                        .atOffset(java.time.ZoneOffset.UTC)
                        .toLocalDateTime()
                        .toString();
                  }
                  yield rows.getTimestamp(index).toLocalDateTime().toString();
                }
                case "DATE" -> rows.getDate(index).toLocalDate().toString();
                default -> rows.getString(index);
              };
        }
        // Conversion is checked before CREATE/INSERT, including precision and cell bounds.
        FileTypes.convert(value, column);
        row.put(Json.str(column, "name"), value);
      }
      bytes += Json.write(row).getBytes(StandardCharsets.UTF_8).length;
      if (bytes > maxBytes) {
        throw ApiException.bad("Kết quả pipeline vượt giới hạn dung lượng.");
      }
      values.add(row);
    }
    return Json.obj("columns", columns, "rows", values, "rowCount", values.size());
  }

  static Select parse(String sql, String engine) throws Exception {
    var statement =
        CCJSqlParserUtil.parse(
            sql, parser -> parser.withSquareBracketQuotation(engine.equals("SQL_SERVER")));
    if (!(statement instanceof Select select)) {
      throw ApiException.bad("Transform phải là SELECT.");
    }
    var plain = select.getPlainSelect();
    if (plain == null
        || !(plain.getFromItem() instanceof Table input)
        || !input
            .getName()
            .replace("\"", "")
            .replace("`", "")
            .replace("[", "")
            .replace("]", "")
            .equals("__nla_input")
        || (plain.getJoins() != null && !plain.getJoins().isEmpty())) {
      throw ApiException.bad("Transform phải có đúng một nguồn đầu vào.");
    }
    return select;
  }

  static String substitute(String sql, String inputSql, String engine) throws Exception {
    var select = parse(sql, engine);
    var replacement =
        ((Select)
                CCJSqlParserUtil.parse(
                    "SELECT * FROM (" + inputSql + ") input",
                    parser -> parser.withSquareBracketQuotation(engine.equals("SQL_SERVER"))))
            .getPlainSelect()
            .getFromItem();
    select.getPlainSelect().setFromItem(replacement);
    return select.toString();
  }

  static String targetSql(String sql, WarehouseAdapter adapter, String schema, String table)
      throws Exception {
    var select = parse(sql, adapter.engine());
    var input = (Table) select.getPlainSelect().getFromItem();
    input.setName(adapter.quoteIdentifier(table));
    input.setSchemaName(adapter.quoteIdentifier(schema));
    return select.toString();
  }

  static String inputSelect(WarehouseAdapter adapter, List<Map<String, Object>> columns, int rows) {
    String engine = adapter.engine();
    String fields =
        columns.stream()
            .map(
                column -> {
                  String type = Json.str(column, "dataType");
                  String cast = FileTypes.sqlType(type, engine);
                  if (engine.equals("MYSQL")) {
                    cast =
                        switch (type) {
                          case "BIGINT" -> "SIGNED";
                          case "STRING" -> "CHAR";
                          case "BOOLEAN" -> "UNSIGNED";
                          default -> cast;
                        };
                  }
                  return "CAST("
                      + (rows == 0 ? "NULL" : "?")
                      + " AS "
                      + cast
                      + ") AS "
                      + adapter.quoteIdentifier(Json.str(column, "name"));
                })
            .collect(Collectors.joining(","));
    if (rows == 0) {
      return "SELECT " + fields + " WHERE 1=0";
    }
    return String.join(" UNION ALL ", Collections.nCopies(rows, "SELECT " + fields));
  }

  static Map<String, Object> preview(
      Connection connection,
      WarehouseAdapter adapter,
      String sql,
      Map<String, Object> input,
      int timeout,
      int maxBytes)
      throws Exception {
    var columns = Json.objects(input.get("columns"));
    var rows = Json.objects(input.get("rows"));
    int count = Math.min(Math.min(20, 1900 / columns.size()), rows.size());
    String query = substitute(sql, inputSelect(adapter, columns, count), adapter.engine());
    try (var statement = connection.prepareStatement(adapter.applySafeLimit(query, 21))) {
      adapter.configureTimeout(statement, timeout);
      statement.setMaxRows(21);
      int parameter = 1;
      for (int index = 0; index < count; index++) {
        for (var column : columns) {
          FileTypes.bind(
              statement,
              parameter++,
              FileTypes.convert(rows.get(index).get(column.get("name")), column));
        }
      }
      try (var result = statement.executeQuery()) {
        return read(result, 20, maxBytes);
      }
    }
  }

  static String qualified(WarehouseAdapter adapter, String schema, String table) {
    return adapter.quoteIdentifier(schema) + "." + adapter.quoteIdentifier(table);
  }

  static void createAndLoad(
      Connection connection,
      WarehouseAdapter adapter,
      String target,
      Map<String, Object> data,
      int timeout,
      Runnable created)
      throws Exception {
    createAndLoad(
        connection, adapter, target, data, timeout, created, Instant.now().plusSeconds(300));
  }

  static void createAndLoad(
      Connection connection,
      WarehouseAdapter adapter,
      String target,
      Map<String, Object> data,
      int timeout,
      Runnable created,
      Instant deadline)
      throws Exception {
    var columns = Json.objects(data.get("columns"));
    String definitions =
        columns.stream()
            .map(
                column ->
                    adapter.quoteIdentifier(Json.str(column, "name"))
                        + " "
                        + FileTypes.sqlType(Json.str(column, "dataType"), adapter.engine()))
            .collect(Collectors.joining(","));
    interrupted();
    try (var statement = connection.createStatement()) {
      adapter.configureTimeout(statement, timeout);
      boundedTimeout(statement, adapter, timeout, deadline);
      statement.executeUpdate("CREATE TABLE " + target + " (" + definitions + ")");
    }
    created.run();
    String names =
        columns.stream()
            .map(column -> adapter.quoteIdentifier(Json.str(column, "name")))
            .collect(Collectors.joining(","));
    String placeholders = String.join(",", Collections.nCopies(columns.size(), "?"));
    try (var statement =
        connection.prepareStatement(
            "INSERT INTO " + target + " (" + names + ") VALUES (" + placeholders + ")")) {
      adapter.configureTimeout(statement, timeout);
      int count = 0;
      for (var row : Json.objects(data.get("rows"))) {
        interrupted();
        for (int index = 0; index < columns.size(); index++) {
          var column = columns.get(index);
          FileTypes.bind(
              statement, index + 1, FileTypes.convert(row.get(column.get("name")), column));
        }
        statement.addBatch();
        if (++count % 500 == 0) {
          boundedTimeout(statement, adapter, timeout, deadline);
          statement.executeBatch();
          statement.clearBatch();
        }
      }
      boundedTimeout(statement, adapter, timeout, deadline);
      statement.executeBatch();
    }
  }

  private static void boundedTimeout(
      java.sql.Statement statement, WarehouseAdapter adapter, int timeout, Instant deadline)
      throws SQLException {
    interrupted();
    long remaining = Duration.between(Instant.now(), deadline).toSeconds();
    if (remaining < 1) {
      throw new SQLTimeoutException("Transformation deadline exceeded");
    }
    adapter.configureTimeout(statement, (int) Math.min(timeout, remaining));
  }
}

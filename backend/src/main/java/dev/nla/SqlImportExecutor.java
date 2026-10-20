package dev.nla;

import dev.nla.SqlImportParser.Step;
import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.WarehouseAdapter;
import java.math.BigDecimal;
import java.sql.*;
import java.util.*;
import java.util.stream.Collectors;

/** Generates SQL only from a parsed canonical plan; file text is never executed. */
final class SqlImportExecutor {
  static final class Failure extends RuntimeException {
    final boolean partial;

    Failure(Throwable cause, boolean partial) {
      super(cause);
      this.partial = partial;
    }
  }

  static void execute(
      Adapters adapters,
      Map<String, Object> warehouse,
      String username,
      String credentialReference,
      Map<String, Object> plan,
      List<Map<String, Object>> steps,
      Map<String, Object> run)
      throws SQLException {
    execute(adapters, warehouse, username, credentialReference, plan, steps, run, ignored -> {});
  }

  static void execute(
      Adapters adapters,
      Map<String, Object> warehouse,
      String username,
      String credentialReference,
      Map<String, Object> plan,
      List<Map<String, Object>> steps,
      Map<String, Object> run,
      java.util.function.Consumer<Map<String, Object>> progress)
      throws SQLException {
    Map<String, Object> writer = new LinkedHashMap<>(warehouse);
    writer.put("username", username);
    String engine = Json.str(warehouse, "engine");
    if (engine.equals("MYSQL")) writer.put("database", Json.str(plan, "targetSchema"));
    WarehouseAdapter adapter = adapters.get(writer);
    List<Map<String, Object>> results = Json.objects(run.get("steps"));
    int committedThrough = -1;
    long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(60);
    try (Connection connection =
        adapter.connectForWrite(writer, adapters.password(credentialReference))) {
      connection.setAutoCommit(false);
      try {
        for (int i = 0; i < steps.size(); i++) {
          if (Thread.currentThread().isInterrupted() || System.nanoTime() >= deadline)
            throw new java.sql.SQLTimeoutException("Import deadline exceeded");
          var step = steps.get(i);
          var result = results.get(i);
          result.put("status", "RUNNING");
          progress.accept(run);
          String kind = Json.str(step, "kind");
          boolean ddl = Set.of("CREATE_TABLE", "CREATE_INDEX").contains(kind);
          // MySQL commits pending DML before DDL, including a DDL statement that fails.
          if (engine.equals("MYSQL") && ddl) committedThrough = i - 1;
          switch (kind) {
            case "CREATE_SCHEMA" -> {
              /* Validated declaration for a pre-provisioned namespace. */
            }
            case "CREATE_TABLE", "CREATE_INDEX" -> {
              String sql =
                  kind.equals("CREATE_TABLE")
                      ? createTable(adapter, engine, step)
                      : createIndex(adapter, step);
              try (Statement statement = connection.createStatement()) {
                boundedTimeout(statement, adapter, deadline);
                statement.executeUpdate(sql);
              }
              if (engine.equals("MYSQL")) committedThrough = i;
            }
            case "INSERT" ->
                result.put("rowsAffected", insert(connection, adapter, engine, step, deadline));
            default -> throw new SQLException("Unknown canonical import action");
          }
          result.put("status", "SUCCESS");
          run.put("completedStatements", i + 1);
          progress.accept(run);
        }
        synchronizeIdentities(connection, adapter, engine, steps, deadline);
        connection.commit();
        run.put(
            "rowsAffected",
            results.stream().mapToLong(r -> ((Number) r.get("rowsAffected")).longValue()).sum());
      } catch (Exception failure) {
        boolean rollbackFailed = false;
        try {
          connection.rollback();
        } catch (SQLException rollback) {
          rollbackFailed = true;
        }
        for (int i = 0; i < results.size(); i++) {
          var result = results.get(i);
          String status = Json.str(result, "status");
          if (status.equals("RUNNING")) {
            result.put("status", "FAILED");
            result.put("rowsAffected", 0);
            result.put(
                "error",
                Errors.body("SQL_IMPORT_EXECUTION_ERROR", "Câu lệnh không hoàn tất.", Json.obj()));
          } else if (status.equals("PENDING")) result.put("status", "SKIPPED");
          else if (status.equals("SUCCESS") && i > committedThrough && !rollbackFailed) {
            result.put("status", "ROLLED_BACK");
            result.put("rowsAffected", 0);
          }
        }
        run.put(
            "rowsAffected",
            results.stream()
                .filter(r -> "SUCCESS".equals(r.get("status")))
                .mapToLong(r -> ((Number) r.get("rowsAffected")).longValue())
                .sum());
        run.put(
            "completedStatements",
            results.stream().filter(r -> "SUCCESS".equals(r.get("status"))).count());
        throw new Failure(failure, committedThrough >= 0 || rollbackFailed);
      }
    }
  }

  private static void boundedTimeout(Statement statement, WarehouseAdapter adapter, long deadline)
      throws SQLException {
    long remaining = deadline - System.nanoTime();
    if (Thread.currentThread().isInterrupted() || remaining <= 0)
      throw new SQLTimeoutException("Import deadline exceeded");
    adapter.configureTimeout(
        statement,
        (int)
            Math.min(
                20, Math.max(1, java.util.concurrent.TimeUnit.NANOSECONDS.toSeconds(remaining))));
  }

  static Map<String, Object> document(Step step) {
    return Json.obj(
        "index",
        step.index(),
        "kind",
        step.kind().name(),
        "schema",
        step.schema(),
        "table",
        step.table(),
        "columns",
        step.columns().stream()
            .map(
                c ->
                    Json.obj(
                        "name",
                        c.name(),
                        "type",
                        c.type(),
                        "nullable",
                        c.nullable(),
                        "identity",
                        c.type().endsWith(" IDENTITY"),
                        "primaryKey",
                        c.primaryKey(),
                        "unique",
                        c.unique(),
                        "hasDefault",
                        c.hasDefault(),
                        "defaultValue",
                        c.defaultValue()))
            .toList(),
        "constraints",
        step.constraints().stream()
            .map(
                c ->
                    Json.obj(
                        "kind",
                        c.kind(),
                        "name",
                        c.name(),
                        "columns",
                        c.columns(),
                        "referenceSchema",
                        c.referenceSchema(),
                        "referenceTable",
                        c.referenceTable(),
                        "referenceColumns",
                        c.referenceColumns()))
            .toList(),
        "insertColumns",
        step.insertColumns(),
        "rows",
        step.rows(),
        "indexName",
        step.indexName(),
        "uniqueIndex",
        step.uniqueIndex());
  }

  static String qualified(WarehouseAdapter adapter, Map<String, Object> step) {
    return adapter.quoteIdentifier(Json.str(step, "schema"))
        + "."
        + adapter.quoteIdentifier(Json.str(step, "table"));
  }

  private static String names(WarehouseAdapter adapter, Object values) {
    return ((List<?>) values)
        .stream()
            .map(Object::toString)
            .map(adapter::quoteIdentifier)
            .collect(Collectors.joining(","));
  }

  static String createIndex(WarehouseAdapter adapter, Map<String, Object> step) {
    return "CREATE "
        + (Boolean.TRUE.equals(step.get("uniqueIndex")) ? "UNIQUE " : "")
        + "INDEX "
        + adapter.quoteIdentifier(Json.str(step, "indexName"))
        + " ON "
        + qualified(adapter, step)
        + " ("
        + names(adapter, step.get("insertColumns"))
        + ")";
  }

  static String createTable(WarehouseAdapter adapter, String engine, Map<String, Object> step) {
    List<String> definitions = new ArrayList<>();
    List<Map<String, Object>> constraints = Json.objects(step.get("constraints"));
    for (var column : Json.objects(step.get("columns"))) {
      String type = Json.str(column, "type"), name = Json.str(column, "name");
      boolean primary =
          constraints.stream()
              .anyMatch(
                  c ->
                      "PRIMARY_KEY".equals(c.get("kind"))
                          && ((List<?>) c.get("columns")).contains(name));
      String definition = adapter.quoteIdentifier(name) + " " + targetType(type, engine);
      if (Boolean.TRUE.equals(column.get("identity")))
        definition +=
            switch (engine) {
              case "POSTGRESQL" -> " GENERATED BY DEFAULT AS IDENTITY";
              case "MYSQL" -> " AUTO_INCREMENT";
              case "SQL_SERVER" -> " IDENTITY(1,1)";
              default -> throw new IllegalArgumentException("Unsupported target engine");
            };
      if (primary
          || Boolean.FALSE.equals(column.get("nullable"))
          || Boolean.TRUE.equals(column.get("identity"))) definition += " NOT NULL";
      if (Boolean.TRUE.equals(column.get("hasDefault")))
        definition += " DEFAULT " + defaultLiteral(column.get("defaultValue"), type, engine);
      definitions.add(definition);
    }
    for (var constraint : constraints) {
      String columns = names(adapter, constraint.get("columns"));
      String declaration =
          Json.str(constraint, "name").isBlank()
              ? ""
              : "CONSTRAINT " + adapter.quoteIdentifier(Json.str(constraint, "name")) + " ";
      declaration +=
          switch (Json.str(constraint, "kind")) {
            case "PRIMARY_KEY" -> "PRIMARY KEY (" + columns + ")";
            case "UNIQUE" -> "UNIQUE (" + columns + ")";
            case "FOREIGN_KEY" ->
                "FOREIGN KEY ("
                    + columns
                    + ") REFERENCES "
                    + adapter.quoteIdentifier(Json.str(constraint, "referenceSchema"))
                    + "."
                    + adapter.quoteIdentifier(Json.str(constraint, "referenceTable"))
                    + " ("
                    + names(adapter, constraint.get("referenceColumns"))
                    + ")";
            default -> throw new IllegalArgumentException("Unsupported canonical constraint");
          };
      definitions.add(declaration);
    }
    return "CREATE TABLE " + qualified(adapter, step) + " (" + String.join(",", definitions) + ")";
  }

  static String targetType(String source, String engine) {
    String type = source.replace(" IDENTITY", "");
    if (type.equals("BOOLEAN")) return engine.equals("SQL_SERVER") ? "BIT" : "BOOLEAN";
    if (type.equals("DOUBLE"))
      return engine.equals("MYSQL")
          ? "DOUBLE"
          : engine.equals("POSTGRESQL") ? "DOUBLE PRECISION" : "FLOAT(53)";
    if (type.equals("FLOAT")) return engine.equals("POSTGRESQL") ? "DOUBLE PRECISION" : "FLOAT";
    if (type.equals("TEXT")) return engine.equals("SQL_SERVER") ? "NVARCHAR(MAX)" : "TEXT";
    if (type.startsWith("VARCHAR") || type.startsWith("CHAR"))
      return engine.equals("SQL_SERVER") ? "N" + type : type;
    if (type.startsWith("TIMESTAMP"))
      return type.replace(
          "TIMESTAMP",
          engine.equals("MYSQL")
              ? "DATETIME"
              : engine.equals("SQL_SERVER") ? "DATETIME2" : "TIMESTAMP");
    return type;
  }

  private static String defaultLiteral(Object value, String type, String engine) {
    if (value == null) return "NULL";
    if (type.equals("BOOLEAN")) {
      boolean bool =
          value instanceof Boolean b ? b : new BigDecimal(value.toString()).intValueExact() == 1;
      return engine.equals("SQL_SERVER") ? (bool ? "1" : "0") : (bool ? "TRUE" : "FALSE");
    }
    if (value instanceof Number) return value.toString();
    String text = value.toString();
    if (engine.equals("MYSQL"))
      return "(CONVERT(X'"
          + java.util.HexFormat.of()
              .formatHex(text.getBytes(java.nio.charset.StandardCharsets.UTF_8))
          + "' USING utf8mb4))";
    if (engine.equals("POSTGRESQL"))
      return "E'" + text.replace("\\", "\\\\").replace("'", "''") + "'";
    return "N'" + text.replace("'", "''") + "'";
  }

  private static int insert(
      Connection connection,
      WarehouseAdapter adapter,
      String engine,
      Map<String, Object> step,
      long deadline)
      throws SQLException {
    List<String> columns =
        ((List<?>) step.get("insertColumns")).stream().map(Object::toString).toList();
    Map<String, String> types = new HashMap<>();
    boolean explicitIdentity = false;
    for (var column : Json.objects(step.get("tableColumns"))) {
      types.put(Json.str(column, "name"), Json.str(column, "type"));
      if (Boolean.TRUE.equals(column.get("identity")) && columns.contains(Json.str(column, "name")))
        explicitIdentity = true;
    }
    String target = qualified(adapter, step);
    String sql =
        "INSERT INTO "
            + target
            + " ("
            + names(adapter, columns)
            + ") VALUES ("
            + String.join(",", Collections.nCopies(columns.size(), "?"))
            + ")";
    if (engine.equals("SQL_SERVER") && explicitIdentity)
      try (Statement statement = connection.createStatement()) {
        boundedTimeout(statement, adapter, deadline);
        statement.executeUpdate("SET IDENTITY_INSERT " + target + " ON");
      }
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      adapter.configureTimeout(statement, 20);
      int affected = 0;
      for (Object row : (List<?>) step.get("rows")) {
        boundedTimeout(statement, adapter, deadline);
        List<?> values = (List<?>) row;
        for (int i = 0; i < values.size(); i++)
          bind(statement, i + 1, values.get(i), types.get(columns.get(i)));
        affected += statement.executeUpdate();
      }
      return affected;
    } finally {
      if (engine.equals("SQL_SERVER") && explicitIdentity)
        try (Statement statement = connection.createStatement()) {
          adapter.configureTimeout(statement, 5);
          statement.executeUpdate("SET IDENTITY_INSERT " + target + " OFF");
        }
    }
  }

  static void bind(PreparedStatement statement, int index, Object value, String declared)
      throws SQLException {
    if (declared == null) throw new SQLException("Missing canonical type");
    String type = declared.replace(" IDENTITY", "");
    if (value == null) {
      statement.setNull(index, Types.NULL);
      return;
    }
    if (type.equals("BOOLEAN")) {
      statement.setBoolean(
          index,
          value instanceof Boolean b ? b : new BigDecimal(value.toString()).intValueExact() == 1);
      return;
    }
    if (type.equals("DATE")) {
      statement.setObject(index, java.time.LocalDate.parse(value.toString()));
      return;
    }
    if (type.startsWith("TIMESTAMP")) {
      statement.setTimestamp(
          index,
          Timestamp.valueOf(java.time.LocalDateTime.parse(value.toString().replace(' ', 'T'))));
      return;
    }
    if (type.startsWith("TIME(")) {
      statement.setObject(index, java.time.LocalTime.parse(value.toString()));
      return;
    }
    if (value instanceof Number number) {
      BigDecimal decimal = new BigDecimal(number.toString());
      if (type.startsWith("DECIMAL")) statement.setBigDecimal(index, decimal);
      else
        switch (type) {
          case "SMALLINT" -> statement.setShort(index, decimal.shortValueExact());
          case "INTEGER" -> statement.setInt(index, decimal.intValueExact());
          case "BIGINT" -> statement.setLong(index, decimal.longValueExact());
          case "DOUBLE", "FLOAT", "REAL" -> statement.setDouble(index, number.doubleValue());
          default -> throw new SQLException("Incompatible numeric type");
        }
    } else if (value instanceof String text
        && (type.equals("TEXT") || type.startsWith("VARCHAR") || type.startsWith("CHAR")))
      statement.setString(index, text);
    else throw new SQLException("Incompatible literal type");
  }

  private static void synchronizeIdentities(
      Connection connection,
      WarehouseAdapter adapter,
      String engine,
      List<Map<String, Object>> steps,
      long deadline)
      throws SQLException {
    if (!engine.equals("POSTGRESQL")) return;
    for (var table : steps) {
      if (!"CREATE_TABLE".equals(table.get("kind"))) continue;
      for (var column : Json.objects(table.get("columns"))) {
        if (!Boolean.TRUE.equals(column.get("identity"))) continue;
        String sql =
            "SELECT setval(pg_get_serial_sequence(?,?),GREATEST(COALESCE(MAX("
                + adapter.quoteIdentifier(Json.str(column, "name"))
                + "),0)+1,1),false) FROM "
                + qualified(adapter, table);
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          boundedTimeout(statement, adapter, deadline);
          statement.setString(1, qualified(adapter, table));
          statement.setString(2, Json.str(column, "name"));
          statement.execute();
        }
      }
    }
  }
}

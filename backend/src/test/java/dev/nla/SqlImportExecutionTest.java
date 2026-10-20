package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.WarehouseAdapter;
import java.math.BigDecimal;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class SqlImportExecutionTest {
  record Target(
      String engine,
      String suffix,
      Map<String, Object> warehouse,
      Adapters adapters,
      WarehouseAdapter adapter) {}

  private Target target(String engine) {
    String suffix = Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
    var env =
        new MockEnvironment()
            .withProperty("nla.warehouse-tls", "false")
            .withProperty(
                "IMPORT_TEST_PASSWORD", System.getenv("NLA_IMPORT_" + suffix + "_PASSWORD"));
    var adapters = new Adapters(env);
    var warehouse =
        Json.obj(
            "engine",
            engine,
            "host",
            "127.0.0.1",
            "port",
            Map.of("POSTGRESQL", 55432, "MYSQL", 53306, "SQL_SERVER", 51433).get(engine),
            "database",
            engine.equals("MYSQL") ? "nla_import" : "nla_chinook",
            "username",
            "nla_importer",
            "defaultSchema",
            "nla_import");
    return new Target(engine, suffix, warehouse, adapters, adapters.get(warehouse));
  }

  private List<Map<String, Object>> documents(String sql) {
    var parsed = SqlImportParser.parse(sql, "POSTGRESQL", "nla_import");
    var steps = parsed.steps().stream().map(SqlImportExecutor::document).toList();
    Map<String, Object> columns = new HashMap<>();
    for (var step : steps)
      if ("CREATE_TABLE".equals(step.get("kind")))
        columns.put(Json.str(step, "table"), step.get("columns"));
    for (var step : steps)
      if ("INSERT".equals(step.get("kind")))
        step.put("tableColumns", columns.get(Json.str(step, "table")));
    return steps;
  }

  private Map<String, Object> run(List<Map<String, Object>> steps) {
    return Json.obj(
        "rowsAffected",
        0,
        "completedStatements",
        0,
        "steps",
        steps.stream()
            .map(
                s ->
                    Json.obj(
                        "index",
                        s.get("index"),
                        "status",
                        "PENDING",
                        "rowsAffected",
                        0,
                        "error",
                        null))
            .toList());
  }

  private void execute(Target target, List<Map<String, Object>> steps, Map<String, Object> run)
      throws Exception {
    SqlImportExecutor.execute(
        target.adapters,
        target.warehouse,
        "nla_importer",
        "env:IMPORT_TEST_PASSWORD",
        Json.obj("targetSchema", "nla_import"),
        steps,
        run);
  }

  private void cleanup(Target target, String... tables) throws Exception {
    var admin = new LinkedHashMap<>(target.warehouse);
    admin.put(
        "username",
        target.engine.equals("POSTGRESQL")
            ? "nla_provisioner"
            : target.engine.equals("MYSQL") ? "root" : "sa");
    String password = System.getenv("NLA_" + target.suffix + "_ADMIN_PASSWORD");
    try (Connection connection = target.adapter.connectForWrite(admin, password);
        Statement statement = connection.createStatement()) {
      for (String table : tables)
        statement.executeUpdate(
            "DROP TABLE IF EXISTS "
                + target.adapter.quoteIdentifier("nla_import")
                + "."
                + target.adapter.quoteIdentifier(table));
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void persistsTypedRowsCompositeConstraintsIndexesAndIdentity(String engine) throws Exception {
    Target target = target(engine);
    String key = "it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10),
        parent = key + "p",
        child = key + "c";
    String sql =
        "CREATE SCHEMA nla_import; CREATE TABLE "
            + child
            + " (id INT PRIMARY KEY, p BIGINT, shard INT, amount DECIMAL(18,3) NOT NULL, note TEXT"
            + " DEFAULT 'a\\b''quoted', flag BOOLEAN DEFAULT TRUE, event_date DATE, event_time"
            + " TIMESTAMP(6), FOREIGN KEY(p,shard) REFERENCES "
            + parent
            + "(id,shard));"
            + "CREATE TABLE "
            + parent
            + " (id BIGSERIAL, shard INT NOT NULL, PRIMARY KEY(id,shard));"
            + "INSERT INTO "
            + child
            + "(id,p,shard,amount,note,flag,event_date,event_time) VALUES"
            + " (1,10,2,123.125,NULL,FALSE,'2026-10-20','2026-10-20 01:02:03.123456');INSERT INTO "
            + parent
            + "(id,shard) VALUES (10,2);"
            + "CREATE UNIQUE INDEX "
            + key
            + "i ON "
            + child
            + "(p,shard);";
    try {
      var steps = documents(sql);
      var run = run(steps);
      execute(target, steps, run);
      assertEquals(2L, ((Number) run.get("rowsAffected")).longValue());
      try (Connection connection =
              target.adapter.connectForWrite(
                  target.warehouse, System.getenv("NLA_IMPORT_" + target.suffix + "_PASSWORD"));
          Statement statement = connection.createStatement()) {
        String name =
            target.adapter.quoteIdentifier("nla_import")
                + "."
                + target.adapter.quoteIdentifier(child);
        try (ResultSet rows =
            statement.executeQuery("SELECT amount,note,flag,event_date,event_time FROM " + name)) {
          assertTrue(rows.next());
          assertEquals(0, new BigDecimal("123.125").compareTo(rows.getBigDecimal(1)));
          assertNull(rows.getString(2));
          assertFalse(rows.getBoolean(3));
          assertEquals("2026-10-20", rows.getDate(4).toString());
          assertEquals(123456000, rows.getTimestamp(5).getNanos());
          assertFalse(rows.next());
        }
        statement.executeUpdate("INSERT INTO " + name + " (id,amount) VALUES (2,1.000)");
        try (ResultSet rows =
            statement.executeQuery("SELECT note,flag FROM " + name + " WHERE id=2")) {
          assertTrue(rows.next());
          assertEquals("a\\b'quoted", rows.getString(1));
          assertTrue(rows.getBoolean(2));
        }
        String parentName =
            target.adapter.quoteIdentifier("nla_import")
                + "."
                + target.adapter.quoteIdentifier(parent);
        statement.executeUpdate("INSERT INTO " + parentName + " (shard) VALUES (2)");
        try (ResultSet rows = statement.executeQuery("SELECT MAX(id) FROM " + parentName)) {
          assertTrue(rows.next());
          assertEquals(11, rows.getLong(1));
        }
        assertThrows(
            SQLException.class,
            () ->
                statement.executeUpdate(
                    "INSERT INTO " + name + " (id,p,shard,amount) VALUES (3,999,2,1.0)"));
      }
    } finally {
      cleanup(target, child, parent);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void rollbackReportsOnlyPersistedOutcomes(String engine) throws Exception {
    Target target = target(engine);
    String table = "it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    var steps =
        documents(
            "CREATE TABLE "
                + table
                + " (id INT PRIMARY KEY);INSERT INTO "
                + table
                + "(id) VALUES (1);INSERT INTO "
                + table
                + "(id) VALUES (1);");
    var run = run(steps);
    try {
      var failure =
          assertThrows(SqlImportExecutor.Failure.class, () -> execute(target, steps, run));
      assertEquals(engine.equals("MYSQL"), failure.partial);
      assertEquals(0L, ((Number) run.get("rowsAffected")).longValue());
      var outcomes = Json.objects(run.get("steps"));
      assertEquals("ROLLED_BACK", outcomes.get(1).get("status"));
      assertEquals("FAILED", outcomes.get(2).get("status"));
      assertEquals(
          engine.equals("MYSQL") ? 1L : 0L, ((Number) run.get("completedStatements")).longValue());
      try (Connection connection =
              target.adapter.connectForWrite(
                  target.warehouse, System.getenv("NLA_IMPORT_" + target.suffix + "_PASSWORD"));
          Statement statement = connection.createStatement()) {
        String query =
            "SELECT COUNT(*) FROM "
                + target.adapter.quoteIdentifier("nla_import")
                + "."
                + target.adapter.quoteIdentifier(table);
        if (engine.equals("MYSQL")) {
          try (ResultSet rows = statement.executeQuery(query)) {
            rows.next();
            assertEquals(0, rows.getInt(1));
          }
        } else assertThrows(SQLException.class, () -> statement.executeQuery(query));
      }
    } finally {
      cleanup(target, table);
    }
  }
}

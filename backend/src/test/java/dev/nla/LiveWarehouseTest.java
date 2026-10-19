package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class LiveWarehouseTest {
  record Spec(
      WarehouseAdapter adapter,
      Map<String, Object> warehouse,
      String password,
      String suffix,
      String table,
      String key) {}

  Spec spec(String engine) {
    String suffix = Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
    String schema =
        Map.of("POSTGRESQL", "public", "MYSQL", "nla_chinook", "SQL_SERVER", "dbo").get(engine);
    int port = Map.of("POSTGRESQL", 55432, "MYSQL", 53306, "SQL_SERVER", 51433).get(engine);
    WarehouseAdapter adapter =
        switch (engine) {
          case "POSTGRESQL" -> new PostgreSqlWarehouseAdapter(false);
          case "MYSQL" -> new MySqlWarehouseAdapter(false);
          default -> new SqlServerWarehouseAdapter(false);
        };
    return new Spec(
        adapter,
        Json.obj(
            "host",
            "127.0.0.1",
            "port",
            port,
            "database",
            "nla_chinook",
            "username",
            "nla_reader",
            "engine",
            engine,
            "defaultSchema",
            schema),
        System.getenv("NLA_CHINOOK_" + suffix + "_PASSWORD"),
        suffix,
        schema,
        engine.equals("POSTGRESQL") ? "track" : "Track");
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void metadataQueryLimitsAndReaderDenial(String engine) throws Exception {
    Spec s = spec(engine);
    assertTrue(s.adapter.testConnection(s.warehouse, s.password));
    try (Connection c = s.adapter.connect(s.warehouse, s.password)) {
      assertTrue(s.adapter.discoverSchemas(c).contains(s.table));
      var tables = s.adapter.discoverTables(c, Set.of(s.table));
      assertTrue(tables.size() >= 11);
      var track =
          tables.stream().filter(t -> t.get("name").equals(s.key)).findFirst().orElseThrow();
      assertTrue(Json.objects(track.get("columns")).size() >= 9);
      assertFalse(Json.objects(track.get("foreignKeys")).isEmpty());
      String target = s.adapter.quoteIdentifier(s.table) + "." + s.adapter.quoteIdentifier(s.key);
      assertThrows(
          SQLException.class,
          () -> {
            try (Statement st = c.createStatement()) {
              st.executeUpdate("DELETE FROM " + target + " WHERE 1=0");
            }
          });
    }
    String target = s.adapter.quoteIdentifier(s.table) + "." + s.adapter.quoteIdentifier(s.key);
    var result =
        s.adapter.executeReadOnlyQuery(
            s.warehouse,
            s.password,
            "SELECT COUNT(*) AS track_count FROM " + target,
            1000,
            5242880,
            15);
    assertEquals("3503", Json.objects(result.get("rows")).getFirst().get("track_count").toString());
    var bounded =
        s.adapter.executeReadOnlyQuery(
            s.warehouse, s.password, "SELECT * FROM " + target, 3, 5242880, 15);
    assertEquals(3, Json.objects(bounded.get("rows")).size());
    assertEquals(true, bounded.get("truncated"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void writerCanOperateOnlyItsMart(String engine) throws Exception {
    Spec s = spec(engine);
    var writer = new LinkedHashMap<>(s.warehouse);
    writer.put("username", "nla_writer");
    String password = System.getenv("NLA_PIPELINE_" + s.suffix + "_PASSWORD");
    try (Connection c = s.adapter.connect(writer, password)) {
      c.setAutoCommit(false);
      String stage =
          s.adapter.quoteIdentifier(s.table) + "." + s.adapter.quoteIdentifier("nla_stage_sales");
      try (Statement st = c.createStatement()) {
        st.executeUpdate("DELETE FROM " + stage + " WHERE 1=0");
      }
      try (PreparedStatement st =
          c.prepareStatement("INSERT INTO " + stage + " (country,total) VALUES (?,?)")) {
        st.setString(1, "NLA_TEST_ROLLBACK");
        st.setBigDecimal(2, new java.math.BigDecimal("1.00"));
        st.executeUpdate();
      }
      c.rollback();
      String target = s.adapter.quoteIdentifier(s.table) + "." + s.adapter.quoteIdentifier(s.key);
      assertThrows(
          SQLException.class,
          () -> {
            try (Statement st = c.createStatement()) {
              st.executeUpdate("DELETE FROM " + target + " WHERE 1=0");
            }
          });
      c.rollback();
    }
  }
}

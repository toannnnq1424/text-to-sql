package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.testcontainers.containers.*;

/**
 * Isolated shared behavior contract. LiveWarehouseTest independently verifies full Chinook
 * datasets.
 */
@EnabledIfEnvironmentVariable(named = "NLA_TESTCONTAINERS", matches = "true")
class AdapterContainerTest {
  @Test
  void postgres() throws Exception {
    try (var db =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("adapter_test")
            .withUsername("admin")
            .withPassword("TestContainerOnly_123!")) {
      db.start();
      verify(
          db,
          new PostgreSqlWarehouseAdapter(false),
          "public",
          "CREATE TABLE public.adapter_contract(id INT PRIMARY KEY, amount DECIMAL(25,5), label"
              + " VARCHAR(100)); INSERT INTO public.adapter_contract"
              + " VALUES(1,9007199254740993.12345,'one'),(2,NULL,'two');");
    }
  }

  @Test
  void mysql() throws Exception {
    try (var db =
        new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("adapter_test")
            .withUsername("test")
            .withPassword("TestContainerOnly_123!")
            .withCommand("--default-authentication-plugin=mysql_native_password")) {
      db.start();
      verify(
          db,
          new MySqlWarehouseAdapter(false),
          "adapter_test",
          "CREATE TABLE adapter_contract(id INT PRIMARY KEY,amount DECIMAL(25,5),label"
              + " VARCHAR(100)); INSERT INTO adapter_contract"
              + " VALUES(1,9007199254740993.12345,'one'),(2,NULL,'two');");
    }
  }

  @Test
  void sqlserver() throws Exception {
    try (var db =
        new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-CU22-ubuntu-22.04")
            .acceptLicense()
            .withPassword("TestContainerOnly_123!")
            .withCreateContainerCmdModifier(cmd -> cmd.withPlatform("linux/amd64"))) {
      db.start();
      verify(
          db,
          new SqlServerWarehouseAdapter(false),
          "dbo",
          "CREATE TABLE dbo.adapter_contract(id INT PRIMARY KEY,amount DECIMAL(25,5),label"
              + " NVARCHAR(100)); INSERT INTO dbo.adapter_contract"
              + " VALUES(1,9007199254740993.12345,'one'),(2,NULL,'two');");
    }
  }

  private void verify(
      JdbcDatabaseContainer<?> db, WarehouseAdapter adapter, String schema, String setup)
      throws Exception {
    try (Connection c =
            DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        Statement stmt = c.createStatement()) {
      for (String command : setup.split(";")) if (!command.isBlank()) stmt.execute(command);
    }
    var w =
        Json.obj(
            "host",
            db.getHost(),
            "port",
            db.getFirstMappedPort(),
            "database",
            adapter.engine().equals("SQL_SERVER") ? "master" : "adapter_test",
            "username",
            db.getUsername(),
            "engine",
            adapter.engine(),
            "defaultSchema",
            schema);
    assertTrue(adapter.testConnection(w, db.getPassword()));
    try (Connection c = adapter.connect(w, db.getPassword())) {
      var tables = adapter.discoverTables(c, Set.of(schema));
      assertTrue(tables.stream().anyMatch(t -> "adapter_contract".equals(t.get("name"))));
      assertEquals(3, adapter.discoverColumns(c, schema, "adapter_contract").size());
      assertFalse(adapter.discoverSchemas(c).isEmpty());
      assertEquals("adapter_contract", adapter.normalizeIdentifier(c, "adapter_contract", true));
    }
    String source =
        adapter.quoteIdentifier(schema) + "." + adapter.quoteIdentifier("adapter_contract");
    var result =
        adapter.executeReadOnlyQuery(
            w, db.getPassword(), "SELECT * FROM " + source + " ORDER BY id", 10, 1048576, 3);
    assertEquals(2, Json.objects(result.get("rows")).size());
    assertEquals(
        "9007199254740993.12345", Json.objects(result.get("rows")).getFirst().get("amount"));
    assertNull(Json.objects(result.get("rows")).get(1).get("amount"));
    var bounded =
        adapter.executeReadOnlyQuery(w, db.getPassword(), "SELECT * FROM " + source, 1, 1048576, 3);
    assertEquals(1, Json.objects(bounded.get("rows")).size());
    assertEquals(true, bounded.get("truncated"));
  }
}

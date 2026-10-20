package dev.nla.warehouse;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.Json;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Native comments are created by the isolated provisioning account and read by the actual reader.
 */
@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class NativeMetadataLiveTest {
  static final String TABLE_COMMENT = "Doanh thu sau giảm giá — Việt Nam";
  static final String COLUMN_COMMENT = "Số tiền thuần, không bao gồm thuế";

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void readerDiscoversRealNativeCommentsAndClearedValues(String engine) throws Exception {
    JdbcWarehouseAdapter adapter = adapter(engine);
    String schema = schema(engine);
    String table =
        "metadata_native_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    String target = adapter.quoteIdentifier(schema) + "." + adapter.quoteIdentifier(table);
    var adminWarehouse = warehouse(engine, adminUser(engine));
    String password = System.getenv(adminPassword(engine));
    try (Connection admin = adapter.connectForWrite(adminWarehouse, password);
        Statement statement = admin.createStatement()) {
      statement.execute(
          "CREATE TABLE " + target + " (id INTEGER PRIMARY KEY, business_note VARCHAR(80))");
      try {
        statement.execute(
            "GRANT SELECT ON "
                + target
                + " TO "
                + (engine.equals("MYSQL") ? "'nla_reader'@'%'" : "nla_reader"));
        comments(statement, engine, schema, table, target, false);
        try (Connection reader =
            adapter.connect(
                warehouse(engine, "nla_reader"),
                System.getenv("NLA_CHINOOK_" + suffix(engine) + "_PASSWORD"))) {
          var found =
              adapter.discoverTables(reader, Set.of(schema)).stream()
                  .filter(value -> table.equals(value.get("name")))
                  .findFirst()
                  .orElseThrow();
          assertEquals(TABLE_COMMENT, found.get("description"));
          var columns = Json.objects(found.get("columns"));
          assertEquals(
              COLUMN_COMMENT,
              columns.stream()
                  .filter(column -> "business_note".equals(column.get("name")))
                  .findFirst()
                  .orElseThrow()
                  .get("description"));
          assertEquals(
              "",
              columns.stream()
                  .filter(column -> "id".equals(column.get("name")))
                  .findFirst()
                  .orElseThrow()
                  .get("description"));
          assertEquals(
              "",
              NativeMetadataDescriptions.load(reader, engine, "metadata_absent_schema")
                  .table(table, null));
          assertThrows(
              SQLException.class,
              () -> {
                try (Statement denied = reader.createStatement()) {
                  denied.executeUpdate("DELETE FROM " + target + " WHERE 1=0");
                }
              });
          comments(statement, engine, schema, table, target, true);
          var refreshed = NativeMetadataDescriptions.load(reader, engine, schema);
          assertEquals("", refreshed.table(table, null));
          assertEquals("", refreshed.column(table, "business_note", null));
        }
        if (engine.equals("SQL_SERVER")) nativeCatalogPermissionDenied(admin, schema);
      } finally {
        statement.execute("DROP TABLE " + target);
      }
    }
  }

  private static void nativeCatalogPermissionDenied(Connection admin, String schema)
      throws Exception {
    String user =
        "metadata_denied_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    try (Statement statement = admin.createStatement()) {
      statement.execute("CREATE USER [" + user + "] WITHOUT LOGIN");
      try {
        statement.execute("DENY SELECT ON OBJECT::sys.extended_properties TO [" + user + "]");
        statement.execute("EXECUTE AS USER = '" + user + "'");
        try {
          SQLException denied =
              assertThrows(
                  SQLException.class,
                  () -> NativeMetadataDescriptions.load(admin, "SQL_SERVER", schema));
          assertEquals(229, denied.getErrorCode());
        } finally {
          statement.execute("REVERT");
        }
      } finally {
        statement.execute("DROP USER [" + user + "]");
      }
    }
  }

  private static void comments(
      Statement statement, String engine, String schema, String table, String target, boolean clear)
      throws SQLException {
    if (engine.equals("POSTGRESQL")) {
      statement.execute(
          "COMMENT ON TABLE " + target + " IS " + (clear ? "NULL" : literal(TABLE_COMMENT)));
      statement.execute(
          "COMMENT ON COLUMN "
              + target
              + ".business_note IS "
              + (clear ? "NULL" : literal(COLUMN_COMMENT)));
    } else if (engine.equals("MYSQL")) {
      statement.execute(
          "ALTER TABLE " + target + " COMMENT = " + literal(clear ? "" : TABLE_COMMENT));
      statement.execute(
          "ALTER TABLE "
              + target
              + " MODIFY business_note VARCHAR(80) COMMENT "
              + literal(clear ? "" : COLUMN_COMMENT));
    } else {
      String operation = clear ? "sp_dropextendedproperty" : "sp_addextendedproperty";
      String scope =
          ", @level0type=N'SCHEMA', @level0name="
              + literal(schema)
              + ", @level1type=N'TABLE', @level1name="
              + literal(table);
      statement.execute(
          "EXEC sys."
              + operation
              + " @name=N'MS_Description'"
              + (clear ? "" : ", @value=N" + literal(TABLE_COMMENT))
              + scope);
      statement.execute(
          "EXEC sys."
              + operation
              + " @name=N'MS_Description'"
              + (clear ? "" : ", @value=N" + literal(COLUMN_COMMENT))
              + scope
              + ", @level2type=N'COLUMN', @level2name=N'business_note'");
    }
  }

  private static String literal(String text) {
    return "'" + text.replace("'", "''") + "'";
  }

  private static JdbcWarehouseAdapter adapter(String engine) {
    return switch (engine) {
      case "POSTGRESQL" -> new PostgreSqlWarehouseAdapter(false);
      case "MYSQL" -> new MySqlWarehouseAdapter(false);
      default -> new SqlServerWarehouseAdapter(false);
    };
  }

  private static String schema(String engine) {
    return Map.of("POSTGRESQL", "public", "MYSQL", "nla_chinook", "SQL_SERVER", "dbo").get(engine);
  }

  private static String suffix(String engine) {
    return Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
  }

  private static String adminUser(String engine) {
    return Map.of("POSTGRESQL", "nla_provisioner", "MYSQL", "root", "SQL_SERVER", "sa").get(engine);
  }

  private static String adminPassword(String engine) {
    return "NLA_" + suffix(engine) + "_ADMIN_PASSWORD";
  }

  private static Map<String, Object> warehouse(String engine, String user) {
    return Json.obj(
        "host",
        "127.0.0.1",
        "engine",
        engine,
        "username",
        user,
        "database",
        "nla_chinook",
        "defaultSchema",
        schema(engine),
        "port",
        Map.of("POSTGRESQL", 55432, "MYSQL", 53306, "SQL_SERVER", 51433).get(engine));
  }
}

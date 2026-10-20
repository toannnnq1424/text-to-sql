package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class FileIngestionExecutionTest {
  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void bulkLoadsAllFourRealLayersWithTypedUnicodePrecisionAndReaderAccess(String engine)
      throws Exception {
    String suffix = Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
    var adapters =
        new Adapters(
            new MockEnvironment()
                .withProperty("nla.warehouse-tls", "false")
                .withProperty(
                    "TEST_IMPORT_PASSWORD", System.getenv("NLA_IMPORT_" + suffix + "_PASSWORD")));
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
    var adapter = adapters.get(warehouse);
    String prefix = "file_it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    var layers =
        List.of("RAW", "STAGING", "WAREHOUSE", "MART").stream()
            .map(
                name ->
                    Json.obj(
                        "name",
                        name,
                        "schema",
                        "nla_import",
                        "table",
                        prefix + "_" + name.toLowerCase(Locale.ROOT)))
            .toList();
    var columns =
        List.of(
            Json.obj("name", "id", "dataType", "BIGINT", "nullable", false),
            Json.obj("name", "amount", "dataType", "DECIMAL", "nullable", false),
            Json.obj("name", "label", "dataType", "STRING", "nullable", true),
            Json.obj("name", "active", "dataType", "BOOLEAN", "nullable", false),
            Json.obj("name", "occurred", "dataType", "TIMESTAMP", "nullable", false));
    var plan =
        Json.obj(
            "targetSchema", "nla_import", "layers", layers, "columns", columns, "rowCount", 1101);
    var run =
        Json.obj(
            "stages",
            layers.stream()
                .map(l -> Json.obj("name", l.get("name"), "status", "PENDING", "rowsLoaded", 0))
                .toList(),
            "rowsLoaded",
            0,
            "createdTables",
            new ArrayList<>(),
            "partialFailure",
            false);
    Path spool = Files.createTempFile("nla-file-it-", ".ndjson");
    try {
      try (var writer = Files.newBufferedWriter(spool)) {
        for (int i = 0; i < 1101; i++) {
          writer.write(
              Json.write(
                  Json.obj(
                      "row",
                      Arrays.asList(
                          "9007199254740993",
                          "1234.5000",
                          i % 2 == 0 ? "Nhạc O'Brien\nViệt" : null,
                          true,
                          "2026-10-20T08:00:00+07:00"))));
          writer.newLine();
        }
      }
      FileIngestionExecutor.execute(
          adapters,
          warehouse,
          "nla_importer",
          "env:TEST_IMPORT_PASSWORD",
          plan,
          spool,
          run,
          ignored -> {});
      assertEquals(1101, run.get("rowsLoaded"));
      assertEquals(4, Json.objects(run.get("createdTables")).size());
      var reader = new LinkedHashMap<>(warehouse);
      reader.put("username", "nla_reader");
      try (var connection =
          adapter.connect(reader, System.getenv("NLA_CHINOOK_" + suffix + "_PASSWORD"))) {
        for (var layer : layers) {
          try (var statement = connection.createStatement();
              var result =
                  statement.executeQuery(
                      "SELECT COUNT(*) FROM " + FileIngestionExecutor.qualified(adapter, layer))) {
            assertTrue(result.next());
            assertEquals(1101, result.getInt(1));
          }
        }
        try (var statement = connection.createStatement();
            var result =
                statement.executeQuery(
                    "SELECT id,amount,label,active,occurred FROM "
                        + FileIngestionExecutor.qualified(adapter, layers.getLast()))) {
          assertTrue(result.next());
          assertEquals(9007199254740993L, result.getLong(1));
          assertEquals(0, new BigDecimal("1234.5000").compareTo(result.getBigDecimal(2)));
          assertEquals("Nhạc O'Brien\nViệt", result.getString(3));
          assertTrue(result.getBoolean(4));
          assertEquals(1, result.getTimestamp(5).toLocalDateTime().getHour());
        }
        assertThrows(
            SQLException.class,
            () -> {
              try (var statement = connection.createStatement()) {
                statement.executeUpdate(
                    "DELETE FROM " + FileIngestionExecutor.qualified(adapter, layers.getLast()));
              }
            });
      }
    } finally {
      Files.deleteIfExists(spool);
      var admin = new LinkedHashMap<>(warehouse);
      admin.put(
          "username",
          engine.equals("POSTGRESQL") ? "nla_provisioner" : engine.equals("MYSQL") ? "root" : "sa");
      try (var connection =
              adapter.connectForWrite(admin, System.getenv("NLA_" + suffix + "_ADMIN_PASSWORD"));
          var statement = connection.createStatement()) {
        for (var layer : layers)
          statement.executeUpdate(
              "DROP TABLE IF EXISTS " + FileIngestionExecutor.qualified(adapter, layer));
      }
    }
  }
}

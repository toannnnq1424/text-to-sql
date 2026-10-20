package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

/** Real reader/writer DB3 coverage; API smoke separately covers source-fork compilation. */
@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class TransformationExecutionTest {
  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void independentLayerSchemasFilterGroupAggregateAndPreviewWithoutDdl(String engine)
      throws Exception {
    String suffix = Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
    var adapters = new Adapters(new MockEnvironment().withProperty("nla.warehouse-tls", "false"));
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
            "nla_importer");
    var adapter = adapters.get(warehouse);
    String prefix =
        "transform_it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    var columns =
        List.of(
            Json.obj("name", "id", "dataType", "BIGINT", "nullable", false),
            Json.obj("name", "amount", "dataType", "DECIMAL", "nullable", false),
            Json.obj("name", "Nhóm nhạc", "dataType", "STRING", "nullable", true));
    var rows =
        List.of(
            Json.obj("id", "9007199254740993", "amount", "10.50", "Nhóm nhạc", "Nhạc O'Brien"),
            Json.obj("id", "2", "amount", "20.25", "Nhóm nhạc", "Nhạc O'Brien"),
            Json.obj("id", "3", "amount", "4.00", "Nhóm nhạc", "Khác"),
            Json.obj("id", "4", "amount", "8.00", "Nhóm nhạc", "Khác"));
    var data = Json.obj("columns", columns, "rows", rows, "rowCount", rows.size());
    String input = adapter.quoteIdentifier("input");
    java.util.function.Function<String, String> col =
        name -> input + "." + adapter.quoteIdentifier(name);
    String from = " FROM " + adapter.quoteIdentifier("__nla_input") + " AS " + input;
    var transforms =
        List.of(
            "SELECT "
                + col.apply("id")
                + " AS "
                + adapter.quoteIdentifier("record_id")
                + ",UPPER("
                + col.apply("Nhóm nhạc")
                + ") AS "
                + adapter.quoteIdentifier("category")
                + ","
                + col.apply("amount")
                + " AS "
                + adapter.quoteIdentifier("amount")
                + from
                + " WHERE "
                + col.apply("amount")
                + ">5",
            "SELECT "
                + col.apply("category")
                + ",SUM("
                + col.apply("amount")
                + ") AS "
                + adapter.quoteIdentifier("total")
                + from
                + " GROUP BY "
                + col.apply("category"),
            "SELECT "
                + col.apply("category")
                + " AS "
                + adapter.quoteIdentifier("label")
                + ","
                + col.apply("total")
                + " AS "
                + adapter.quoteIdentifier("revenue")
                + from
                + " WHERE "
                + col.apply("total")
                + ">10");
    List<String> created = new ArrayList<>();
    try (var connection =
        adapter.connectForWrite(warehouse, System.getenv("NLA_IMPORT_" + suffix + "_PASSWORD"))) {
      connection.setAutoCommit(false);
      var preview = data;
      for (String transform : transforms) {
        new SqlGuard()
            .validate(
                transform,
                engine,
                List.of(
                    Json.obj(
                        "schema",
                        "nla",
                        "name",
                        "__nla_input",
                        "columns",
                        preview.get("columns"))));
        preview = TransformationData.preview(connection, adapter, transform, preview, 15, 1048576);
      }
      assertEquals(1, preview.get("rowCount"));
      assertEquals("30.7500000000", Json.objects(preview.get("rows")).getFirst().get("revenue"));
      assertTrue(
          adapter.discoverTables(connection, Set.of("nla_import")).stream()
              .noneMatch(table -> Json.str(table, "name").startsWith(prefix)));
      var names = List.of("raw", "staging", "warehouse", "mart");
      var expectedCounts = List.of(4, 3, 2, 1);
      for (int index = 0; index < 4; index++) {
        if (index > 0) {
          String sql =
              TransformationData.targetSql(
                  transforms.get(index - 1),
                  adapter,
                  "nla_import",
                  prefix + "_" + names.get(index - 1));
          new SqlGuard()
              .validate(
                  sql,
                  engine,
                  List.of(
                      Json.obj(
                          "schema",
                          "nla_import",
                          "name",
                          prefix + "_" + names.get(index - 1),
                          "columns",
                          data.get("columns"))));
          try (var statement = connection.createStatement();
              var result = statement.executeQuery(sql)) {
            data = TransformationData.read(result, 100, 1048576);
          }
        }
        assertEquals(expectedCounts.get(index), data.get("rowCount"));
        String name = prefix + "_" + names.get(index);
        TransformationData.createAndLoad(
            connection,
            adapter,
            TransformationData.qualified(adapter, "nla_import", name),
            data,
            15,
            () -> created.add(name));
        if (engine.equals("MYSQL")) {
          connection.commit();
        }
      }
      connection.commit();
      var reader = new LinkedHashMap<>(warehouse);
      reader.put("username", "nla_reader");
      try (var read =
              adapter.connect(reader, System.getenv("NLA_CHINOOK_" + suffix + "_PASSWORD"));
          var statement = read.createStatement();
          var result =
              statement.executeQuery(
                  "SELECT * FROM "
                      + TransformationData.qualified(adapter, "nla_import", created.getLast()))) {
        assertTrue(result.next());
        assertEquals(2, result.getMetaData().getColumnCount());
        assertEquals(
            0, new java.math.BigDecimal("30.75").compareTo(result.getBigDecimal("revenue")));
        assertTrue(result.getString("label").contains("O'BRIEN"));
        assertFalse(result.next());
      }
    } finally {
      var admin = new LinkedHashMap<>(warehouse);
      admin.put(
          "username",
          engine.equals("POSTGRESQL") ? "nla_provisioner" : engine.equals("MYSQL") ? "root" : "sa");
      try (var cleanup =
          adapter.connectForWrite(admin, System.getenv("NLA_" + suffix + "_ADMIN_PASSWORD"))) {
        for (String name : created.reversed()) {
          try (var statement = cleanup.createStatement()) {
            statement.executeUpdate(
                "DROP TABLE " + TransformationData.qualified(adapter, "nla_import", name));
          }
        }
      }
    }
  }
}

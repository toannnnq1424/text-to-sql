package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.Adapters;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/** Full SQL aggregates on actual DB3 plus PostgreSQL/Flyway config/run persistence. */
@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class DataQualityExecutionTest {
  @Configuration(proxyBeanMethods = false)
  @EnableTransactionManagement
  static class Transactions {
    @Bean
    DataSourceTransactionManager transactionManager(DataSource source) {
      return new DataSourceTransactionManager(source);
    }
  }

  static void role(String name, String role) {
    SecurityContextHolder.getContext()
        .setAuthentication(
            new UsernamePasswordAuthenticationToken(
                name, null, List.of(new SimpleGrantedAuthority("ROLE_" + role))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void completeRuleLifecycleAndExactCountsAcrossThreeWarehouses(String engine) throws Exception {
    String suffix = Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
    String prefix = "quality_it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    String schema = "quality_meta_" + UUID.randomUUID().toString().replace("-", "");
    var env =
        new MockEnvironment()
            .withProperty("nla.warehouse-tls", "false")
            .withProperty(
                "TEST_READER_PASSWORD", System.getenv("NLA_CHINOOK_" + suffix + "_PASSWORD"));
    var adapters = new Adapters(env);
    var warehouse =
        Json.obj(
            "warehouseId",
            "wh-quality",
            "engine",
            engine,
            "status",
            "ACTIVE",
            "host",
            "127.0.0.1",
            "port",
            Map.of("POSTGRESQL", 55432, "MYSQL", 53306, "SQL_SERVER", 51433).get(engine),
            "database",
            engine.equals("MYSQL") ? "nla_import" : "nla_chinook",
            "username",
            "nla_reader");
    var writer = new LinkedHashMap<>(warehouse);
    writer.put("username", "nla_importer");
    var adapter = adapters.get(warehouse);
    var columns =
        List.of(
            Json.obj("name", "id", "dataType", "BIGINT", "nullable", true),
            Json.obj("name", "parent_id", "dataType", "BIGINT", "nullable", true),
            Json.obj("name", "amount", "dataType", "DECIMAL", "nullable", true),
            Json.obj("name", "label", "dataType", "STRING", "nullable", true));
    var rows =
        List.of(
            Json.obj("id", "1", "parent_id", null, "amount", "10", "label", "A"),
            Json.obj("id", "1", "parent_id", "1", "amount", "20", "label", "A"),
            Json.obj("id", "2", "parent_id", "2", "amount", "-1", "label", "B"),
            Json.obj("id", "3", "parent_id", "999", "amount", "101", "label", "X"),
            Json.obj("id", "4", "parent_id", "4", "amount", null, "label", null),
            Json.obj("id", "5", "parent_id", "5", "amount", "50", "label", "Nhạc O'Brien\\Z"));
    var created = new ArrayList<String>();
    try (var write =
            adapter.connectForWrite(writer, System.getenv("NLA_IMPORT_" + suffix + "_PASSWORD"));
        var metadataAdmin =
            DriverManager.getConnection(
                "jdbc:postgresql://127.0.0.1:55432/postgres",
                "nla_provisioner",
                System.getenv("NLA_PG_ADMIN_PASSWORD"))) {
      write.setAutoCommit(false);
      try {
        for (String table : List.of(prefix, prefix + "_empty")) {
          TransformationData.createAndLoad(
              write,
              adapter,
              TransformationData.qualified(adapter, "nla_import", table),
              Json.obj(
                  "columns",
                  columns,
                  "rows",
                  table.endsWith("_empty") ? List.of() : rows,
                  "rowCount",
                  table.endsWith("_empty") ? 0 : 6),
              15,
              () -> created.add(table));
          if (engine.equals("MYSQL")) write.commit();
        }
        write.commit();
        metadataAdmin.createStatement().execute("CREATE SCHEMA " + schema);
        var source =
            new DriverManagerDataSource(
                "jdbc:postgresql://127.0.0.1:55432/postgres?currentSchema=" + schema,
                "nla_provisioner",
                System.getenv("NLA_PG_ADMIN_PASSWORD"));
        Flyway.configure()
            .dataSource(source)
            .schemas(schema)
            .defaultSchema(schema)
            .locations("classpath:db/migration")
            .load()
            .migrate();
        try (var context = new AnnotationConfigApplicationContext()) {
          context.register(Transactions.class);
          context.registerBean(DataSource.class, () -> source);
          context.registerBean(JdbcTemplate.class, () -> new JdbcTemplate(source));
          context.registerBean(
              Store.class, () -> new Store(context.getBean(JdbcTemplate.class), false));
          context.registerBean(Adapters.class, () -> adapters);
          context.registerBean(CatalogService.class);
          context.registerBean(SqlGuard.class);
          context.registerBean(DataQualityService.class);
          context.refresh();
          var store = context.getBean(Store.class);
          var jdbc = context.getBean(JdbcTemplate.class);
          jdbc.update(
              "INSERT INTO warehouse(id,document,credential_reference) VALUES"
                  + " ('wh-quality',?::jsonb,'env:TEST_READER_PASSWORD')",
              Json.write(warehouse));
          for (String name : List.of("dataset", "other")) {
            var dataset =
                Json.obj(
                    "datasetId",
                    name,
                    "warehouseId",
                    "wh-quality",
                    "status",
                    "ACTIVE",
                    "allowedTables",
                    List.of(
                        Json.obj("schema", "nla_import", "name", prefix),
                        Json.obj("schema", "nla_import", "name", prefix + "_empty")));
            jdbc.update(
                "INSERT INTO dataset(id,warehouse_id,document,semantic_model) VALUES"
                    + " (?,'wh-quality',?::jsonb,'{}'::jsonb)",
                name,
                Json.write(dataset));
          }
          var service = context.getBean(DataQualityService.class);
          role("without-grant", "OPERATOR");
          assertEquals(
              "FORBIDDEN", assertThrows(ApiException.class, () -> service.rules("dataset")).code);
          role("test-admin", "ADMIN");
          assertEquals("0", service.rules("dataset").get("revision"));
          assertThrows(ApiException.class, () -> service.run("dataset", Json.obj()));
          var rules = new ArrayList<Map<String, Object>>();
          for (String type :
              List.of("NOT_NULL", "UNIQUE", "RANGE", "ACCEPTED_VALUES", "ROW_COUNT", "REFERENCE")) {
            var r = DataQualityRulesTest.rule(type);
            r.put("ruleId", type.toLowerCase());
            r.put("table", Json.obj("schema", "nla_import", "name", prefix));
            if (type.equals("NOT_NULL")) r.put("column", "amount");
            if (type.equals("RANGE")) {
              r.put("min", "0");
              r.put("max", "100");
            }
            if (type.equals("ACCEPTED_VALUES"))
              r.put("values", List.of("A", "B", "Nhạc O'Brien\\Z"));
            if (type.equals("ROW_COUNT")) {
              r.put("min", "6");
              r.put("max", "6");
            }
            if (type.equals("REFERENCE")) r.put("referenceTable", r.get("table"));
            rules.add(r);
          }
          var config = service.save("dataset", Json.obj("revision", "0", "rules", rules));
          assertEquals("1", config.get("revision"));
          assertEquals(
              "QUALITY_RULE_CONFLICT",
              assertThrows(
                      ApiException.class,
                      () -> service.save("dataset", Json.obj("revision", "0", "rules", rules)))
                  .code);
          assertEquals(
              1L,
              jdbc.queryForObject(
                  "SELECT revision FROM data_quality_rules WHERE dataset_id='dataset'",
                  Long.class));
          var accepted = service.run("dataset", Json.obj());
          assertEquals("RUNNING", accepted.get("status"));
          var complete = await(service, "dataset", Json.str(accepted, "runId"));
          assertEquals("FAILED", complete.get("status"), Json.write(complete));
          assertEquals("PER_CHECK", complete.get("consistency"));
          assertEquals("1", complete.get("revision"));
          var results = Json.objects(complete.get("checks"));
          assertEquals(
              List.of("6", "6", "5", "5", "6", "5"),
              results.stream().map(r -> r.get("checkedRows")).toList());
          assertEquals(
              List.of("1", "1", "2", "1", "0", "1"),
              results.stream().map(r -> r.get("violations")).toList());
          assertEquals("6", results.get(4).get("observedValue"));
          assertThrows(ApiException.class, () -> service.get("other", Json.str(accepted, "runId")));
          assertEquals(
              1L, service.runs("dataset", Map.of("page", "1", "pageSize", "1")).get("totalItems"));
          assertEquals(
              0,
              Json.objects(
                      service.runs("dataset", Map.of("page", "2", "pageSize", "1")).get("items"))
                  .size());
          for (var r : rules) {
            r.put("table", Json.obj("schema", "nla_import", "name", prefix + "_empty"));
            if (r.get("type").equals("REFERENCE")) r.put("referenceTable", r.get("table"));
          }
          service.save("dataset", Json.obj("revision", "1", "rules", rules));
          var empty =
              await(service, "dataset", Json.str(service.run("dataset", Json.obj()), "runId"));
          var emptyChecks = Json.objects(empty.get("checks"));
          assertEquals("FAILED", empty.get("status"), Json.write(empty));
          assertTrue(emptyChecks.stream().allMatch(c -> "0".equals(c.get("checkedRows"))));
          assertEquals(
              List.of("0", "0", "0", "0", "1", "0"),
              emptyChecks.stream().map(r -> r.get("violations")).toList());
          assertEquals("1", service.get("dataset", Json.str(accepted, "runId")).get("revision"));
          assertEquals(
              prefix,
              Json.map(
                      Json.objects(service.get("dataset", Json.str(accepted, "runId")).get("rules"))
                          .getFirst()
                          .get("table"))
                  .get("name"));
          var interrupted =
              Json.obj(
                  "runId",
                  "interrupted-quality",
                  "datasetId",
                  "dataset",
                  "warehouseId",
                  "wh-quality",
                  "status",
                  "RUNNING",
                  "checks",
                  List.of(Json.obj("ruleId", "completed", "status", "PASSED", "checkedRows", "6")));
          store.run("interrupted-quality", "DATA_QUALITY", interrupted);
          service.recover();
          var recovered = service.get("dataset", "interrupted-quality");
          assertEquals("ERROR", recovered.get("status"));
          assertEquals("QUALITY_INTERRUPTED", Json.map(recovered.get("error")).get("code"));
          assertEquals(1, Json.objects(recovered.get("checks")).size());
          assertEquals("FAILED", service.get("dataset", Json.str(accepted, "runId")).get("status"));
          service.save("dataset", Json.obj("revision", "2", "rules", List.of()));
          assertEquals(List.of(), service.rules("dataset").get("rules"));
          role("test-viewer", "VIEWER");
          store.grantWarehouseAccess("wh-quality", "test-viewer");
          service.rules("dataset");
          assertEquals(
              "FORBIDDEN",
              assertThrows(ApiException.class, () -> service.save("dataset", Json.obj())).code);
          assertEquals(
              "FORBIDDEN",
              assertThrows(ApiException.class, () -> service.run("dataset", Json.obj())).code);
          role("test-operator", "OPERATOR");
          store.grantWarehouseAccess("wh-quality", "test-operator");
          service.save("dataset", Json.obj("revision", "3", "rules", List.of()));
          assertEquals(
              0,
              jdbc.queryForObject(
                  "SELECT count(*) FROM audit_event WHERE details::text LIKE '%Nhạc%'",
                  Integer.class));
        }
      } finally {
        SecurityContextHolder.clearContext();
        metadataAdmin.createStatement().execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        write.rollback();
        var cleanupWarehouse = new LinkedHashMap<>(warehouse);
        cleanupWarehouse.put(
            "username",
            engine.equals("POSTGRESQL")
                ? "nla_provisioner"
                : engine.equals("MYSQL") ? "root" : "sa");
        try (var cleanup =
            adapter.connectForWrite(
                cleanupWarehouse, System.getenv("NLA_" + suffix + "_ADMIN_PASSWORD"))) {
          for (String table : created.reversed()) {
            try (var statement = cleanup.createStatement()) {
              statement.execute(
                  "DROP TABLE " + TransformationData.qualified(adapter, "nla_import", table));
            }
          }
        }
      }
    }
  }

  private static Map<String, Object> await(DataQualityService service, String dataset, String run)
      throws Exception {
    long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
    Map<String, Object> result;
    do {
      result = service.get(dataset, run);
      if (!result.get("status").equals("RUNNING")) return result;
      Thread.sleep(30);
    } while (System.nanoTime() < deadline);
    throw new AssertionError("Quality check did not finish in30s");
  }
}

package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

/** Admission plus the actual guarded read-only adapter on the existing DB3 sample. */
@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class QueryAdmissionExecutionTest {
  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void admittedQueriesExecuteOnThreeRealReadersAndThenReleaseTheirSlot(String engine)
      throws Exception {
    String suffix = Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
    var env =
        new MockEnvironment()
            .withProperty("nla.warehouse-tls", "false")
            .withProperty(
                "TEST_READER_PASSWORD", System.getenv("NLA_CHINOOK_" + suffix + "_PASSWORD"));
    var adapters = new Adapters(env);
    var warehouse =
        Json.obj(
            "warehouseId", "warehouse",
            "engine", engine,
            "status", "ACTIVE",
            "host", "127.0.0.1",
            "port", Map.of("POSTGRESQL", 55432, "MYSQL", 53306, "SQL_SERVER", 51433).get(engine),
            "database", "nla_chinook",
            "username", "nla_reader");
    var adapter = adapters.get(warehouse);
    String schema =
        engine.equals("MYSQL") ? "nla_chinook" : engine.equals("POSTGRESQL") ? "public" : "dbo";
    String table = engine.equals("POSTGRESQL") ? "album" : "Album";
    List<Map<String, Object>> columns;
    try (var connection = adapter.connect(warehouse, env.getProperty("TEST_READER_PASSWORD"))) {
      columns = adapter.discoverColumns(connection, schema, table);
    }
    String sql =
        "SELECT COUNT(*) AS record_count FROM "
            + adapter.quoteIdentifier(schema)
            + "."
            + adapter.quoteIdentifier(table);
    var store = mock(Store.class);
    var catalog = mock(CatalogService.class);
    var ai = mock(AiClient.class);
    var planner = mock(SemanticPlannerClient.class);
    var gate = QueryAdmissionTest.gate(1);
    var dataset = Json.obj("datasetId", "dataset", "warehouseId", "warehouse", "status", "ACTIVE");
    var context =
        Json.obj(
            "metrics",
            List.of(),
            "dimensions",
            List.of(),
            "tables",
            List.of(Json.obj("schema", schema, "name", table, "columns", columns)));
    when(store.warehouse("warehouse")).thenReturn(warehouse);
    when(store.dataset("dataset")).thenReturn(dataset);
    when(store.credential("warehouse")).thenReturn("env:TEST_READER_PASSWORD");
    when(store.settings())
        .thenReturn(
            Json.obj(
                "limits",
                Json.obj("maxRows", 1000, "maxBytes", 100000, "statementTimeoutMs", 15000)));
    when(catalog.context("dataset")).thenReturn(context);
    when(catalog.tables("dataset")).thenReturn(Json.objects(context.get("tables")));
    when(ai.generate(anyMap(), anyString()))
        .thenReturn(
            Json.obj(
                "sql",
                sql,
                "model",
                "test-candidate",
                "explanation",
                "Reader count",
                "assumptions",
                List.of(),
                "selectedMetrics",
                List.of(),
                "selectedDimensions",
                List.of(),
                "chartRecommendation",
                Json.obj("type", "number", "title", "Records", "series", List.of())));
    when(planner.plan(anyString(), eq(engine), eq(sql), anyMap()))
        .thenReturn(
            new SemanticPlannerClient.PlanResult(
                sql, List.of(), List.of(Json.obj("schema", schema, "name", table))));
    var service =
        new QueryService(
            store,
            catalog,
            adapters,
            new SqlGuard(),
            ai,
            planner,
            mock(ModelProviderService.class),
            gate);
    var query =
        service.run(
            Json.obj(
                "warehouseId",
                "warehouse",
                "datasetId",
                "dataset",
                "question",
                "Reader acceptance",
                "mode",
                "DETERMINISTIC"));
    assertEquals("SUCCESS", query.get("status"), Json.write(query.get("error")));
    assertEquals(
        "347",
        Json.objects(Json.map(query.get("result")).get("rows"))
            .getFirst()
            .get("record_count")
            .toString());
    verify(store, times(2)).putQuery(anyMap());
    try (var lease = gate.enter()) {
      assertNotNull(lease);
    }
  }
}

package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import java.util.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class IngestionSourceDiscoveryTest {
  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void discoversActualSourceColumnsAndTargetsAndValidatesWithoutMutation(String engine) {
    String suffix = Map.of("POSTGRESQL", "PG", "MYSQL", "MYSQL", "SQL_SERVER", "MSSQL").get(engine);
    String schema =
        Map.of("POSTGRESQL", "public", "MYSQL", "nla_chinook", "SQL_SERVER", "dbo").get(engine);
    var environment =
        new MockEnvironment()
            .withProperty("nla.warehouse-tls", "false")
            .withProperty("TEST_READER", System.getenv("NLA_CHINOOK_" + suffix + "_PASSWORD"))
            .withProperty("TEST_WRITER", System.getenv("NLA_PIPELINE_" + suffix + "_PASSWORD"));
    var adapters = new Adapters(environment);
    var warehouse =
        Json.obj(
            "warehouseId",
            "source-warehouse",
            "engine",
            engine,
            "host",
            "127.0.0.1",
            "port",
            Map.of("POSTGRESQL", 55432, "MYSQL", 53306, "SQL_SERVER", 51433).get(engine),
            "database",
            "nla_chinook",
            "username",
            "nla_reader",
            "defaultSchema",
            schema,
            "status",
            "ACTIVE");
    String album = engine.equals("POSTGRESQL") ? "album" : "Album";
    String invoice = engine.equals("POSTGRESQL") ? "invoice" : "Invoice";
    var dataset =
        Json.obj(
            "datasetId",
            "source-dataset",
            "warehouseId",
            "source-warehouse",
            "status",
            "ACTIVE",
            "allowedSchemas",
            List.of(schema),
            "allowedTables",
            List.of(
                Json.obj("schema", schema, "name", album),
                Json.obj("schema", schema, "name", invoice)));
    var store = mock(Store.class);
    when(store.warehouse("source-warehouse")).thenReturn(warehouse);
    when(store.dataset("source-dataset")).thenReturn(dataset);
    when(store.credential("source-warehouse")).thenReturn("env:TEST_READER");
    when(store.ingestionUsername("source-warehouse")).thenReturn("nla_writer");
    when(store.ingestionCredential("source-warehouse")).thenReturn("env:TEST_WRITER");
    var catalog = new CatalogService(store, adapters);
    var service = new IngestionSourceService(store, adapters, catalog, new SqlGuard());
    var table =
        catalog.tables("source-dataset").stream()
            .filter(value -> album.equals(value.get("name")))
            .findFirst()
            .orElseThrow();
    var input =
        Json.obj(
            "sourceWarehouseId",
            "source-warehouse",
            "sourceDatasetId",
            "source-dataset",
            "tableId",
            table.get("tableId"));
    var result = service.preview(input);
    assertEquals(engine, result.get("sourceEngine"));
    assertEquals(20, Json.objects(result.get("rows")).size());
    assertEquals(true, result.get("truncated"));
    assertEquals(3, Json.objects(result.get("columns")).size());
    assertEquals(3, Json.map(result.get("columnTypes")).size());
    assertFalse(Json.str(result, "readSql").contains("*"));
    var oneColumn = new LinkedHashMap<>(input);
    oneColumn.put("columns", List.of(engine.equals("POSTGRESQL") ? "title" : "Title"));
    assertEquals(1, Json.objects(service.preview(oneColumn).get("columns")).size());
    var invalidColumn = new LinkedHashMap<>(input);
    invalidColumn.put("columns", List.of("does_not_exist"));
    assertThrows(ApiException.class, () -> service.preview(invalidColumn));
    var targets = service.targets("source-warehouse", "source-dataset");
    for (String layer : List.of("raw", "stage", "warehouse", "mart"))
      assertTrue(
          targets.stream()
              .anyMatch(value -> ("nla_" + layer + "_sales").equals(value.get("name"))));
    var adapter = adapters.get(warehouse);
    String country = engine.equals("POSTGRESQL") ? "billing_country" : "BillingCountry";
    String amount = engine.equals("POSTGRESQL") ? "total" : "Total";
    String sql =
        "SELECT "
            + adapter.quoteIdentifier(country)
            + " AS country, SUM("
            + adapter.quoteIdentifier(amount)
            + ") AS total FROM "
            + adapter.quoteIdentifier(schema)
            + "."
            + adapter.quoteIdentifier(invoice)
            + " GROUP BY "
            + adapter.quoteIdentifier(country);
    var advanced =
        Json.obj(
            "sourceWarehouseId",
            "source-warehouse",
            "sourceDatasetId",
            "source-dataset",
            "readSql",
            sql);
    var advancedPreview = service.preview(advanced);
    assertEquals(Set.of("country", "total"), Json.map(advancedPreview.get("columnTypes")).keySet());
    var draft =
        Json.obj(
            "name",
            "Actual source discovery test",
            "warehouseId",
            "source-warehouse",
            "datasetId",
            "source-dataset",
            "sourceWarehouseId",
            "source-warehouse",
            "sourceDatasetId",
            "source-dataset",
            "readSql",
            sql,
            "columns",
            List.of("country", "total"),
            "columnTypes",
            Json.obj("country", "STRING", "total", "DECIMAL"),
            "requiredColumns",
            List.of(),
            "maxStringLengths",
            Map.of(),
            "maxRows",
            10000,
            "maxBytes",
            5242880,
            "timeoutSeconds",
            15);
    for (String layer : List.of("raw", "stage", "warehouse", "mart"))
      draft.put(layer, Json.obj("schema", schema, "name", "nla_" + layer + "_sales"));
    var validated = service.validateDraft(draft);
    assertEquals(true, validated.get("reachable"));
    assertFalse(validated.containsKey("sourceId"));
    verify(store, never()).insertIngestionSource(any());
    verify(store, never()).updateIngestionSource(any());
    var badTarget = new LinkedHashMap<>(draft);
    badTarget.put("raw", Json.obj("schema", schema, "name", album));
    assertThrows(ApiException.class, () -> service.validateDraft(badTarget));
    var malicious = new LinkedHashMap<>(advanced);
    malicious.put(
        "readSql",
        "DELETE FROM " + adapter.quoteIdentifier(schema) + "." + adapter.quoteIdentifier(album));
    assertThrows(ApiException.class, () -> service.preview(malicious));
    var mixed = new LinkedHashMap<>(input);
    mixed.put("readSql", sql);
    assertThrows(ApiException.class, () -> service.preview(mixed));
    var unknown = new LinkedHashMap<>(input);
    unknown.put("credentialReference", "env:TEST_READER");
    assertThrows(ApiException.class, () -> service.preview(unknown));
    var wrongDataset = new LinkedHashMap<>(dataset);
    wrongDataset.put("warehouseId", "other-warehouse");
    when(store.dataset("source-dataset")).thenReturn(wrongDataset);
    assertThrows(ApiException.class, () -> service.preview(input));
    assertThrows(ApiException.class, () -> service.targets("source-warehouse", "source-dataset"));
  }
}

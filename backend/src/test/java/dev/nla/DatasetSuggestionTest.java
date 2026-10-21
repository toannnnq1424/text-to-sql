package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class DatasetSuggestionTest {
  static Map<String, Object> context(String schema, String table) {
    return Json.obj(
        "tables",
        List.of(
            Json.obj(
                "schema",
                schema,
                "name",
                table,
                "primaryKey",
                List.of("id"),
                "columns",
                List.of(
                    Json.obj("name", "id", "dataType", "BIGINT"),
                    Json.obj("name", "region_code", "dataType", "STRING"),
                    Json.obj("name", "measurement", "dataType", "DECIMAL"),
                    Json.obj("name", "observed_at", "dataType", "TIMESTAMP")))),
        "metrics",
        List.of(),
        "dimensions",
        List.of(),
        "examples",
        List.of(),
        "businessRules",
        List.of(),
        "relationships",
        List.of(),
        "semanticVersion",
        "active-s",
        "schemaVersion",
        "active-p",
        "timezone",
        "UTC");
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void newDatasetWithEmptyBusinessSemanticsGetsItsOwnPhysicalQuestions(String engine) {
    var first =
        DatasetSuggestionService.derive(
            context("climate", "station_events"), engine, new SqlGuard());
    var second =
        DatasetSuggestionService.derive(
            context("logistics", "delivery_events"), engine, new SqlGuard());
    assertFalse(first.isEmpty());
    assertTrue(first.stream().allMatch(item -> Json.str(item, "origin").equals("PHYSICAL_SCHEMA")));
    assertTrue(first.stream().allMatch(item -> item.get("sqlDialect").equals(engine)));
    assertTrue(Json.write(first).contains("climate.station_events"));
    assertFalse(Json.write(second).contains("station_events"));
    assertFalse(Json.write(first).toLowerCase(Locale.ROOT).contains("chinook"));
    assertTrue(first.stream().anyMatch(item -> "line".equals(item.get("chartType"))));
    assertTrue(first.stream().anyMatch(item -> "bar".equals(item.get("chartType"))));
    assertFalse(
        first.stream()
            .anyMatch(item -> Json.str(item, "question").startsWith("Tổng giá trị cột id")));
    assertTrue(first.stream().allMatch(item -> !item.containsKey("sql")));
  }

  @Test
  void semanticQuestionsUseOnlyDeclaredCompatibleDimensionsAndCuratedExamplesAreLabeled() {
    var context = context("analytics", "events");
    var ref = Json.obj("schema", "analytics", "name", "events");
    context.put(
        "dimensions",
        List.of(
            Json.obj("name", "region", "table", ref, "column", "region_code", "dataType", "STRING"),
            Json.obj(
                "name", "unused", "table", ref, "column", "region_code", "dataType", "STRING")));
    context.put(
        "metrics",
        List.of(
            Json.obj(
                "name",
                "amount_sum",
                "description",
                "Configured measurement sum",
                "tableRefs",
                List.of(ref),
                "compatibleDimensions",
                List.of("region"))));
    context.put(
        "examples",
        List.of(
            Json.obj(
                "question",
                "Approved measurement comparison?",
                "sqlDialect",
                "POSTGRESQL",
                "sql",
                "SELECT region_code, SUM(measurement) AS total, AVG(measurement) AS mean"
                    + " FROM analytics.events GROUP BY region_code",
                "chartRecommendation",
                Json.obj("type", "grouped-bar")),
            Json.obj(
                "question",
                "Unrelated invalid example?",
                "sqlDialect",
                "POSTGRESQL",
                "sql",
                "SELECT * FROM private.payroll")));
    var suggestions = DatasetSuggestionService.derive(context, "POSTGRESQL", new SqlGuard());
    assertTrue(
        suggestions.stream()
            .anyMatch(
                item ->
                    "SEMANTIC_MODEL".equals(item.get("origin"))
                        && List.of("region").equals(item.get("selectedDimensions"))));
    assertFalse(
        suggestions.stream()
            .anyMatch(item -> List.of("unused").equals(item.get("selectedDimensions"))));
    assertEquals(
        1, suggestions.stream().filter(item -> "CURATED".equals(item.get("origin"))).count());
    assertEquals(
        "grouped-bar",
        suggestions.stream()
            .filter(item -> "CURATED".equals(item.get("origin")))
            .findFirst()
            .orElseThrow()
            .get("chartType"));
  }

  @Test
  void draftMergingPreservesExistingDefinitionsUnlessSameNameIsProposed() {
    var kept = Json.obj("name", "existing", "description", "Original administrator description");
    var replaced = Json.obj("name", "editable", "description", "Original");
    var edit = Json.obj("name", "editable", "description", "Reviewed draft");
    var created = Json.obj("name", "new_measure", "description", "Draft");
    var merged = DatasetSuggestionService.merge(List.of(kept, replaced), List.of(edit, created));
    assertEquals(List.of(kept, edit, created), merged);
    assertEquals("Original", replaced.get("description"));
  }

  @Test
  void deniedResourceCannotReachMetadataOrModel() {
    Store store = mock(Store.class);
    CatalogService catalog = mock(CatalogService.class);
    AiClient ai = mock(AiClient.class);
    when(store.dataset("denied"))
        .thenThrow(
            new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "FORBIDDEN", "Denied"));
    var service = new DatasetSuggestionService(store, catalog, new SqlGuard(), ai);
    assertThrows(ApiException.class, () -> service.suggestions("denied", Map.of()));
    assertThrows(
        ApiException.class,
        () -> service.assist("denied", Json.obj("instruction", "Describe measurement")));
    verifyNoInteractions(catalog, ai);
    assertEquals(120, QueryDeadline.seconds(120));
  }

  @Test
  void semanticAssistanceValidatesMergedDraftAndNeverActivatesIt() {
    Store store = mock(Store.class);
    CatalogService catalog = mock(CatalogService.class);
    AiClient ai = mock(AiClient.class);
    var context = context("science", "observations");
    var ref = Json.obj("schema", "science", "name", "observations");
    var old =
        Json.obj(
            "name",
            "configured_metric",
            "description",
            "Administrator configured",
            "expression",
            "COUNT(*)",
            "tableRefs",
            List.of(ref),
            "compatibleDimensions",
            List.of());
    var proposed =
        Json.obj(
            "name",
            "proposed_metric",
            "description",
            "Model draft",
            "expression",
            "SUM(measurement)",
            "tableRefs",
            List.of(ref),
            "compatibleDimensions",
            List.of());
    context.put("metrics", List.of(old));
    context.put("businessRules", List.of("Existing rule"));
    when(store.dataset("dataset"))
        .thenReturn(
            Json.obj(
                "datasetId", "dataset", "warehouseId", "warehouse", "schemaVersion", "active-p"));
    when(store.warehouse("warehouse"))
        .thenReturn(Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL"));
    when(catalog.context("dataset")).thenReturn(context);
    when(catalog.tables("dataset")).thenReturn(Json.objects(context.get("tables")));
    when(ai.invoke(eq("semantic-assist"), anyMap(), anyInt()))
        .thenReturn(
            Json.obj(
                "model",
                "configured-model",
                "metrics",
                List.of(proposed),
                "dimensions",
                List.of(),
                "businessRules",
                List.of("Proposed rule"),
                "warnings",
                List.of("Review this draft")));
    when(ai.invoke(eq("business-validate"), anyMap(), anyInt()))
        .thenReturn(Json.obj("valid", true, "semanticVersion", "active-s"));
    var result =
        new DatasetSuggestionService(store, catalog, new SqlGuard(), ai)
            .assist("dataset", Json.obj("instruction", "Propose a sum metric"));
    var draft = Json.map(result.get("semanticModel"));
    assertEquals(List.of(old, proposed), draft.get("metrics"));
    assertEquals(List.of("Existing rule", "Proposed rule"), draft.get("businessRules"));
    assertEquals("active-s", draft.get("semanticVersion"));
    assertEquals(List.of(old), context.get("metrics"));
    verify(catalog).validateSemantic(anyMap(), anyList());
    verify(catalog).validateJoinCardinality(eq("dataset"), anyMap());
    verify(store, never()).updateDataset(anyMap(), anyMap());
    verify(store).audit(eq("SEMANTIC_ASSIST_DRAFT"), eq("dataset"), anyMap());
    assertEquals(120, QueryDeadline.seconds(120));
  }
}

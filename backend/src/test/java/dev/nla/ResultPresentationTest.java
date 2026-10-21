package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ResultPresentationTest {
  static Map<String, Object> column(String name, String type) {
    return Json.obj("name", name, "label", name, "dataType", type, "semanticRole", "OTHER");
  }

  static Map<String, Object> result(
      List<Map<String, Object>> columns, List<Map<String, Object>> rows) {
    return Json.obj(
        "columns", columns, "rows", rows, "returnedRowCount", rows.size(), "truncated", false);
  }

  @Test
  void scalarBecomesAnExactNumberEvenWhenModelRecommendedATable() {
    var result =
        result(
            List.of(column("record_count", "BIGINT")),
            List.of(Json.obj("record_count", "9007199254740993")));
    var chart = ResultPresentation.choose(Json.obj("type", "table", "series", List.of()), result);
    assertEquals("number", chart.get("type"));
    assertEquals(
        "9007199254740993", Json.objects(result.get("rows")).getFirst().get("record_count"));
  }

  @Test
  void actualGroupedAndTimeResultsReceiveUsefulChartsFromTypes() {
    var grouped =
        result(
            List.of(column("region", "STRING"), column("value", "DECIMAL")),
            List.of(
                Json.obj("region", "A", "value", "1.2500"),
                Json.obj("region", "B", "value", "2.50")));
    assertEquals(
        "table",
        ResultPresentation.choose(Json.obj("type", "table", "series", List.of()), grouped)
            .get("type"));
    var chart = ResultPresentation.choose(null, grouped);
    assertEquals("bar", chart.get("type"));
    assertEquals("region", chart.get("x"));
    var timeline =
        result(
            List.of(column("day", "DATE"), column("value", "DECIMAL")),
            List.of(
                Json.obj("day", "2026-10-01", "value", "1.25"),
                Json.obj("day", "2026-10-02", "value", "2.50")));
    assertEquals("line", ResultPresentation.choose(null, timeline).get("type"));
    assertEquals(
        "line",
        ResultPresentation.choose(
                Json.obj("type", "bar", "x", "day", "series", List.of(Json.obj("column", "value"))),
                timeline)
            .get("type"));
  }

  @Test
  void activeSemanticLabelsAndUnitsAreBoundByExactOutputName() {
    var result =
        result(
            List.of(
                column("sales", "DECIMAL"), column("orders", "BIGINT"), column("region", "STRING")),
            List.of(Json.obj("sales", "10.25", "orders", "2", "region", "A")));
    ResultPresentation.annotate(
        result,
        Json.obj(
            "metrics",
            List.of(
                Json.obj("name", "sales", "description", "Configured turnover", "unit", "EUR"),
                Json.obj("name", "orders", "description", "Approved count", "unit", "count")),
            "dimensions",
            List.of(Json.obj("name", "region", "description", "Defined region"))),
        Json.obj(
            "selectedMetrics",
            List.of("sales", "orders"),
            "selectedDimensions",
            List.of("region")));
    var columns = Json.objects(result.get("columns"));
    assertEquals("EUR", columns.getFirst().get("unit"));
    assertEquals("Configured turnover", columns.getFirst().get("label"));
    assertEquals("DIMENSION", columns.getLast().get("semanticRole"));
    var raw =
        Json.obj(
            "type",
            "grouped-bar",
            "x",
            "region",
            "series",
            List.of(
                Json.obj("column", "sales", "label", "sales"),
                Json.obj("column", "orders", "label", "orders")));
    assertFalse(ResultPresentation.valid(raw, result));
    assertEquals(1, Json.objects(ResultPresentation.choose(null, result).get("series")).size());
  }

  @Test
  void unsafeTypeEmptyResultsAndUnrepresentableGraphValuesStayTables() {
    var actual =
        result(
            List.of(column("region", "STRING"), column("huge", "BIGINT")),
            List.of(Json.obj("region", "A", "huge", "9007199254740993")));
    assertEquals("table", ResultPresentation.choose(null, actual).get("type"));
    assertEquals(
        "table", ResultPresentation.choose(Json.obj("type", "javascript"), actual).get("type"));
    assertEquals(
        "table",
        ResultPresentation.choose(null, result(List.of(column("x", "INTEGER")), List.of()))
            .get("type"));
  }

  @Test
  void explicitChartRequiresActualNumericSeriesAndNonnegativePieValues() {
    var actual =
        result(
            List.of(column("region", "STRING"), column("value", "DECIMAL")),
            List.of(Json.obj("region", "A", "value", "-1"), Json.obj("region", "B", "value", "2")));
    var pie =
        Json.obj(
            "type",
            "pie",
            "x",
            "region",
            "series",
            List.of(Json.obj("column", "value", "label", "Value")));
    assertFalse(ResultPresentation.valid(pie, actual));
    pie.put("type", "bar");
    assertTrue(ResultPresentation.valid(pie, actual));
    pie.put("x", "outside");
    assertFalse(ResultPresentation.valid(pie, actual));
  }

  @Test
  void coincidentalAliasesDoNotReceiveUnselectedBusinessDescriptionsAndUnits() {
    var actual = result(List.of(column("sales", "BIGINT")), List.of(Json.obj("sales", "2")));
    ResultPresentation.annotate(
        actual,
        Json.obj(
            "metrics",
            List.of(Json.obj("name", "sales", "description", "Turnover", "unit", "USD"))),
        Json.obj("selectedMetrics", List.of(), "selectedDimensions", List.of()));
    var column = Json.objects(actual.get("columns")).getFirst();
    assertEquals("sales", column.get("label"));
    assertFalse(column.containsKey("unit"));
  }

  @Test
  void unknownUnitsCannotJustifyCombiningMeasuresOnOneAxis() {
    var actual =
        result(
            List.of(
                column("group", "STRING"), column("count", "BIGINT"), column("price", "DECIMAL")),
            List.of(Json.obj("group", "A", "count", "2", "price", "4.5")));
    var spec =
        Json.obj(
            "type",
            "grouped-bar",
            "x",
            "group",
            "series",
            List.of(Json.obj("column", "count"), Json.obj("column", "price")));
    assertFalse(ResultPresentation.valid(spec, actual));
    var columns = Json.objects(actual.get("columns"));
    columns.get(1).put("unit", "count");
    columns.get(2).put("unit", "count");
    assertTrue(ResultPresentation.valid(spec, actual));
    spec.put("type", "bar");
    assertEquals("grouped-bar", ResultPresentation.choose(spec, actual).get("type"));
  }
}

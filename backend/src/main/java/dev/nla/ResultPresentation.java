package dev.nla;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Result-shape presentation, with business labels only from the active authorized definitions. */
final class ResultPresentation {
  private static final Set<String> NUMERIC = Set.of("INTEGER", "BIGINT", "DECIMAL", "FLOAT");
  private static final Set<String> TYPES =
      Set.of("table", "number", "bar", "grouped-bar", "line", "area", "pie");
  private static final BigDecimal MAX_CHART = new BigDecimal("9007199254740991");

  private ResultPresentation() {}

  static void annotate(
      Map<String, Object> result, Map<String, Object> context, Map<String, Object> candidate) {
    Map<String, Map<String, Object>> metrics = new LinkedHashMap<>();
    Map<String, Map<String, Object>> dimensions = new LinkedHashMap<>();
    for (var metric : Json.objects(context.get("metrics")))
      if (((List<?>) candidate.get("selectedMetrics")).contains(metric.get("name")))
        metrics.put(Json.str(metric, "name"), metric);
    for (var dimension : Json.objects(context.get("dimensions")))
      if (((List<?>) candidate.get("selectedDimensions")).contains(dimension.get("name")))
        dimensions.put(Json.str(dimension, "name"), dimension);
    for (var column : Json.objects(result.get("columns"))) {
      String name = Json.str(column, "name");
      if (metrics.containsKey(name)) {
        var metric = metrics.get(name);
        column.put("semanticRole", "METRIC");
        if (!Json.str(metric, "unit").isBlank()) column.put("unit", metric.get("unit"));
        if (!Json.str(metric, "description").isBlank())
          column.put("label", metric.get("description"));
      } else if (dimensions.containsKey(name)) {
        var dimension = dimensions.get(name);
        column.put("semanticRole", isTime(column) ? "TIME" : "DIMENSION");
        if (!Json.str(dimension, "description").isBlank())
          column.put("label", dimension.get("description"));
      }
    }
  }

  static Map<String, Object> choose(Object recommendation, Map<String, Object> result) {
    var preferred = Json.map(recommendation);
    var columns = Json.objects(result.get("columns"));
    var rows = Json.objects(result.get("rows"));
    if (rows.isEmpty()) return table("Không có dòng dữ liệu để vẽ biểu đồ.");
    String type = Json.str(preferred, "type");
    if (!type.isBlank() && !TYPES.contains(type)) return table("Loại biểu đồ không được hỗ trợ.");
    var numeric = columns.stream().filter(ResultPresentation::isNumeric).toList();
    if (columns.size() == 1 && numeric.size() == 1 && rowCount(result) == 1)
      return spec(
          "number",
          title(preferred, label(numeric.getFirst())),
          null,
          List.of(numeric.getFirst()),
          "Một giá trị số được trình bày thành chỉ số.");
    if (type.equals("table"))
      return table("Kết quả được đề xuất dạng bảng; có thể chọn biểu đồ theo các cột phù hợp.");
    if (!type.equals("table") && !type.isBlank() && valid(preferred, result)) {
      var copy = new LinkedHashMap<>(preferred);
      copy.putIfAbsent("title", "Kết quả phân tích");
      var series = Json.objects(preferred.get("series"));
      copy.put(
          "series",
          series.stream()
              .map(
                  item -> {
                    var column =
                        columns.stream()
                            .filter(c -> Json.str(c, "name").equals(item.get("column")))
                            .findFirst()
                            .orElseThrow();
                    return Json.obj("column", item.get("column"), "label", label(column));
                  })
              .toList());
      if (type.equals("bar") && series.size() > 1) copy.put("type", "grouped-bar");
      if (type.equals("bar")
          && columns.stream()
              .anyMatch(c -> Json.str(c, "name").equals(preferred.get("x")) && isTime(c))) {
        copy.put("type", "line");
      }
      return copy;
    }
    var dimension =
        columns.stream()
            .filter(column -> !isNumeric(column) || "DIMENSION".equals(column.get("semanticRole")))
            .filter(column -> rows.stream().anyMatch(row -> row.get(column.get("name")) != null))
            .findFirst();
    if (dimension.isEmpty() || numeric.isEmpty())
      return table("Chọn cột phân loại/thời gian và chỉ số số phù hợp để trực quan hóa.");
    var x = dimension.get();
    var measures =
        numeric.stream()
            .filter(column -> column != x)
            .filter(column -> !"DIMENSION".equals(column.get("semanticRole")))
            .filter(column -> graphable(column, rows))
            .toList();
    if (measures.isEmpty())
      return table("Giá trị không đủ chính xác hoặc không hữu hạn để vẽ đồ thị.");
    var first = measures.getFirst();
    List<Map<String, Object>> compatible = new ArrayList<>();
    compatible.add(first);
    String unit = Json.str(first, "unit");
    if (!unit.isBlank()) {
      measures.stream()
          .skip(1)
          .filter(column -> unit.equals(column.get("unit")))
          .limit(3)
          .forEach(compatible::add);
    }
    String selected = isTime(x) ? "line" : compatible.size() > 1 ? "grouped-bar" : "bar";
    return spec(
        selected,
        title(preferred, label(first) + " theo " + label(x)),
        Json.str(x, "name"),
        compatible,
        isTime(x)
            ? "Dữ liệu có chiều thời gian và chỉ số số."
            : "So sánh chỉ số theo các nhóm trong kết quả thực.");
  }

  static boolean valid(Map<String, Object> chart, Map<String, Object> result) {
    String type = Json.str(chart, "type");
    if (!TYPES.contains(type)) return false;
    if (type.equals("table")) return true;
    var columns = Json.objects(result.get("columns"));
    var rows = Json.objects(result.get("rows"));
    var series = Json.objects(chart.get("series"));
    if (series.isEmpty() || series.size() > 5 || rows.isEmpty()) return false;
    var selected = new ArrayList<Map<String, Object>>();
    Set<String> unique = new HashSet<>();
    for (var item : series) {
      var column =
          columns.stream()
              .filter(c -> Json.str(c, "name").equals(item.get("column")))
              .filter(ResultPresentation::isNumeric)
              .findFirst();
      if (column.isEmpty() || !unique.add(Json.str(column.get(), "name"))) return false;
      selected.add(column.get());
    }
    if (type.equals("number")) return series.size() == 1 && rowCount(result) == 1;
    var x = columns.stream().filter(c -> Json.str(c, "name").equals(chart.get("x"))).findFirst();
    if (x.isEmpty() || unique.contains(chart.get("x"))) return false;
    if (Set.of("line", "area").contains(type) && !isTime(x.get())) return false;
    if (selected.stream().map(c -> Json.str(c, "unit")).distinct().count() > 1) return false;
    if (selected.size() > 1 && Json.str(selected.getFirst(), "unit").isBlank()) return false;
    if (selected.stream().anyMatch(c -> !graphable(c, rows))) return false;
    if (type.equals("pie")) {
      if (selected.size() != 1) return false;
      String name = Json.str(selected.getFirst(), "name");
      if (rows.stream()
          .anyMatch(
              row ->
                  row.get(name) != null && new BigDecimal(row.get(name).toString()).signum() < 0))
        return false;
    }
    return true;
  }

  private static boolean graphable(Map<String, Object> column, List<Map<String, Object>> rows) {
    for (var row : rows) {
      Object value = row.get(column.get("name"));
      if (value == null) continue;
      try {
        if (new BigDecimal(value.toString()).abs().compareTo(MAX_CHART) > 0) return false;
      } catch (NumberFormatException failure) {
        return false;
      }
    }
    return true;
  }

  private static int rowCount(Map<String, Object> result) {
    Object count = result.get("returnedRowCount");
    return count instanceof Number number
        ? number.intValue()
        : Json.objects(result.get("rows")).size();
  }

  private static boolean isNumeric(Map<String, Object> column) {
    return NUMERIC.contains(Json.str(column, "dataType"));
  }

  private static boolean isTime(Map<String, Object> column) {
    return Set.of("DATE", "TIMESTAMP").contains(Json.str(column, "dataType"))
        || "TIME".equals(column.get("semanticRole"));
  }

  private static String label(Map<String, Object> column) {
    return Json.str(column, "label").isBlank()
        ? Json.str(column, "name")
        : Json.str(column, "label");
  }

  private static String title(Map<String, Object> preferred, String fallback) {
    String title = Json.str(preferred, "title");
    return title.isBlank() || Set.of("Kết quả truy vấn", "Bảng kết quả").contains(title)
        ? fallback
        : title;
  }

  private static Map<String, Object> spec(
      String type, String title, String x, List<Map<String, Object>> columns, String reason) {
    var result =
        Json.obj(
            "type",
            type,
            "title",
            title,
            "series",
            columns.stream()
                .map(c -> Json.obj("column", c.get("name"), "label", label(c)))
                .toList(),
            "reason",
            reason);
    if (x != null) result.put("x", x);
    return result;
  }

  private static Map<String, Object> table(String reason) {
    return Json.obj(
        "type", "table", "title", "Bảng kết quả", "series", List.of(), "reason", reason);
  }
}

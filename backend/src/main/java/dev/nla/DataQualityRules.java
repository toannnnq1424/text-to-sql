package dev.nla;

import dev.nla.warehouse.WarehouseAdapter;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/** Physical-metadata-bound quality assertions. No SQL expressions or row values from the caller. */
final class DataQualityRules {
  private static final Set<String> NUMERIC = Set.of("INTEGER", "BIGINT", "DECIMAL", "FLOAT");
  private static final Set<String> COMPARABLE =
      Set.of(
          "INTEGER",
          "BIGINT",
          "DECIMAL",
          "FLOAT",
          "STRING",
          "BOOLEAN",
          "DATE",
          "TIME",
          "TIMESTAMP");
  private static final Set<String> TYPES =
      Set.of("NOT_NULL", "UNIQUE", "RANGE", "ACCEPTED_VALUES", "ROW_COUNT", "REFERENCE");

  private DataQualityRules() {}

  static List<Map<String, Object>> validate(Object input, List<Map<String, Object>> tables) {
    if (!(input instanceof List<?> list) || list.size() > 20)
      throw ApiException.bad("Cấu hình chất lượng cần tối đa20 quy tắc.");
    var result = new ArrayList<Map<String, Object>>();
    var identifiers = new HashSet<String>();
    for (Object item : list) {
      if (!(item instanceof Map<?, ?>)) throw ApiException.bad("Quy tắc không hợp lệ.");
      var rule = Json.map(item);
      String type = text(rule.get("type"), 30);
      if (!TYPES.contains(type)) throw ApiException.bad("Loại quy tắc không hợp lệ.");
      Set<String> fields = new HashSet<>(Set.of("ruleId", "name", "type", "table", "enabled"));
      if (!type.equals("ROW_COUNT")) fields.add("column");
      if (Set.of("RANGE", "ROW_COUNT").contains(type)) fields.addAll(Set.of("min", "max"));
      if (type.equals("ACCEPTED_VALUES")) fields.add("values");
      if (type.equals("REFERENCE")) fields.addAll(Set.of("referenceTable", "referenceColumn"));
      RegistryController.fields(rule, fields);
      String id = text(rule.get("ruleId"), 80);
      if (!id.matches("[A-Za-z0-9_-]{1,80}") || !identifiers.add(id))
        throw ApiException.bad("ID quy tắc bị trùng hoặc không hợp lệ.");
      if (!(rule.get("enabled") instanceof Boolean))
        throw ApiException.bad("enabled phải là boolean.");
      var physical = table(rule.get("table"), tables);
      var checked = new LinkedHashMap<String, Object>();
      checked.put("ruleId", id);
      checked.put("name", text(rule.get("name"), 120));
      checked.put("type", type);
      checked.put("table", reference(physical));
      checked.put("enabled", rule.get("enabled"));
      Map<String, Object> column = null;
      if (!type.equals("ROW_COUNT")) {
        column = column(physical, rule.get("column"));
        checked.put("column", column.get("name"));
      }
      String dataType = column == null ? "" : Json.str(column, "dataType");
      if (type.equals("UNIQUE") && !COMPARABLE.contains(dataType))
        throw ApiException.bad("Kiểu cột không hỗ trợ kiểm tra duy nhất.");
      if (Set.of("RANGE", "ROW_COUNT").contains(type)) {
        if (type.equals("RANGE") && !NUMERIC.contains(dataType))
          throw ApiException.bad("Miền số chỉ áp dụng cho cột số.");
        if (!rule.containsKey("min") && !rule.containsKey("max"))
          throw ApiException.bad("Cần ít nhất một cận min/max.");
        BigDecimal min = null, max = null;
        if (rule.containsKey("min")) {
          min = bound(rule.get("min"), type.equals("ROW_COUNT"));
          checked.put("min", min.toPlainString());
        }
        if (rule.containsKey("max")) {
          max = bound(rule.get("max"), type.equals("ROW_COUNT"));
          checked.put("max", max.toPlainString());
        }
        if (min != null && max != null && min.compareTo(max) > 0)
          throw ApiException.bad("Cận min phải không lớn hơn max.");
      }
      if (type.equals("ACCEPTED_VALUES")) {
        if (!dataType.equals("STRING"))
          throw ApiException.bad("Danh sách giá trị chỉ áp dụng cho cột văn bản.");
        if (!(rule.get("values") instanceof List<?> values)
            || values.isEmpty()
            || values.size() > 50) throw ApiException.bad("Danh sách cần1..50 giá trị văn bản.");
        var unique = new HashSet<String>();
        var accepted = new ArrayList<String>();
        for (Object value : values) {
          if (!(value instanceof String string)
              || string.length() > 256
              || string.chars().anyMatch(Character::isISOControl)
              || !unique.add(string))
            throw ApiException.bad("Giá trị văn bản bị trùng/không hợp lệ.");
          accepted.add(string);
        }
        checked.put("values", accepted);
      }
      if (type.equals("REFERENCE")) {
        var target = table(rule.get("referenceTable"), tables);
        var targetColumn = column(target, rule.get("referenceColumn"));
        String targetType = Json.str(targetColumn, "dataType");
        if (!COMPARABLE.contains(dataType)
            || !(dataType.equals(targetType)
                || (NUMERIC.contains(dataType) && NUMERIC.contains(targetType))))
          throw ApiException.bad("Cột tham chiếu không có kiểu so sánh tương thích.");
        checked.put("referenceTable", reference(target));
        checked.put("referenceColumn", targetColumn.get("name"));
      }
      result.add(checked);
    }
    return result;
  }

  private static Map<String, Object> table(Object input, List<Map<String, Object>> tables) {
    if (!(input instanceof Map<?, ?>)) throw ApiException.bad("Thiếu bảng vật lý của quy tắc.");
    var ref = Json.map(input);
    RegistryController.fields(ref, Set.of("schema", "name"));
    if (!(ref.get("schema") instanceof String) || !(ref.get("name") instanceof String))
      throw ApiException.bad("Tên/schema bảng không hợp lệ.");
    return tables.stream()
        .filter(
            t ->
                Objects.equals(t.get("schema"), ref.get("schema"))
                    && Objects.equals(t.get("name"), ref.get("name")))
        .filter(t -> !Boolean.FALSE.equals(t.get("queryable")))
        .findFirst()
        .orElseThrow(() -> ApiException.bad("Bảng ngoài allowlist hoặc không truy vấn được."));
  }

  private static Map<String, Object> reference(Map<String, Object> table) {
    return Json.obj("schema", table.get("schema"), "name", table.get("name"));
  }

  private static Map<String, Object> column(Map<String, Object> table, Object value) {
    if (!(value instanceof String)) throw ApiException.bad("Thiếu cột của quy tắc.");
    return Json.objects(table.get("columns")).stream()
        .filter(c -> Objects.equals(c.get("name"), value))
        .findFirst()
        .orElseThrow(() -> ApiException.bad("Cột không có trong bảng được cấp quyền."));
  }

  private static String text(Object input, int maximum) {
    if (!(input instanceof String text)
        || text.isBlank()
        || text.length() > maximum
        || text.chars().anyMatch(Character::isISOControl))
      throw ApiException.bad("Trường văn bản của quy tắc không hợp lệ.");
    return text;
  }

  private static BigDecimal bound(Object input, boolean rowCount) {
    if (!(input instanceof String value)
        || value.length() > 100
        || !value.matches(rowCount ? "[0-9]+" : "-?(?:[0-9]+)(?:\\.[0-9]+)?"))
      throw ApiException.bad("Cận phải là chuỗi số thập phân hữu hạn, không dùng số mũ.");
    try {
      var number = new BigDecimal(value);
      if (rowCount && number.toBigIntegerExact().compareTo(BigInteger.valueOf(Long.MAX_VALUE)) > 0)
        throw new ArithmeticException();
      if (!rowCount && (number.precision() > 38 || number.scale() > 18))
        throw new ArithmeticException();
      return number;
    } catch (ArithmeticException invalid) {
      throw ApiException.bad("Cận vượt độ chính xác hoặc giới hạn số dòng.");
    }
  }

  static String sql(Map<String, Object> rule, WarehouseAdapter adapter) {
    String count = adapter.engine().equals("SQL_SERVER") ? "COUNT_BIG" : "COUNT";
    String source = qualified(adapter, Json.map(rule.get("table"))) + " AS src";
    String column =
        rule.containsKey("column")
            ? "src." + adapter.quoteIdentifier(Json.str(rule, "column"))
            : "*";
    String checked = count + "(" + column + ")";
    String violations;
    switch (Json.str(rule, "type")) {
      case "NOT_NULL" -> {
        checked = count + "(*)";
        violations = count + "(*)-" + count + "(" + column + ")";
      }
      case "UNIQUE" -> violations = checked + "-" + count + "(DISTINCT " + column + ")";
      case "ROW_COUNT" -> violations = "0";
      case "RANGE" -> {
        var conditions = new ArrayList<String>();
        if (rule.containsKey("min")) conditions.add(column + "<" + rule.get("min"));
        if (rule.containsKey("max")) conditions.add(column + ">" + rule.get("max"));
        violations = count + "(CASE WHEN " + String.join(" OR ", conditions) + " THEN 1 END)";
      }
      case "ACCEPTED_VALUES" -> {
        String accepted =
            ((List<?>) rule.get("values"))
                .stream()
                    .map(v -> literal(v.toString(), adapter.engine()))
                    .collect(Collectors.joining(","));
        violations = count + "(CASE WHEN " + column + " NOT IN (" + accepted + ") THEN 1 END)";
      }
      case "REFERENCE" -> {
        String target = qualified(adapter, Json.map(rule.get("referenceTable")));
        String targetColumn = "ref." + adapter.quoteIdentifier(Json.str(rule, "referenceColumn"));
        // A correlated NOT EXISTS stays in the WHERE, never inside COUNT's scalar argument.
        return "SELECT (SELECT "
            + count
            + "("
            + column
            + ") FROM "
            + source
            + ") AS checked_rows,"
            + count
            + "(*) AS violations FROM "
            + source
            + " WHERE "
            + column
            + " IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "
            + target
            + " AS ref WHERE "
            + targetColumn
            + "="
            + column
            + ")";
      }
      default -> throw ApiException.bad("Loại quy tắc không hợp lệ.");
    }
    return "SELECT " + checked + " AS checked_rows," + violations + " AS violations FROM " + source;
  }

  static String qualified(WarehouseAdapter adapter, Map<String, Object> table) {
    return adapter.quoteIdentifier(Json.str(table, "schema"))
        + "."
        + adapter.quoteIdentifier(Json.str(table, "name"));
  }

  private static String literal(String value, String engine) {
    if (engine.equals("MYSQL"))
      return "CONVERT(X'"
          + HexFormat.of().formatHex(value.getBytes(StandardCharsets.UTF_8))
          + "' USING utf8mb4)";
    if (engine.equals("POSTGRESQL"))
      return "E'" + value.replace("\\", "\\\\").replace("'", "''") + "'";
    return "N'" + value.replace("'", "''") + "'";
  }

  static Map<String, Object> counts(Map<String, Object> rule, Map<String, Object> result) {
    var rows = Json.objects(result.get("rows"));
    if (rows.size() != 1 || Boolean.TRUE.equals(result.get("truncated")))
      throw new ApiException(
          org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
          "QUALITY_RESULT_INVALID",
          "Warehouse không trả đúng một kết quả đếm.");
    var row = rows.getFirst();
    String checked = countValue(row.get("checked_rows"));
    String violations = countValue(row.get("violations"));
    String observed = null;
    if (rule.get("type").equals("ROW_COUNT")) {
      observed = checked;
      var actual = new BigInteger(checked);
      boolean valid =
          (!rule.containsKey("min")
                  || actual.compareTo(new BigInteger(rule.get("min").toString())) >= 0)
              && (!rule.containsKey("max")
                  || actual.compareTo(new BigInteger(rule.get("max").toString())) <= 0);
      violations = valid ? "0" : "1";
    }
    return Json.obj("checkedRows", checked, "violations", violations, "observedValue", observed);
  }

  private static String countValue(Object value) {
    try {
      if (value == null) throw new ArithmeticException();
      var number = new BigDecimal(value.toString()).toBigIntegerExact();
      if (number.signum() < 0) throw new ArithmeticException();
      return number.toString();
    } catch (NumberFormatException | ArithmeticException invalid) {
      throw new ApiException(
          org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
          "QUALITY_RESULT_INVALID",
          "Warehouse trả số đếm không hợp lệ.");
    }
  }
}

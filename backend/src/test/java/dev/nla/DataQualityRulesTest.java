package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.Adapters;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

class DataQualityRulesTest {
  static Map<String, Object> table() {
    return Json.obj(
        "schema",
        "qa",
        "name",
        "observations",
        "queryable",
        true,
        "columns",
        List.of(
            Json.obj("name", "id", "dataType", "BIGINT"),
            Json.obj("name", "parent_id", "dataType", "BIGINT"),
            Json.obj("name", "amount", "dataType", "DECIMAL"),
            Json.obj("name", "label", "dataType", "STRING"),
            Json.obj("name", "payload", "dataType", "BINARY")));
  }

  static Map<String, Object> rule(String type) {
    var r =
        Json.obj(
            "ruleId",
            "r-1",
            "name",
            "Quality check",
            "type",
            type,
            "table",
            Json.obj("schema", "qa", "name", "observations"),
            "enabled",
            true);
    if (!type.equals("ROW_COUNT"))
      r.put(
          "column",
          switch (type) {
            case "RANGE" -> "amount";
            case "ACCEPTED_VALUES" -> "label";
            default -> "id";
          });
    if (type.equals("RANGE") || type.equals("ROW_COUNT")) {
      r.put("min", "0");
      r.put("max", "10");
    }
    if (type.equals("ACCEPTED_VALUES"))
      r.put("values", List.of("Nhạc O'Brien", "Windows\\value--"));
    if (type.equals("REFERENCE")) {
      r.put("column", "parent_id");
      r.put("referenceTable", r.get("table"));
      r.put("referenceColumn", "id");
    }
    return r;
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void allGeneratedAssertionsAreGuardedSingleAggregateSelects(String engine) {
    var adapters = new Adapters(new MockEnvironment().withProperty("nla.warehouse-tls", "false"));
    var adapter =
        adapters.get(
            Json.obj(
                "engine",
                engine,
                "host",
                "127.0.0.1",
                "database",
                "qa",
                "username",
                "reader",
                "port",
                1234));
    for (String type :
        List.of("NOT_NULL", "UNIQUE", "RANGE", "ACCEPTED_VALUES", "ROW_COUNT", "REFERENCE")) {
      var r = DataQualityRules.validate(List.of(rule(type)), List.of(table())).getFirst();
      String sql = DataQualityRules.sql(r, adapter);
      var validated = new SqlGuard().validate(sql, engine, List.of(table()));
      assertFalse(validated.sourceTables().isEmpty(), type);
      assertFalse(sql.toUpperCase().contains("LIMIT"), type);
      assertFalse(sql.toUpperCase().contains("TOP "), type);
    }
  }

  @Test
  void rejectsInvalidFieldsReferencesTypesAndBoundsBeforeQuery() {
    var inputs = new ArrayList<Map<String, Object>>();
    var r = rule("NOT_NULL");
    r.put("sql", "DROP TABLE x");
    inputs.add(r);
    r = rule("NOT_NULL");
    r.put("column", "no_column");
    inputs.add(r);
    r = rule("NOT_NULL");
    r.put("table", Json.obj("schema", "other", "name", "observations"));
    inputs.add(r);
    r = rule("UNIQUE");
    r.put("column", "payload");
    inputs.add(r);
    r = rule("RANGE");
    r.put("column", "label");
    inputs.add(r);
    r = rule("RANGE");
    r.put("min", "10;DELETE FROM x");
    inputs.add(r);
    r = rule("RANGE");
    r.put("min", "1e6");
    inputs.add(r);
    r = rule("RANGE");
    r.put("min", "0.0000000000000000001");
    inputs.add(r);
    r = rule("RANGE");
    r.put("min", "999999999999999999999999999999999999999");
    inputs.add(r);
    r = rule("RANGE");
    r.put("min", "20");
    inputs.add(r);
    r = rule("RANGE");
    r.remove("min");
    r.remove("max");
    inputs.add(r);
    r = rule("ROW_COUNT");
    r.put("max", "9223372036854775808");
    inputs.add(r);
    r = rule("ROW_COUNT");
    r.put("min", "-1");
    inputs.add(r);
    r = rule("ROW_COUNT");
    r.put("min", "0.5");
    inputs.add(r);
    r = rule("ACCEPTED_VALUES");
    r.put("values", List.of("x", "x"));
    inputs.add(r);
    r = rule("ACCEPTED_VALUES");
    r.put("values", List.of());
    inputs.add(r);
    r = rule("ACCEPTED_VALUES");
    r.put("column", "id");
    inputs.add(r);
    r = rule("REFERENCE");
    r.put("referenceColumn", "payload");
    inputs.add(r);
    r = rule("REFERENCE");
    r.put("referenceColumn", "label");
    inputs.add(r);
    for (var invalid : inputs)
      assertThrows(
          ApiException.class,
          () -> DataQualityRules.validate(List.of(invalid), List.of(table())),
          Json.str(invalid, "type"));
    assertThrows(
        ApiException.class,
        () ->
            DataQualityRules.validate(
                List.of(rule("NOT_NULL"), rule("NOT_NULL")), List.of(table())));
    assertThrows(
        ApiException.class,
        () ->
            DataQualityRules.validate(
                java.util.Collections.nCopies(21, rule("NOT_NULL")), List.of(table())));
    assertEquals(List.of(), DataQualityRules.validate(List.of(), List.of(table())));
  }

  @Test
  void decimalAndBigIntegerCountsStayExactAndEmptyAggregateIsNotFabricated() {
    var r = rule("ROW_COUNT");
    r.put("min", "9007199254740993");
    r.put("max", "9007199254740993");
    r = DataQualityRules.validate(List.of(r), List.of(table())).getFirst();
    var result =
        Json.obj(
            "rows",
            List.of(Json.obj("checked_rows", "9007199254740993", "violations", "0")),
            "truncated",
            false);
    var counts = DataQualityRules.counts(r, result);
    assertEquals("9007199254740993", counts.get("observedValue"));
    assertEquals("0", counts.get("violations"));
    result.put("rows", List.of(Json.obj("checked_rows", "9007199254740992", "violations", "0")));
    assertEquals("1", DataQualityRules.counts(r, result).get("violations"));
    var finalRule = r;
    assertThrows(
        ApiException.class, () -> DataQualityRules.counts(finalRule, Json.obj("rows", List.of())));
    assertThrows(
        ApiException.class,
        () ->
            DataQualityRules.counts(
                finalRule,
                Json.obj("rows", List.of(Json.obj("checked_rows", "0.5", "violations", "0")))));
  }
}

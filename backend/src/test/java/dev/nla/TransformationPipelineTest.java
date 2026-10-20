package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.*;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Types;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class TransformationPipelineTest {
  static Map<String, Object> definition() {
    var transform =
        Json.obj(
            "columns",
            List.of(Json.obj("name", "revenue", "expression", "SUM(amount)")),
            "groupBy",
            List.of(),
            "filter",
            "");
    return Json.obj(
        "name",
        "Revenue pipeline",
        "sourceWarehouseId",
        "source",
        "sourceDatasetId",
        "dataset",
        "sourceTable",
        Json.obj("schema", "sales", "name", "orders"),
        "targetWarehouseId",
        "target",
        "targetSchema",
        "analytics",
        "targetTable",
        "daily",
        "datasetName",
        "Daily revenue",
        "stages",
        Json.obj("staging", transform, "warehouse", transform, "mart", transform));
  }

  @Test
  void rejectsMalformedTransformsAndUnsafeOrUnboundedNamesBeforeExecution() {
    var definition = definition();
    definition.put("maxRows", 10001);
    assertThrows(ApiException.class, () -> TransformationPipelineService.definition(definition));
    definition.put("maxRows", 4.5);
    assertThrows(ApiException.class, () -> TransformationPipelineService.definition(definition));
    definition.put("maxRows", 10);
    definition.put("targetTable", "sales; DROP TABLE orders");
    assertThrows(ApiException.class, () -> TransformationPipelineService.definition(definition));
    definition.put("targetTable", "daily");
    Json.map(definition.get("stages")).remove("mart");
    assertThrows(ApiException.class, () -> TransformationPipelineService.definition(definition));
  }

  @Test
  void copiesConfigurationBeforeNormalizingAndRequiresExplicitSupportedColumnTypes() {
    var original = definition();
    var normalized = TransformationPipelineService.definition(original);
    assertFalse(original.containsKey("maxRows"));
    assertEquals(1000, normalized.get("maxRows"));
    var physical =
        TransformationData.columns(
            List.of(Json.obj("name", "Tổng doanh thu", "dataType", "DECIMAL")));
    assertEquals("Tổng doanh thu", physical.getFirst().get("name"));
    var invalidTextField = definition();
    invalidTextField.put("sourceDatasetId", List.of("dataset"));
    assertThrows(
        ApiException.class, () -> TransformationPipelineService.definition(invalidTextField));
    assertThrows(
        ApiException.class,
        () -> TransformationData.columns(List.of(Json.obj("name", "id", "dataType", "ARRAY"))));
    assertThrows(
        ApiException.class,
        () ->
            TransformationData.columns(
                List.of(
                    Json.obj("name", "id", "dataType", "INTEGER"),
                    Json.obj("name", "ID", "dataType", "BIGINT"))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void substitutedSqlRetainsExactSingleSourceAndAliases(String engine) throws Exception {
    WarehouseAdapter adapter =
        switch (engine) {
          case "POSTGRESQL" -> new PostgreSqlWarehouseAdapter(false);
          case "MYSQL" -> new MySqlWarehouseAdapter(false);
          default -> new SqlServerWarehouseAdapter(false);
        };
    String input = adapter.quoteIdentifier("input");
    String sql =
        "SELECT SUM("
            + input
            + "."
            + adapter.quoteIdentifier("amount")
            + ") AS "
            + adapter.quoteIdentifier("revenue")
            + " FROM "
            + adapter.quoteIdentifier("__nla_input")
            + " AS "
            + input;
    String actual = TransformationData.targetSql(sql, adapter, "analytics", "daily_raw");
    var result =
        new SqlGuard()
            .validate(
                actual,
                engine,
                List.of(
                    Json.obj(
                        "schema",
                        "analytics",
                        "name",
                        "daily_raw",
                        "columns",
                        List.of(Json.obj("name", "amount")))));
    assertEquals(
        List.of(Json.obj("schema", "analytics", "name", "daily_raw")), result.sourceTables());
    assertThrows(
        ApiException.class,
        () ->
            TransformationData.targetSql(
                "SELECT * FROM private_payroll", adapter, "analytics", "daily_raw"));
    assertThrows(
        ApiException.class,
        () ->
            TransformationData.targetSql(
                "SELECT * FROM __nla_input JOIN private_payroll p ON 1=1",
                adapter,
                "analytics",
                "daily_raw"));
  }

  @Test
  void boundedTypedReaderPreservesBigintDecimalUnicodeBooleanAndRejectsTruncation()
      throws Exception {
    ResultSet result = mock(ResultSet.class);
    ResultSetMetaData metadata = mock(ResultSetMetaData.class);
    when(result.getMetaData()).thenReturn(metadata);
    when(metadata.getColumnCount()).thenReturn(4);
    var names = List.of("id", "amount", "label", "active");
    var types = List.of(Types.BIGINT, Types.DECIMAL, Types.NVARCHAR, Types.BIT);
    for (int index = 1; index <= 4; index++) {
      when(metadata.getColumnLabel(index)).thenReturn(names.get(index - 1));
      when(metadata.getColumnType(index)).thenReturn(types.get(index - 1));
      when(result.getObject(index)).thenReturn("present");
    }
    when(result.next()).thenReturn(true, false);
    when(result.getString(1)).thenReturn("9007199254740993");
    when(result.getBigDecimal(2)).thenReturn(new java.math.BigDecimal("1234.1234567890"));
    when(result.getString(3)).thenReturn("Nhạc O'Brien\nViệt");
    when(result.getBoolean(4)).thenReturn(true);
    var data = TransformationData.read(result, 1, 4096);
    var row = Json.objects(data.get("rows")).getFirst();
    assertEquals("9007199254740993", row.get("id"));
    assertEquals("1234.1234567890", row.get("amount"));
    assertEquals("Nhạc O'Brien\nViệt", row.get("label"));
    assertEquals(true, row.get("active"));
    when(result.next()).thenReturn(true, true, false);
    assertThrows(ApiException.class, () -> TransformationData.read(result, 1, 4096));
  }

  @Test
  void offsetTimestampsNormalizeToUtcWhileLocalTimestampsRetainWallClock() throws Exception {
    ResultSet result = mock(ResultSet.class);
    ResultSetMetaData metadata = mock(ResultSetMetaData.class);
    when(result.getMetaData()).thenReturn(metadata);
    when(metadata.getColumnCount()).thenReturn(2);
    when(metadata.getColumnLabel(1)).thenReturn("offset_time");
    when(metadata.getColumnLabel(2)).thenReturn("local_time");
    when(metadata.getColumnType(1)).thenReturn(Types.TIMESTAMP_WITH_TIMEZONE);
    when(metadata.getColumnType(2)).thenReturn(Types.TIMESTAMP);
    var offset = java.time.OffsetDateTime.parse("2026-10-20T08:00:00+07:00");
    var local = java.sql.Timestamp.valueOf("2026-10-20 08:00:00");
    when(result.getObject(1)).thenReturn(offset);
    when(result.getObject(2)).thenReturn(local);
    when(result.getTimestamp(2)).thenReturn(local);
    when(result.next()).thenReturn(true, false);
    var data = TransformationData.read(result, 1, 4096);
    var row = Json.objects(data.get("rows")).getFirst();
    assertEquals("2026-10-20T01:00", row.get("offset_time"));
    assertEquals("2026-10-20T08:00", row.get("local_time"));
  }
}

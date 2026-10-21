package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.MySqlWarehouseAdapter;
import dev.nla.warehouse.PostgreSqlWarehouseAdapter;
import dev.nla.warehouse.SqlServerWarehouseAdapter;
import dev.nla.warehouse.WarehouseAdapter;
import java.util.List;
import org.junit.jupiter.api.Test;

class DatasetEvaluationTest {
  @Test
  void oraclesComeFromSelectedSchemaAndAreQuotedForEveryEngine() {
    for (WarehouseAdapter adapter :
        List.of(
            new PostgreSqlWarehouseAdapter(false),
            new MySqlWarehouseAdapter(false),
            new SqlServerWarehouseAdapter(false))) {
      var cases =
          DatasetEvaluation.cases(
              List.of(Json.obj("schema", "observatory", "name", "Readings With Spaces")), adapter);
      assertEquals(1, cases.size());
      assertTrue(
          Json.str(cases.getFirst(), "question").contains("observatory.Readings With Spaces"));
      assertFalse(Json.str(cases.getFirst(), "question").toLowerCase().contains("chinook"));
      assertEquals(
          "SELECT COUNT(*) AS record_count FROM "
              + adapter.quoteIdentifier("observatory")
              + "."
              + adapter.quoteIdentifier("Readings With Spaces"),
          cases.getFirst().get("expectedSql"));
      assertEquals("number", cases.getFirst().get("expectedChart"));
    }
  }
}

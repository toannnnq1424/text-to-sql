package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import dev.nla.warehouse.*;
import org.junit.jupiter.api.Test;

class DialectTest {
  @Test
  void allThreeImplementRealBehavior() {
    var pg = new PostgreSqlWarehouseAdapter(false);
    var my = new MySqlWarehouseAdapter(false);
    var ms = new SqlServerWarehouseAdapter(false);
    assertEquals("\"a\"\"b\"", pg.quoteIdentifier("a\"b"));
    assertEquals("`a``b`", my.quoteIdentifier("a`b"));
    assertEquals("[a]]b]", ms.quoteIdentifier("a]b"));
    assertTrue(pg.applySafeLimit("SELECT 1", 2).endsWith("LIMIT 2"));
    assertEquals("SELECT 1", ms.applySafeLimit("SELECT 1", 2));
    assertTrue(ms.getSqlDialect().monthExpression("dt").contains("DATEFROMPARTS"));
  }
}

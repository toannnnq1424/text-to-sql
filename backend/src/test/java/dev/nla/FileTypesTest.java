package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import java.time.*;
import org.junit.jupiter.api.Test;

class FileTypesTest {
  private Object value(Object value, String type, boolean nullable) {
    return FileTypes.convert(value, Json.obj("dataType", type, "nullable", nullable));
  }

  @Test
  void preservesPrecisionAndRejectsLossyMapping() {
    assertEquals(9007199254740993L, value("9007199254740993", "BIGINT", false));
    assertEquals(new BigDecimal("1234.5000000000"), value("1234.5000", "DECIMAL", false));
    assertThrows(ArithmeticException.class, () -> value("1.12345678901", "DECIMAL", false));
    assertThrows(
        IllegalArgumentException.class,
        () -> value("9999999999999999999999999999999", "DECIMAL", false));
    assertThrows(
        IllegalArgumentException.class, () -> value("9223372036854775808", "BIGINT", false));
    assertEquals("001", value("001", "STRING", false));
    assertNull(value("", "DECIMAL", true));
    assertEquals("", value("", "STRING", true));
    assertThrows(IllegalArgumentException.class, () -> value(null, "STRING", false));
  }

  @Test
  void canonicalizesTemporalBooleanAndRejectsUnsafeIdentifiers() {
    assertEquals(LocalDate.of(2026, 10, 20), value("2026-10-20", "DATE", false));
    assertEquals(
        LocalDateTime.of(2026, 10, 20, 1, 0),
        value("2026-10-20T08:00:00+07:00", "TIMESTAMP", false));
    assertThrows(
        IllegalArgumentException.class,
        () -> value("2026-10-20T00:00:00.123456789", "TIMESTAMP", false));
    assertThrows(IllegalArgumentException.class, () -> value("0999-10-20", "DATE", false));
    assertEquals(true, value("true", "BOOLEAN", false));
    assertThrows(IllegalArgumentException.class, () -> value("maybe", "BOOLEAN", true));
    assertThrows(
        ApiException.class, () -> FileIngestionService.identifier("table;DROP TABLE x", 40));
    assertThrows(ApiException.class, () -> FileIngestionService.identifier("../table", 40));
    FileIngestionService.identifier("source_2026", 40);
    assertEquals("BIT", FileTypes.sqlType("BOOLEAN", "SQL_SERVER"));
    assertEquals("NVARCHAR(MAX)", FileTypes.sqlType("STRING", "SQL_SERVER"));
  }
}

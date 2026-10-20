package dev.nla;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class IngestionSourceServiceTest {
  @Test
  void matchesCanonicalOutputTypesToWarehouseTypes() {
    assertTrue(IngestionSourceService.compatible("STRING", "STRING"));
    assertTrue(IngestionSourceService.compatible("STRING", "VARCHAR"));
    assertTrue(IngestionSourceService.compatible("INTEGER", "BIGINT"));
    assertTrue(IngestionSourceService.compatible("DECIMAL", "INTEGER"));
    assertTrue(IngestionSourceService.compatible("DECIMAL", "NUMERIC"));
    assertTrue(IngestionSourceService.compatible("BOOLEAN", "BIT"));
    assertTrue(IngestionSourceService.compatible("DATE", "DATE"));
    assertTrue(IngestionSourceService.compatible("TIMESTAMP", "DATETIME"));
    assertFalse(IngestionSourceService.compatible("DATE", "TIMESTAMP"));
    assertFalse(IngestionSourceService.compatible("BOOLEAN", "STRING"));
  }
}

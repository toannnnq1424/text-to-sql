package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class PipelineConfigurationTest {
  @Test
  void acceptsOnlyUniqueSafeOutputIdentifiers() {
    assertEquals(
        List.of("country", "total"),
        PipelineService.configuredColumns(Json.obj("columns", List.of("country", "total"))));

    assertThrows(
        ApiException.class,
        () ->
            PipelineService.configuredColumns(
                Json.obj("columns", List.of("country", "total); DROP TABLE invoice;--"))));
    assertThrows(
        ApiException.class,
        () ->
            PipelineService.configuredColumns(Json.obj("columns", List.of("Country", "country"))));
  }

  @Test
  void validatesConfiguredRequiredFieldsAndStringBounds() {
    var config =
        Json.obj(
            "columns",
            List.of("country", "total"),
            "requiredColumns",
            List.of("country", "total"),
            "maxStringLengths",
            Json.obj("country", 100));

    assertFalse(
        PipelineService.invalidRow(
            Json.obj("country", "VN", "total", "1.20"), config, List.of("country", "total")));
    assertTrue(
        PipelineService.invalidRow(
            Json.obj("country", null, "total", "1.20"), config, List.of("country", "total")));
    assertTrue(
        PipelineService.invalidRow(
            Json.obj("country", "x".repeat(101), "total", "1.20"),
            config,
            List.of("country", "total")));
    assertThrows(
        ApiException.class,
        () ->
            PipelineService.invalidRow(
                Json.obj("country", "VN", "total", "1.20"),
                Json.obj(
                    "columns", List.of("country", "total"), "requiredColumns", List.of("unknown")),
                List.of("country", "total")));
  }

  @Test
  void mapsAllDeclaredOutputColumnsToDetectedSourceTypes() {
    var columns =
        List.of(
            Json.obj("name", "region", "dataType", "STRING"),
            Json.obj("name", "revenue", "dataType", "DECIMAL"));
    assertEquals(
        Map.of("region", "STRING", "revenue", "DECIMAL"),
        PipelineService.columnTypes(columns, List.of("region", "revenue")));
    assertThrows(
        ApiException.class,
        () -> PipelineService.columnTypes(columns, List.of("region", "revenue", "orders")));
  }

  @Test
  void enforcesFinitePipelineResourceBounds() {
    assertEquals(1000, PipelineService.configuredBound(Json.obj(), "maxRows", 1000, 1, 10000));
    assertEquals(
        5000,
        PipelineService.configuredBound(Json.obj("maxRows", 5000), "maxRows", 1000, 1, 10000));
    assertThrows(
        ApiException.class,
        () ->
            PipelineService.configuredBound(
                Json.obj("maxRows", 100000), "maxRows", 1000, 1, 10000));
    assertThrows(
        ApiException.class,
        () ->
            PipelineService.configuredBound(
                Json.obj("timeoutSeconds", 1.5), "timeoutSeconds", 15, 1, 60));
  }
}

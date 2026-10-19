package dev.nla;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class CatalogCategoriesTest {
  @Test
  void countsOnlyCategoriesFromTheSelectedResourceCollection() {
    var tables =
        CatalogService.categories(
            List.of(
                Json.obj("category", "dbo"),
                Json.obj("category", "dbo"),
                Json.obj("category", "dbo")));
    var metrics =
        CatalogService.categories(
            List.of(
                Json.obj("category", "Sales"),
                Json.obj("category", "Sales"),
                Json.obj("category", "Music")));
    assertEquals(List.of(Json.obj("name", "dbo", "count", 3L)), tables);
    assertEquals(
        List.of(Json.obj("name", "Music", "count", 1L), Json.obj("name", "Sales", "count", 2L)),
        metrics);
  }
}

package dev.nla;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class PageSearchTest {
  @Test
  void findsQualifiedPhysicalNamesWithoutLosingExistingMetadataSearch() {
    var rows =
        List.of(
            Json.obj("schema", "Sales", "name", "Orders", "description", "Đơn hàng"),
            Json.obj("schema", "Archive", "name", "Orders", "description", "Lưu trữ"));
    var qualified = Page.of(rows, Map.of("search", "sales.orders"), "name", Set.of("name"));
    assertEquals(1, qualified.get("totalItems"));
    assertEquals("Sales", Json.objects(qualified.get("items")).getFirst().get("schema"));
    assertEquals(
        2, Page.of(rows, Map.of("search", "Orders"), "name", Set.of("name")).get("totalItems"));
    assertEquals(
        1, Page.of(rows, Map.of("search", "Đơn hàng"), "name", Set.of("name")).get("totalItems"));
  }
}

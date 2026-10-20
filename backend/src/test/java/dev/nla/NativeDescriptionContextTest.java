package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.WarehouseAdapter;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.Test;

class NativeDescriptionContextTest {
  @Test
  void discoveredDescriptionsReachAuthorizedPythonContextWithoutNewFields() throws Exception {
    Store store = mock(Store.class);
    Adapters adapters = mock(Adapters.class);
    WarehouseAdapter adapter = mock(WarehouseAdapter.class);
    Connection connection = mock(Connection.class);
    var warehouse = Json.obj("warehouseId", "wh", "status", "ACTIVE", "defaultSchema", "dbo");
    var table =
        Json.obj(
            "schema",
            "dbo",
            "name",
            "orders",
            "description",
            "Net revenue after discounts",
            "columns",
            List.of(Json.obj("name", "net", "description", "Excludes tax")));
    when(store.warehouse("wh")).thenReturn(warehouse);
    when(store.dataset("ds"))
        .thenReturn(Json.obj("warehouseId", "wh", "allowedTables", List.of(table)));
    when(store.semantic("ds"))
        .thenReturn(Json.obj("tables", List.of(), "metrics", List.of(), "dimensions", List.of()));
    when(adapters.get(warehouse)).thenReturn(adapter);
    when(adapter.connect(any(), any())).thenReturn(connection);
    when(adapter.discoverTables(eq(connection), any())).thenReturn(List.of(table));
    var context = new CatalogService(store, adapters).context("ds");
    var physical = Json.objects(context.get("tables")).getFirst();
    assertEquals("Net revenue after discounts", physical.get("description"));
    assertEquals(
        "Excludes tax", Json.objects(physical.get("columns")).getFirst().get("description"));
    assertFalse(Json.write(context).contains("credential"));
  }

  @Test
  void metadataPermissionFailureUsesExistingSafePublicError() throws Exception {
    Store store = mock(Store.class);
    Adapters adapters = mock(Adapters.class);
    WarehouseAdapter adapter = mock(WarehouseAdapter.class);
    Connection connection = mock(Connection.class);
    var warehouse = Json.obj("warehouseId", "wh", "status", "ACTIVE", "defaultSchema", "dbo");
    when(store.warehouse("wh")).thenReturn(warehouse);
    when(adapters.get(warehouse)).thenReturn(adapter);
    when(adapter.connect(any(), any())).thenReturn(connection);
    when(adapter.discoverTables(eq(connection), any()))
        .thenThrow(new SQLException("secret vendor details", "42501", 229));
    ApiException error =
        assertThrows(
            ApiException.class, () -> new CatalogService(store, adapters).discover("wh", true));
    assertEquals("WAREHOUSE_CONNECTION_ERROR", error.code);
    assertFalse(error.getMessage().contains("secret"));
  }
}

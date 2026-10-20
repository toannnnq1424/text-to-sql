package dev.nla.warehouse;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.*;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class NativeMetadataDescriptionsTest {
  private ResultSet rows(List<Map<String, String>> values) throws SQLException {
    ResultSet result = mock(ResultSet.class);
    int[] cursor = {-1};
    when(result.next()).thenAnswer(ignored -> ++cursor[0] < values.size());
    when(result.getString(anyString()))
        .thenAnswer(invocation -> values.get(cursor[0]).get(invocation.getArgument(0)));
    return result;
  }

  @ParameterizedTest
  @ValueSource(strings = {"POSTGRESQL", "MYSQL", "SQL_SERVER"})
  void schemaIsBoundAndDescriptionsPreserveUnicode(String engine) throws Exception {
    Connection connection = mock(Connection.class);
    PreparedStatement statement = mock(PreparedStatement.class);
    when(connection.prepareStatement(anyString())).thenReturn(statement);
    when(statement.executeQuery())
        .thenAnswer(
            ignored ->
                rows(
                    List.of(
                        Map.of("table_name", "Orders", "description", "Doanh thu — Việt Nam"),
                        Map.of(
                            "table_name",
                            "Orders",
                            "column_name",
                            "net",
                            "description",
                            "Sau giảm giá"))));
    String schema = "quoted' schema; DROP TABLE outside";
    var descriptions = NativeMetadataDescriptions.load(connection, engine, schema);
    assertEquals("Doanh thu — Việt Nam", descriptions.table("Orders", "JDBC fallback"));
    assertEquals("Sau giảm giá", descriptions.column("Orders", "net", ""));
    assertEquals("fallback", descriptions.table("orders", "fallback"));
    assertEquals("", descriptions.column("Orders", "missing", null));
    verify(statement).setString(1, schema);
    verify(statement).setQueryTimeout(5);
    verify(statement).setMaxRows(NativeMetadataDescriptions.MAX_ROWS + 1);
    verify(statement).setFetchSize(128);
    verify(connection).prepareStatement(argThat(query -> !query.contains(schema)));
    verify(statement).close();
  }

  @Test
  void permissionFailurePropagatesWithoutInventingDescriptions() throws Exception {
    Connection connection = mock(Connection.class);
    PreparedStatement statement = mock(PreparedStatement.class);
    when(connection.prepareStatement(anyString())).thenReturn(statement);
    SQLException denied = new SQLException("sensitive vendor details", "42501", 229);
    when(statement.executeQuery()).thenThrow(denied);
    assertSame(
        denied,
        assertThrows(
            SQLException.class,
            () -> NativeMetadataDescriptions.load(connection, "SQL_SERVER", "dbo")));
    verify(statement).close();
  }

  @Test
  void emptyCommentsKeepBoundedJdbcFallbackWithoutSurrogateDamage() throws Exception {
    Connection connection = mock(Connection.class);
    PreparedStatement statement = mock(PreparedStatement.class);
    when(connection.prepareStatement(anyString())).thenReturn(statement);
    when(statement.executeQuery()).thenAnswer(ignored -> rows(List.of()));
    var descriptions = NativeMetadataDescriptions.load(connection, "POSTGRESQL", "missing");
    String fallback = "🎵".repeat(5000);
    assertEquals("🎵".repeat(4000), descriptions.table("track", fallback));
    assertEquals("", descriptions.table("track", null));
  }

  @Test
  void excessiveCommentRowsFailWithControlledResourceState() throws Exception {
    Connection connection = mock(Connection.class);
    PreparedStatement statement = mock(PreparedStatement.class);
    ResultSet result = mock(ResultSet.class);
    when(connection.prepareStatement(anyString())).thenReturn(statement);
    when(statement.executeQuery()).thenReturn(result);
    when(result.next()).thenReturn(true);
    when(result.getString("table_name")).thenReturn("table");
    when(result.getString("description")).thenReturn("a");
    assertEquals(
        "54000",
        assertThrows(
                SQLException.class,
                () -> NativeMetadataDescriptions.load(connection, "MYSQL", "warehouse"))
            .getSQLState());
    verify(result).close();
  }

  @Test
  void discoveryLoadsOneBulkQueryPerSchemaRatherThanPerTable() throws Exception {
    Connection connection = mock(Connection.class);
    DatabaseMetaData metadata = mock(DatabaseMetaData.class);
    PreparedStatement statement = mock(PreparedStatement.class);
    when(connection.getMetaData()).thenReturn(metadata);
    when(connection.prepareStatement(anyString())).thenReturn(statement);
    when(statement.executeQuery())
        .thenAnswer(
            ignored -> rows(List.of(Map.of("table_name", "a", "description", "Native table"))));
    when(metadata.getSchemas())
        .thenAnswer(ignored -> rows(List.of(Map.of("TABLE_SCHEM", "public"))));
    when(metadata.getTables(any(), eq("public"), eq("%"), any()))
        .thenAnswer(ignored -> rows(List.of(Map.of("TABLE_NAME", "a"), Map.of("TABLE_NAME", "b"))));
    when(metadata.getPrimaryKeys(any(), any(), any())).thenAnswer(ignored -> rows(List.of()));
    when(metadata.getImportedKeys(any(), any(), any())).thenAnswer(ignored -> rows(List.of()));
    when(metadata.getColumns(any(), any(), any(), any())).thenAnswer(ignored -> rows(List.of()));
    var tables = new PostgreSqlWarehouseAdapter(false).discoverTables(connection, Set.of("public"));
    assertEquals(2, tables.size());
    assertEquals("Native table", tables.getFirst().get("description"));
    assertEquals("", tables.getLast().get("description"));
    verify(connection, times(1)).prepareStatement(anyString());
    verify(statement).setString(1, "public");
  }
}

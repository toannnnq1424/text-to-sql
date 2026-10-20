package dev.nla;

import dev.nla.warehouse.*;
import java.io.*;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/** Bounded canonical-file batches and typed layer transfers, never file SQL. */
final class FileIngestionExecutor {
  private FileIngestionExecutor() {}

  static void execute(
      Adapters adapters,
      Map<String, Object> warehouse,
      String username,
      String credential,
      Map<String, Object> plan,
      Path spool,
      Map<String, Object> run,
      Consumer<Map<String, Object>> progress)
      throws Exception {
    var writer = new LinkedHashMap<>(warehouse);
    writer.put("username", username);
    String engine = Json.str(warehouse, "engine");
    if (engine.equals("MYSQL")) writer.put("database", plan.get("targetSchema"));
    var adapter = adapters.get(writer);
    var columns = Json.objects(plan.get("columns"));
    var stages = Json.objects(run.get("stages"));
    var layers = Json.objects(plan.get("layers"));
    var created = Json.objects(run.get("createdTables"));
    // An independently mutable list is required while persisting progress.
    created = new ArrayList<>(created);
    run.put("createdTables", created);
    boolean mysqlDdl = false;
    long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MINUTES.toNanos(5);
    try (var connection = adapter.connectForWrite(writer, adapters.password(credential))) {
      connection.setAutoCommit(false);
      try {
        for (int layerIndex = 0; layerIndex < layers.size(); layerIndex++) {
          check(deadline);
          var layer = layers.get(layerIndex);
          var stage = stages.get(layerIndex);
          stage.put("status", "RUNNING");
          progress.accept(run);
          String definitions =
              columns.stream()
                  .map(
                      column ->
                          adapter.quoteIdentifier(Json.str(column, "name"))
                              + " "
                              + FileTypes.sqlType(
                                  layerIndexIsRaw(layer) ? "STRING" : Json.str(column, "dataType"),
                                  engine)
                              + (Boolean.FALSE.equals(column.get("nullable")) ? " NOT NULL" : ""))
                  .collect(Collectors.joining(","));
          try (var statement = connection.createStatement()) {
            timeout(statement, adapter, deadline);
            statement.executeUpdate(
                "CREATE TABLE " + qualified(adapter, layer) + " (" + definitions + ")");
          }
          created.add(Json.obj("schema", layer.get("schema"), "table", layer.get("table")));
          if (engine.equals("MYSQL")) mysqlDdl = true;
          if (layerIndex <= 1)
            load(
                connection,
                adapter,
                layer,
                columns,
                spool,
                layerIndex == 0,
                stage,
                run,
                progress,
                deadline);
          else {
            String names =
                columns.stream()
                    .map(c -> adapter.quoteIdentifier(Json.str(c, "name")))
                    .collect(Collectors.joining(","));
            try (var statement = connection.createStatement()) {
              timeout(statement, adapter, deadline);
              statement.executeUpdate(
                  "INSERT INTO "
                      + qualified(adapter, layer)
                      + " ("
                      + names
                      + ") SELECT "
                      + names
                      + " FROM "
                      + qualified(adapter, layers.get(layerIndex - 1)));
            }
            stage.put("rowsLoaded", plan.get("rowCount"));
          }
          stage.put("status", "SUCCESS");
          progress.accept(run);
          // Commit each complete MySQL layer before the next implicit DDL commit;
          // persisted layer counts then describe durable rows on partial failure.
          if (engine.equals("MYSQL")) connection.commit();
        }
        connection.commit();
        run.put("rowsLoaded", plan.get("rowCount"));
      } catch (Exception failure) {
        boolean rollbackFailed = false;
        try {
          connection.rollback();
        } catch (SQLException rollback) {
          rollbackFailed = true;
        }
        run.put("partialFailure", mysqlDdl || rollbackFailed);
        for (var stage : stages) {
          if ("RUNNING".equals(stage.get("status"))) {
            stage.put("status", Thread.currentThread().isInterrupted() ? "CANCELLED" : "FAILED");
            stage.put("rowsLoaded", 0);
          } else if ("PENDING".equals(stage.get("status"))) stage.put("status", "SKIPPED");
          else if (!mysqlDdl && !rollbackFailed) {
            stage.put("status", "SKIPPED");
            stage.put("rowsLoaded", 0);
          }
        }
        if (!mysqlDdl && !rollbackFailed) created.clear();
        throw failure;
      }
    }
  }

  private static boolean layerIndexIsRaw(Map<String, Object> layer) {
    return "RAW".equals(layer.get("name"));
  }

  static String qualified(WarehouseAdapter adapter, Map<String, Object> layer) {
    return adapter.quoteIdentifier(Json.str(layer, "schema"))
        + "."
        + adapter.quoteIdentifier(Json.str(layer, "table"));
  }

  private static void check(long deadline) throws SQLException {
    if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline)
      throw new SQLTimeoutException("File job cancelled or timed out");
  }

  private static void timeout(Statement statement, WarehouseAdapter adapter, long deadline)
      throws SQLException {
    check(deadline);
    adapter.configureTimeout(
        statement,
        (int)
            Math.min(
                20,
                Math.max(
                    1,
                    java.util.concurrent.TimeUnit.NANOSECONDS.toSeconds(
                        deadline - System.nanoTime()))));
  }

  private static void load(
      Connection connection,
      WarehouseAdapter adapter,
      Map<String, Object> layer,
      List<Map<String, Object>> columns,
      Path spool,
      boolean raw,
      Map<String, Object> stage,
      Map<String, Object> run,
      Consumer<Map<String, Object>> progress,
      long deadline)
      throws Exception {
    String names =
        columns.stream()
            .map(c -> adapter.quoteIdentifier(Json.str(c, "name")))
            .collect(Collectors.joining(","));
    String placeholders = String.join(",", Collections.nCopies(columns.size(), "?"));
    String sql =
        "INSERT INTO "
            + qualified(adapter, layer)
            + " ("
            + names
            + ") VALUES ("
            + placeholders
            + ")";
    try (var statement = connection.prepareStatement(sql);
        var rows = Files.newBufferedReader(spool)) {
      String line;
      int count = 0;
      while ((line = rows.readLine()) != null) {
        check(deadline);
        var values = (List<?>) Json.read(line).get("row");
        for (int i = 0; i < columns.size(); i++) {
          Object value = values.get(i);
          FileTypes.bind(
              statement,
              i + 1,
              raw
                  ? value == null ? null : value.toString()
                  : FileTypes.convert(value, columns.get(i)));
        }
        statement.addBatch();
        if (++count % 500 == 0) {
          timeout(statement, adapter, deadline);
          statement.executeBatch();
          statement.clearBatch();
          stage.put("rowsLoaded", count);
          progress.accept(run);
        }
      }
      timeout(statement, adapter, deadline);
      statement.executeBatch();
      stage.put("rowsLoaded", count);
    }
  }
}

package dev.nla;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Calls the private Wren-backed planner with only the authorized physical catalog snapshot. */
@Component
public class SemanticPlannerClient {
  private static final Map<String, String> DATA_SOURCES =
      Map.of("POSTGRESQL", "postgres", "MYSQL", "mysql", "SQL_SERVER", "mssql");

  private final Environment env;
  private final HttpClient http =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();

  public record PlanResult(
      String sql, List<String> sourceModels, List<Map<String, Object>> sourceTables) {}

  public SemanticPlannerClient(Environment environment) {
    env = environment;
  }

  public PlanResult plan(
      String correlationId, String dialect, String sql, Map<String, Object> semanticContext) {
    String base = env.getProperty("nla.python-url", "");
    String token = env.getProperty("nla.python-token", "");
    if (base.isBlank() || token.length() < 32) {
      throw unavailable("Python semantic planner chưa được cấu hình.");
    }
    if (!DATA_SOURCES.containsKey(dialect)) {
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY, "SQL_DIALECT_ERROR", "Dialect không được hỗ trợ.");
    }

    Map<String, Object> manifest = manifest(dialect, semanticContext);
    Map<String, Object> request =
        Json.obj(
            "correlationId", correlationId,
            "sqlDialect", dialect,
            "sql", sql,
            "manifest", manifest);
    try {
      URI uri = URI.create(base + "/internal/v1/semantic-plan");
      if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getUserInfo() != null) {
        throw new IllegalArgumentException();
      }
      var response =
          http.send(
              HttpRequest.newBuilder(uri)
                  .timeout(Duration.ofSeconds(QueryDeadline.seconds(10)))
                  .header("Content-Type", "application/json")
                  .header("Authorization", "Bearer " + token)
                  .header("X-Correlation-ID", correlationId)
                  .POST(HttpRequest.BodyPublishers.ofString(Json.write(request)))
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      if (response.body().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 1048576) {
        throw invalidResponse();
      }
      Map<String, Object> body = Json.read(response.body());
      if (response.statusCode() != 200) {
        Map<String, Object> error = Json.map(body.get("error"));
        String code = Json.str(error, "code");
        if (Set.of(
                "INSUFFICIENT_CONTEXT",
                "SEMANTIC_MODEL_INVALID",
                "SQL_DIALECT_ERROR",
                "SQL_VALIDATION_ERROR")
            .contains(code)) {
          throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              code,
              "Semantic planner không thể lập kế hoạch an toàn cho SQL candidate.");
        }
        if (response.statusCode() == 401 || response.statusCode() == 403) {
          throw unavailable("Không xác thực được semantic planner.");
        }
        throw unavailable("Semantic planner không xử lý được SQL candidate.");
      }
      if (!body.keySet().equals(Set.of("sql", "sourceModels", "sourceTables", "plannerVersion"))
          || !"wren-core-py/0.4.0".equals(Json.str(body, "plannerVersion"))
          || Json.str(body, "sql").isBlank()
          || !(body.get("sourceModels") instanceof List<?> models)
          || models.stream().anyMatch(value -> !(value instanceof String))
          || !(body.get("sourceTables") instanceof List<?> tables)) {
        throw invalidResponse();
      }
      List<Map<String, Object>> sourceTables = new ArrayList<>();
      for (Object value : tables) {
        if (!(value instanceof Map<?, ?> table)
            || !table.keySet().equals(Set.of("schema", "name"))
            || !(table.get("schema") instanceof String)
            || !(table.get("name") instanceof String)) {
          throw invalidResponse();
        }
        sourceTables.add(Json.map(value));
      }
      return new PlanResult(
          Json.str(body, "sql"), models.stream().map(Object::toString).toList(), sourceTables);
    } catch (ApiException exception) {
      throw exception;
    } catch (java.net.http.HttpTimeoutException exception) {
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Semantic planner hết thời gian xử lý.");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Yêu cầu truy vấn đã dừng.");
    } catch (Exception exception) {
      throw unavailable("Không kết nối được semantic planner.");
    }
  }

  static Map<String, Object> manifest(String dialect, Map<String, Object> context) {
    List<Map<String, Object>> tables = Json.objects(context.get("tables"));
    if (tables.isEmpty()) {
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "INSUFFICIENT_CONTEXT",
          "Dataset chưa có bảng vật lý được phép truy vấn.");
    }
    Map<String, String> modelByTable = new LinkedHashMap<>();
    List<Map<String, Object>> models = new ArrayList<>();
    for (int i = 0; i < tables.size(); i++) {
      Map<String, Object> table = tables.get(i);
      String key = tableKey(table);
      if (modelByTable.putIfAbsent(key, "nla_model_" + i) != null) {
        throw invalidManifest();
      }
      List<Map<String, Object>> columns = new ArrayList<>();
      for (Map<String, Object> column : Json.objects(table.get("columns"))) {
        columns.add(
            Json.obj(
                "name", Json.str(column, "name"),
                "type", plannerType(Json.str(column, "dataType"))));
      }
      List<String> primaryKeys =
          table.get("primaryKey") instanceof List<?> keys
              ? keys.stream().filter(String.class::isInstance).map(String.class::cast).toList()
              : List.of();
      Map<String, Object> tableReference =
          Json.obj("schema", Json.str(table, "schema"), "table", Json.str(table, "name"));
      Map<String, Object> model =
          Json.obj(
              "name", "nla_model_" + i,
              "tableReference", tableReference,
              "columns", columns);
      if (!primaryKeys.isEmpty()) model.put("primaryKey", primaryKeys.get(0));
      models.add(model);
    }

    List<Map<String, Object>> relationships = new ArrayList<>();
    for (Map<String, Object> relation : Json.objects(context.get("relationships"))) {
      Map<String, Object> from = Json.map(relation.get("from"));
      Map<String, Object> to = Json.map(relation.get("to"));
      Map<String, Object> fromTable = Json.map(from.get("table"));
      Map<String, Object> toTable = Json.map(to.get("table"));
      String fromModel = modelByTable.get(tableKey(fromTable));
      String toModel = modelByTable.get(tableKey(toTable));
      if (fromModel == null || toModel == null) continue;
      String fromColumn = Json.str(from, "column");
      String toColumn = Json.str(to, "column");
      if (!hasColumn(tables, fromTable, fromColumn) || !hasColumn(tables, toTable, toColumn)) {
        throw invalidManifest();
      }
      String joinType = Json.str(relation, "cardinality");
      if (!Set.of("ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY").contains(joinType))
        joinType = "MANY_TO_ONE";
      relationships.add(
          Json.obj(
              "name",
              "nla_relationship_" + relationships.size(),
              "models",
              List.of(fromModel, toModel),
              "joinType",
              joinType,
              "condition",
              fromModel
                  + ".\""
                  + fromColumn.replace("\"", "\"\"")
                  + "\" = "
                  + toModel
                  + ".\""
                  + toColumn.replace("\"", "\"\"")
                  + "\""));
    }
    return Json.obj(
        "catalog",
        "nla",
        "schema",
        "semantic",
        "dataSource",
        DATA_SOURCES.get(dialect),
        "models",
        models,
        "relationships",
        relationships);
  }

  private static String plannerType(String physicalType) {
    return switch (physicalType.toUpperCase(Locale.ROOT)) {
      case "INTEGER" -> "integer";
      case "BIGINT" -> "bigint";
      case "DECIMAL" -> "decimal";
      case "FLOAT" -> "float";
      case "BOOLEAN" -> "boolean";
      case "DATE" -> "date";
      case "TIME" -> "time";
      case "TIMESTAMP" -> "timestamp";
      case "BINARY" -> "binary";
      default -> "varchar";
    };
  }

  private static boolean hasColumn(
      List<Map<String, Object>> tables, Map<String, Object> reference, String columnName) {
    return tables.stream()
        .filter(table -> tableKey(table).equals(tableKey(reference)))
        .flatMap(table -> Json.objects(table.get("columns")).stream())
        .anyMatch(column -> Json.str(column, "name").equals(columnName));
  }

  private static String tableKey(Map<String, Object> table) {
    return Json.str(table, "schema") + "\u0000" + Json.str(table, "name");
  }

  static String sourceKey(Map<String, Object> table) {
    return Json.str(table, "schema") + "\u0000" + Json.str(table, "name");
  }

  private static ApiException invalidManifest() {
    return new ApiException(
        HttpStatus.CONFLICT, "SEMANTIC_MODEL_INVALID", "Metadata vật lý không hợp lệ.");
  }

  private static ApiException invalidResponse() {
    return new ApiException(
        HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Semantic planner trả về phản hồi không hợp lệ.");
  }

  private static ApiException unavailable(String message) {
    return new ApiException(HttpStatus.BAD_GATEWAY, "LLM_ERROR", message);
  }
}

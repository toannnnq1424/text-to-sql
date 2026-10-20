package dev.nla;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/datasets/{datasetId}")
public class SemanticController {
  private final Store store;
  private final CatalogService catalog;
  private final QueryService queries;
  private final SqlGuard guard;
  private final AiClient ai;

  public SemanticController(
      Store store, CatalogService catalog, QueryService queries, SqlGuard guard, AiClient ai) {
    this.store = store;
    this.catalog = catalog;
    this.queries = queries;
    this.guard = guard;
    this.ai = ai;
  }

  static Map<String, Object> envelope(String id, Store store, CatalogService catalog) {
    var dataset = store.dataset(id);
    var warehouse = store.warehouse(Json.str(dataset, "warehouseId"));
    return Json.obj(
        "correlationId",
        Errors.correlation(),
        "warehouseId",
        warehouse.get("warehouseId"),
        "datasetId",
        id,
        "sqlDialect",
        warehouse.get("engine"),
        "semanticContext",
        catalog.context(id));
  }

  static Map<String, Object> validateDocument(
      String id,
      Map<String, Object> document,
      Store store,
      CatalogService catalog,
      AiClient ai,
      SqlGuard guard) {
    RegistryController.fields(
        document,
        Set.of(
            "tables",
            "metrics",
            "dimensions",
            "relationships",
            "examples",
            "businessRules",
            "semanticVersion",
            "schemaVersion",
            "timezone",
            "referenceTime"));
    RegistryController.required(document, "semanticVersion", "schemaVersion", "timezone");
    try {
      java.time.ZoneId.of(Json.str(document, "timezone"));
    } catch (Exception exception) {
      throw ApiException.bad("Timezone không hợp lệ.");
    }
    if (Json.write(document).length() > 1000000)
      throw ApiException.bad("Cấu hình ngữ nghĩa vượt giới hạn.");
    var activeDataset = store.dataset(id);
    if (!Json.str(activeDataset, "schemaVersion").equals(document.get("schemaVersion")))
      throw new ApiException(
          HttpStatus.CONFLICT, "SCHEMA_MISMATCH", "Schema version phải khớp dataset hiện tại.");
    var context = new LinkedHashMap<>(document);
    context.put("tables", catalog.tables(id));
    // Relationships in the active document may extend discovered foreign keys,
    // but each endpoint must belong to the authorized physical dataset.
    catalog.validateSemantic(context, catalog.tables(id));
    catalog.validateJoinCardinality(id, context);
    context.put("referenceTime", java.time.Instant.now().toString());
    var dataset = store.dataset(id);
    var warehouse = store.warehouse(Json.str(dataset, "warehouseId"));
    for (var example : Json.objects(context.get("examples"))) {
      if (!Json.str(example, "sqlDialect").equals(Json.str(warehouse, "engine"))) continue;
      guard.validate(Json.str(example, "sql"), Json.str(warehouse, "engine"), catalog.tables(id));
    }
    var request =
        Json.obj(
            "correlationId",
            Errors.correlation(),
            "warehouseId",
            warehouse.get("warehouseId"),
            "datasetId",
            id,
            "sqlDialect",
            warehouse.get("engine"),
            "semanticContext",
            context);
    var result = ai.invoke("business-validate", request, 20);
    if (!Boolean.TRUE.equals(result.get("valid"))
        || !Json.str(context, "semanticVersion").equals(result.get("semanticVersion")))
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          "SEMANTIC_MODEL_INVALID",
          "Compiler validation không đúng contract.");
    return result;
  }

  @PostMapping("/semantic-model/validate")
  @PreAuthorize("hasRole('ADMIN')")
  Object validateModel(@PathVariable String datasetId, @RequestBody Map<String, Object> document) {
    return validateDocument(datasetId, document, store, catalog, ai, guard);
  }

  @PostMapping("/semantic-query")
  @PreAuthorize("hasAnyRole('ADMIN','ANALYST')")
  Object semanticQuery(@PathVariable String datasetId, @RequestBody Map<String, Object> selection) {
    RegistryController.fields(selection, Set.of("metrics", "dimensions", "filters", "limit"));
    return queries.runSemantic(datasetId, selection);
  }

  @GetMapping("/knowledge")
  Object knowledge(@PathVariable String datasetId) {
    return ai.invoke("knowledge/status", envelope(datasetId, store, catalog), 15);
  }

  @DeleteMapping("/knowledge")
  @PreAuthorize("hasRole('ADMIN')")
  Object reset(@PathVariable String datasetId) {
    var result = ai.invoke("knowledge/reset", envelope(datasetId, store, catalog), 30);
    store.audit("KNOWLEDGE_RESET", datasetId);
    return result;
  }

  @PostMapping("/knowledge/index")
  @PreAuthorize("hasRole('ADMIN')")
  Object index(@PathVariable String datasetId) {
    var result = ai.invoke("knowledge/index", envelope(datasetId, store, catalog), 120);
    store.audit("KNOWLEDGE_REBUILD", datasetId);
    return result;
  }

  @PostMapping("/knowledge/search")
  Object search(@PathVariable String datasetId, @RequestBody Map<String, Object> body) {
    RegistryController.fields(body, Set.of("question", "limit"));
    RegistryController.required(body, "question");
    var request = envelope(datasetId, store, catalog);
    request.putAll(body);
    return ai.invoke("knowledge/search", request, 30);
  }

  @GetMapping("/knowledge/examples")
  Object examples(@PathVariable String datasetId) {
    return ai.invoke("knowledge/examples", envelope(datasetId, store, catalog), 30);
  }

  @PostMapping("/knowledge/examples")
  @PreAuthorize("hasRole('ADMIN')")
  Object remember(@PathVariable String datasetId, @RequestBody Map<String, Object> body) {
    RegistryController.fields(body, Set.of("queryId"));
    var query = queries.stored(Json.str(body, "queryId"));
    if (!datasetId.equals(query.get("datasetId")) || !"SUCCESS".equals(query.get("status")))
      throw ApiException.bad("Chỉ ghi nhớ truy vấn thành công của dataset hiện tại.");
    var request = envelope(datasetId, store, catalog);
    guard.validate(
        Json.str(query, "generatedSql"), Json.str(query, "engine"), catalog.tables(datasetId));
    request.put(
        "example", Json.obj("question", query.get("question"), "sql", query.get("generatedSql")));
    var result = ai.invoke("knowledge/remember", request, 30);
    store.audit("KNOWLEDGE_APPROVE_QUERY", datasetId, Json.obj("queryId", body.get("queryId")));
    return result;
  }

  @DeleteMapping("/knowledge/examples/{entryId}")
  @PreAuthorize("hasRole('ADMIN')")
  Object forget(@PathVariable String datasetId, @PathVariable String entryId) {
    var request = envelope(datasetId, store, catalog);
    request.put("entryId", entryId);
    var result = ai.invoke("knowledge/forget", request, 30);
    store.audit("KNOWLEDGE_FORGET_QUERY", datasetId);
    return result;
  }
}

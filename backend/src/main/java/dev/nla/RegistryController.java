package dev.nla;

import dev.nla.warehouse.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class RegistryController {
  private final Store store;
  private final Adapters adapters;
  private final CatalogService catalog;

  public RegistryController(Store store, Adapters adapters, CatalogService catalog) {
    this.store = store;
    this.adapters = adapters;
    this.catalog = catalog;
  }

  static void fields(Map<String, Object> body, Set<String> allowed) {
    if (!allowed.containsAll(body.keySet()))
      throw ApiException.bad("Yêu cầu chứa trường không được hỗ trợ.");
  }

  static void required(Map<String, Object> body, String... fields) {
    for (String f : fields)
      if (Json.str(body, f).isBlank() || Json.str(body, f).length() > 2000)
        throw ApiException.bad("Thiếu hoặc sai trường " + f);
  }

  Map<String, Object> safe(Map<String, Object> w) {
    var out = new LinkedHashMap<>(w);
    if (!store.admin()) {
      for (String k :
          List.of(
              "host",
              "port",
              "database",
              "defaultSchema",
              "username",
              "ingestionUsername",
              "importUsername")) out.remove(k);
    } else {
      String id = Json.str(w, "warehouseId");
      out.put("importUsername", store.importUsername(id));
      out.put("ingestionUsername", store.ingestionUsername(id));
    }
    out.remove("importCredentialReference");
    out.remove("ingestionCredentialReference");
    return out;
  }

  @GetMapping("/warehouses")
  Object warehouses(@RequestParam Map<String, String> p) {
    return Page.of(
        store.warehouses().stream().map(this::safe).toList(),
        p,
        "name",
        Set.of("name", "engine", "status", "createdAt", "updatedAt"));
  }

  @GetMapping("/warehouses/{id}")
  Object warehouse(@PathVariable String id) {
    return safe(store.warehouse(id));
  }

  @GetMapping("/warehouses/{id}/access")
  @PreAuthorize("hasRole('ADMIN')")
  Object warehouseAccess(@PathVariable String id) {
    store.warehouse(id);
    return store.warehouseAccess(id);
  }

  @PostMapping("/warehouses/{id}/access")
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> grantWarehouseAccess(
      @PathVariable String id, @RequestBody Map<String, Object> request) {
    fields(request, Set.of("subject"));
    required(request, "subject");
    String subject = Json.str(request, "subject");
    if (subject.length() > 255 || subject.chars().anyMatch(Character::isISOControl))
      throw ApiException.bad("OIDC subject không hợp lệ.");
    store.warehouse(id);
    store.grantWarehouseAccess(id, subject);
    store.audit("WAREHOUSE_ACCESS_GRANT", id, Json.obj("subject", subject));
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(Json.obj("subject", subject, "warehouseId", id));
  }

  @DeleteMapping("/warehouses/{id}/access")
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> revokeWarehouseAccess(@PathVariable String id, @RequestParam String subject) {
    if (subject.isBlank() || subject.length() > 255)
      throw ApiException.bad("OIDC subject không hợp lệ.");
    store.warehouse(id);
    store.revokeWarehouseAccess(id, subject);
    store.audit("WAREHOUSE_ACCESS_REVOKE", id, Json.obj("subject", subject));
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/warehouses")
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> create(@RequestBody Map<String, Object> b) {
    fields(
        b,
        Set.of(
            "name",
            "engine",
            "host",
            "port",
            "database",
            "defaultSchema",
            "username",
            "credentialReference",
            "importCredentialReference",
            "importUsername",
            "ingestionUsername",
            "ingestionCredentialReference"));
    required(b, "name", "engine", "host", "database", "username", "credentialReference");
    adapters.validate(b);
    adapters.password(Json.str(b, "credentialReference"));
    String id = Json.id("wh");
    var doc = new LinkedHashMap<>(b);
    doc.remove("credentialReference");
    doc.remove("importCredentialReference");
    doc.remove("ingestionCredentialReference");
    doc.putAll(
        Json.obj(
            "warehouseId",
            id,
            "status",
            "INVALID",
            "capabilities",
            adapters.get(doc).getCapabilities(),
            "createdAt",
            Instant.now().toString(),
            "updatedAt",
            Instant.now().toString()));
    String importCredentialReference =
        b.containsKey("importCredentialReference")
            ? Json.str(b, "importCredentialReference")
            : null;
    if (importCredentialReference != null) adapters.password(importCredentialReference);
    String importUsername = Json.str(b, "importUsername");
    validateIngestionWriter(importUsername, importCredentialReference);
    String ingestionUsername = Json.str(b, "ingestionUsername");
    String ingestionCredentialReference = Json.str(b, "ingestionCredentialReference");
    validateIngestionWriter(ingestionUsername, ingestionCredentialReference);
    doc.put("ingestionUsername", ingestionUsername);
    doc.put("importUsername", importUsername);
    store.insertWarehouse(
        doc,
        Json.str(b, "credentialReference"),
        importCredentialReference,
        importUsername,
        ingestionUsername,
        ingestionCredentialReference);
    store.audit("WAREHOUSE_REGISTER", id);
    return ResponseEntity.created(java.net.URI.create("/api/v1/warehouses/" + id)).body(safe(doc));
  }

  @PatchMapping("/warehouses/{id}")
  @PreAuthorize("hasRole('ADMIN')")
  Object update(@PathVariable String id, @RequestBody Map<String, Object> b) {
    fields(
        b,
        Set.of(
            "name",
            "host",
            "port",
            "database",
            "defaultSchema",
            "username",
            "credentialReference",
            "importCredentialReference",
            "importUsername",
            "ingestionUsername",
            "ingestionCredentialReference",
            "status"));
    var w = store.warehouse(id);
    var changed = new LinkedHashMap<>(w);
    changed.putAll(b);
    changed.remove("credentialReference");
    changed.remove("importCredentialReference");
    changed.remove("ingestionCredentialReference");
    adapters.validate(changed);
    String reference =
        b.containsKey("credentialReference")
            ? Json.str(b, "credentialReference")
            : store.credential(id);
    adapters.password(reference);
    if (b.containsKey("status") && !Set.of("ACTIVE", "DISABLED").contains(Json.str(b, "status")))
      throw ApiException.bad("Status không hợp lệ.");
    if ("ACTIVE".equals(b.get("status"))) {
      try {
        if (!adapters.get(changed).testConnection(changed, adapters.password(reference)))
          throw new Exception();
      } catch (Exception e) {
        throw new ApiException(
            HttpStatus.SERVICE_UNAVAILABLE,
            "WAREHOUSE_CONNECTION_ERROR",
            "Không thể kích hoạt warehouse chưa kết nối được.");
      }
    }
    changed.put("updatedAt", Instant.now().toString());
    if (b.containsKey("importCredentialReference")) {
      changed.put("importUsername", store.importUsername(id));
    }
    if (b.containsKey("importUsername") || b.containsKey("importCredentialReference")) {
      String importUsername =
          b.containsKey("importUsername")
              ? Json.str(b, "importUsername")
              : store.importUsername(id);
      String importReference =
          b.containsKey("importCredentialReference")
              ? Json.str(b, "importCredentialReference")
              : store.importCredential(id);
      validateIngestionWriter(importUsername, importReference);
      changed.put("importUsername", importUsername);
      store.updateImportWriter(id, importUsername, importReference);
    }
    if (b.containsKey("ingestionUsername") || b.containsKey("ingestionCredentialReference")) {
      String ingestionUsername =
          b.containsKey("ingestionUsername")
              ? Json.str(b, "ingestionUsername")
              : store.ingestionUsername(id);
      String ingestionCredentialReference =
          b.containsKey("ingestionCredentialReference")
              ? Json.str(b, "ingestionCredentialReference")
              : store.ingestionCredential(id);
      validateIngestionWriter(ingestionUsername, ingestionCredentialReference);
      changed.put("ingestionUsername", ingestionUsername);
      store.updateIngestionCredential(id, ingestionUsername, ingestionCredentialReference);
    }
    store.updateWarehouse(changed, reference);
    store.audit("WAREHOUSE_UPDATE", id);
    return safe(changed);
  }

  private void validateIngestionWriter(String username, String reference) {
    if ((username == null || username.isBlank()) && (reference == null || reference.isBlank()))
      return;
    if (username == null
        || !username.matches("[A-Za-z0-9_.@-]{1,255}")
        || reference == null
        || reference.isBlank())
      throw ApiException.bad("Cần khai báo cả ingestionUsername và ingestionCredentialReference.");
    adapters.password(reference);
  }

  @PostMapping("/warehouses/{id}/test")
  @PreAuthorize("hasRole('ADMIN')")
  Object test(@PathVariable String id) {
    var w = store.warehouse(id);
    long start = System.nanoTime();
    boolean reachable = false;
    try {
      reachable = adapters.get(w).testConnection(w, adapters.password(store.credential(id)));
    } catch (Exception ignored) {
    }
    if (!Json.str(w, "status").equals("DISABLED")) {
      w.put("status", reachable ? "ACTIVE" : "UNAVAILABLE");
      store.updateWarehouse(w, null);
    }
    store.audit("WAREHOUSE_TEST", id);
    return Json.obj(
        "warehouseId",
        id,
        "reachable",
        reachable,
        "latencyMs",
        (System.nanoTime() - start) / 1000000,
        "checkedAt",
        Instant.now().toString(),
        "error",
        reachable
            ? null
            : Errors.body(
                "WAREHOUSE_CONNECTION_ERROR", "Không thể kết nối warehouse.", Json.obj()));
  }

  @PostMapping("/warehouses/{id}/discover")
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> discover(@PathVariable String id) {
    store.warehouse(id);
    String runId = Json.id("discover");
    var run =
        Json.obj(
            "runId",
            runId,
            "warehouseId",
            id,
            "status",
            "RUNNING",
            "createdAt",
            Instant.now().toString(),
            "completedAt",
            null,
            "metadata",
            null,
            "error",
            null);
    store.run(runId, "DISCOVERY", run);
    try {
      var tables = catalog.discover(id, true);
      var schemas = new TreeMap<String, List<Map<String, Object>>>();
      for (var table : tables)
        schemas.computeIfAbsent(Json.str(table, "schema"), k -> new ArrayList<>()).add(table);
      run.put(
          "metadata",
          Json.obj(
              "schemas",
              schemas.entrySet().stream()
                  .map(e -> Json.obj("name", e.getKey(), "tables", e.getValue()))
                  .toList()));
      run.put("status", "SUCCESS");
    } catch (ApiException e) {
      run.put("status", "FAILED");
      run.put("error", Errors.body(e.code, e.getMessage(), Json.obj()));
    }
    run.put("completedAt", Instant.now().toString());
    store.run(runId, "DISCOVERY", run);
    store.audit("METADATA_DISCOVER", id);
    return ResponseEntity.accepted().body(run);
  }

  @GetMapping("/warehouses/{id}/discoveries/{runId}")
  Object discovery(@PathVariable String id, @PathVariable String runId) {
    store.warehouse(id);
    var run = store.run(runId, "DISCOVERY");
    if (!id.equals(run.get("warehouseId"))) throw ApiException.notFound();
    return run;
  }

  @GetMapping("/datasets")
  Object datasets(@RequestParam Map<String, String> p) {
    var list =
        store.all("dataset").stream()
            .filter(
                d -> {
                  try {
                    store.authorize(Json.str(d, "warehouseId"));
                    return true;
                  } catch (ApiException e) {
                    return false;
                  }
                })
            .toList();
    return Page.of(list, p, "name", Set.of("name", "status", "updatedAt", "createdAt"));
  }

  @GetMapping("/datasets/{id}")
  Object dataset(@PathVariable String id) {
    return store.dataset(id);
  }

  @PostMapping("/datasets")
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> createDataset(@RequestBody Map<String, Object> b) {
    fields(
        b,
        Set.of(
            "warehouseId",
            "name",
            "description",
            "allowedSchemas",
            "allowedTables",
            "semanticVersion",
            "schemaVersion"));
    required(b, "warehouseId", "name", "semanticVersion", "schemaVersion");
    String warehouse = Json.str(b, "warehouseId");
    var discovered = catalog.discover(warehouse, false);
    var allow = Json.objects(b.get("allowedTables"));
    Set<String> physical =
        discovered.stream().map(CatalogService::key).collect(java.util.stream.Collectors.toSet());
    if (allow.isEmpty() || allow.stream().anyMatch(t -> !physical.contains(CatalogService.key(t))))
      throw ApiException.bad("Allowlist chứa bảng không tồn tại.");
    if (!(b.get("allowedSchemas") instanceof List<?> schemas)
        || allow.stream().anyMatch(t -> !schemas.contains(t.get("schema"))))
      throw ApiException.bad("Allowlist schema không hợp lệ.");
    String id = Json.id("ds");
    var d = new LinkedHashMap<>(b);
    d.putAll(Json.obj("datasetId", id, "status", "ACTIVE", "updatedAt", Instant.now().toString()));
    var sem =
        Json.obj(
            "tables",
            List.of(),
            "metrics",
            List.of(),
            "dimensions",
            List.of(),
            "relationships",
            List.of(),
            "examples",
            List.of(),
            "businessRules",
            List.of(),
            "timezone",
            "UTC",
            "semanticVersion",
            b.get("semanticVersion"),
            "schemaVersion",
            b.get("schemaVersion"));
    store.insertDataset(d, sem);
    store.audit("DATASET_REGISTER", id);
    return ResponseEntity.status(201).body(d);
  }

  @PatchMapping("/datasets/{id}")
  @PreAuthorize("hasRole('ADMIN')")
  Object updateDataset(@PathVariable String id, @RequestBody Map<String, Object> b) {
    fields(b, Set.of("name", "description", "allowedSchemas", "allowedTables", "status"));
    var d = store.dataset(id);
    d.putAll(b);
    if (!Set.of("ACTIVE", "DISABLED").contains(Json.str(d, "status")))
      throw ApiException.bad("Status không hợp lệ.");
    var sem = store.semantic(id);
    if (Json.str(d, "status").equals("ACTIVE")) {
      var physical = catalog.discover(Json.str(d, "warehouseId"), true);
      Set<String> keys =
          physical.stream().map(CatalogService::key).collect(java.util.stream.Collectors.toSet());
      if (Json.objects(d.get("allowedTables")).stream()
          .anyMatch(t -> !keys.contains(CatalogService.key(t))))
        throw new ApiException(
            HttpStatus.CONFLICT, "SCHEMA_MISMATCH", "Allowlist không khớp schema.");
      catalog.validateSemantic(
          sem,
          physical.stream()
              .filter(
                  t ->
                      Json.objects(d.get("allowedTables")).stream()
                          .anyMatch(a -> CatalogService.key(a).equals(CatalogService.key(t))))
              .toList());
    }
    d.put("updatedAt", Instant.now().toString());
    store.updateDataset(d, sem);
    store.audit("DATASET_UPDATE", id);
    return d;
  }

  @GetMapping("/datasets/{id}/semantic-model")
  Object semantic(@PathVariable String id) {
    return catalog.context(id);
  }

  @PutMapping("/datasets/{id}/semantic-model")
  @PreAuthorize("hasRole('ADMIN')")
  Object semanticUpdate(@PathVariable String id, @RequestBody Map<String, Object> b) {
    fields(
        b,
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
    required(b, "semanticVersion", "schemaVersion", "timezone");
    try {
      java.time.ZoneId.of(Json.str(b, "timezone"));
    } catch (Exception e) {
      throw ApiException.bad("Timezone không hợp lệ.");
    }
    catalog.validateSemantic(b, catalog.tables(id));
    var d = store.dataset(id);
    d.put("semanticVersion", b.get("semanticVersion"));
    d.put("schemaVersion", b.get("schemaVersion"));
    d.put("updatedAt", Instant.now().toString());
    store.updateDataset(d, b);
    store.audit("SEMANTIC_UPDATE", id);
    return d;
  }

  @GetMapping("/datasets/{id}/catalog")
  Object catalog(@PathVariable String id) {
    return catalog.summary(id);
  }

  @GetMapping("/datasets/{id}/{kind:tables|metrics|dimensions|relationships|examples}")
  Object collection(
      @PathVariable String id, @PathVariable String kind, @RequestParam Map<String, String> p) {
    return Page.of(
        catalog.collection(id, kind),
        p,
        "name",
        Set.of("name", "question", "createdAt", "updatedAt"));
  }

  @GetMapping("/datasets/{id}/{kind:tables|metrics|dimensions}/{itemId}")
  Object detail(@PathVariable String id, @PathVariable String kind, @PathVariable String itemId) {
    return catalog.collection(id, kind).stream()
        .filter(x -> itemId.equals(x.get(kind.equals("tables") ? "tableId" : "name")))
        .findFirst()
        .orElseThrow(ApiException::notFound);
  }
}

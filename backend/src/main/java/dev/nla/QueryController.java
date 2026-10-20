package dev.nla;

import java.time.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class QueryController {
  private final QueryService queries;
  private final Store store;

  public QueryController(QueryService queries, Store store) {
    this.queries = queries;
    this.store = store;
  }

  @PostMapping("/query")
  @PreAuthorize("hasAnyRole('ANALYST','ADMIN')")
  ResponseEntity<?> run(@RequestBody Map<String, Object> b) {
    var q = queries.run(b);
    return ResponseEntity.status(201).body(q);
  }

  @GetMapping("/query/history")
  Object history(@RequestParam Map<String, String> p) {
    return Page.of(
        queries.history(), p, "createdAt", Set.of("createdAt", "latencyMs", "status", "queryId"));
  }

  @GetMapping("/query/{id}")
  Object query(@PathVariable String id) {
    return queries.get(id);
  }

  @GetMapping("/query/{id}/result")
  Object result(@PathVariable String id, @RequestParam Map<String, String> p) {
    return queries.result(id, p);
  }

  @GetMapping(value = "/query/{id}/export.csv", produces = "text/csv")
  ResponseEntity<String> csv(@PathVariable String id) {
    queries.result(id, Map.of());
    var full = Json.map(queries.stored(id).get("result"));
    var columns = Json.objects(full.get("columns"));
    var lines = new ArrayList<String>();
    lines.add(
        columns.stream()
            .map(c -> cell(Json.str(c, "name"), true))
            .collect(java.util.stream.Collectors.joining(",")));
    for (var row : Json.objects(full.get("rows")))
      lines.add(
          columns.stream()
              .map(
                  c ->
                      cell(
                          Objects.toString(row.get(Json.str(c, "name")), ""),
                          Set.of("STRING", "DATE", "TIMESTAMP").contains(c.get("dataType"))))
              .collect(java.util.stream.Collectors.joining(",")));
    store.audit("QUERY_CSV_EXPORT", id);
    return ResponseEntity.ok()
        .header(
            "Content-Disposition",
            "attachment; filename=\"query-" + id.replaceAll("[^a-zA-Z0-9_-]", "_") + ".csv\"")
        .header("X-Content-Type-Options", "nosniff")
        .body(String.join("\r\n", lines) + "\r\n");
  }

  static String cell(String text, boolean string) {
    if (string && text.matches("(?s)^[\\s\\u0000-\\u001f]*[=+@-].*")) text = "'" + text;
    return "\"" + text.replace("\"", "\"\"") + "\"";
  }

  @PostMapping("/query/{id}/saved")
  @PreAuthorize("hasAnyRole('ANALYST','ADMIN')")
  ResponseEntity<?> save(@PathVariable String id, @RequestBody Map<String, Object> b) {
    RegistryController.fields(b, Set.of("name"));
    RegistryController.required(b, "name");
    if (Json.str(b, "name").length() > 120) throw ApiException.bad("Tên tối đa 120 ký tự.");
    queries.result(id, Map.of());
    var doc =
        Json.obj(
            "savedResultId",
            Json.id("saved"),
            "queryId",
            id,
            "name",
            Json.str(b, "name").strip(),
            "createdAt",
            Instant.now().toString());
    store
        .jdbc()
        .update(
            "INSERT INTO saved_result(id,query_id,owner,document) VALUES (?,?,?,?::jsonb)",
            doc.get("savedResultId"),
            id,
            store.actor(),
            Json.write(doc));
    store.audit("QUERY_SAVE", id);
    return ResponseEntity.status(201).body(doc);
  }

  @GetMapping("/query/{id}/saved")
  Object saved(@PathVariable String id) {
    queries.get(id);
    return store
        .jdbc()
        .query(
            "SELECT document::text FROM saved_result WHERE query_id=? AND owner=?",
            (rs, n) -> Json.read(rs.getString(1)),
            id,
            store.actor());
  }
}

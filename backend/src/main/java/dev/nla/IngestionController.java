package dev.nla;

import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/warehouse/ingestion")
public class IngestionController {
  private final Store store;
  private final PipelineService pipelines;
  private final IngestionSourceService sources;

  public IngestionController(Store s, PipelineService p, IngestionSourceService sources) {
    store = s;
    pipelines = p;
    this.sources = sources;
  }

  @GetMapping("/sources")
  Object sources(@RequestParam Map<String, String> p) {
    return Page.of(sources.list(), p, "name", Set.of("name", "sourceId", "createdAt"));
  }

  @GetMapping("/sources/{sourceId}")
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR','ANALYST','VIEWER')")
  Object source(@PathVariable String sourceId) {
    return sources.get(sourceId);
  }

  @PostMapping("/sources")
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> createSource(@RequestBody Map<String, Object> request) {
    return ResponseEntity.status(201).body(sources.create(request));
  }

  @PatchMapping("/sources/{sourceId}")
  @PreAuthorize("hasRole('ADMIN')")
  Object updateSource(@PathVariable String sourceId, @RequestBody Map<String, Object> request) {
    return sources.update(sourceId, request);
  }

  @PostMapping("/sources/{sourceId}/test")
  @PreAuthorize("hasRole('ADMIN')")
  Object testSource(@PathVariable String sourceId) {
    return sources.test(sourceId);
  }

  @PostMapping("/run")
  @PreAuthorize("hasAnyRole('OPERATOR','ADMIN')")
  ResponseEntity<?> run(@RequestBody Map<String, Object> b) {
    return ResponseEntity.accepted().body(pipelines.run(b));
  }

  @GetMapping("/runs")
  Object runs(@RequestParam Map<String, String> p) {
    return Page.of(
        store.runs("INGESTION"),
        p,
        "startedAt",
        Set.of("createdAt", "startedAt", "completedAt", "durationMs", "rowsWritten", "status"));
  }

  @GetMapping("/runs/{id}")
  Object detail(@PathVariable String id) {
    return store.run(id, "INGESTION");
  }
}

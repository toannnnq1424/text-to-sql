package dev.nla;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/datasets/{datasetId}/quality")
@PreAuthorize("isAuthenticated()")
public class DataQualityController {
  private final DataQualityService service;

  public DataQualityController(DataQualityService service) {
    this.service = service;
  }

  @GetMapping("/rules")
  Object rules(@PathVariable String datasetId) {
    return service.rules(datasetId);
  }

  @PutMapping("/rules")
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR')")
  Object save(@PathVariable String datasetId, @RequestBody Map<String, Object> body) {
    return service.save(datasetId, body);
  }

  @PostMapping("/runs")
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR')")
  ResponseEntity<?> run(@PathVariable String datasetId, @RequestBody Map<String, Object> body) {
    return ResponseEntity.accepted().body(service.run(datasetId, body));
  }

  @GetMapping("/runs")
  Object runs(@PathVariable String datasetId, @RequestParam Map<String, String> parameters) {
    return service.runs(datasetId, parameters);
  }

  @GetMapping("/runs/{runId}")
  Object run(@PathVariable String datasetId, @PathVariable String runId) {
    return service.get(datasetId, runId);
  }
}

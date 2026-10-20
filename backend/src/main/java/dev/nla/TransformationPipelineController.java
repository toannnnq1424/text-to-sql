package dev.nla;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/pipelines")
public class TransformationPipelineController {
  private final TransformationPipelineService service;

  TransformationPipelineController(TransformationPipelineService service) {
    this.service = service;
  }

  @GetMapping
  Object list(@RequestParam Map<String, String> parameters) {
    return service.list(parameters);
  }

  @PostMapping
  @PreAuthorize("hasRole('ADMIN')")
  Object create(@RequestBody Map<String, Object> body) {
    return service.save(null, body);
  }

  @GetMapping("/{id}")
  Object get(@PathVariable String id) {
    return service.get(id);
  }

  @PatchMapping("/{id}")
  @PreAuthorize("hasRole('ADMIN')")
  Object update(@PathVariable String id, @RequestBody Map<String, Object> body) {
    return service.save(id, body);
  }

  @PostMapping("/preview")
  @PreAuthorize("hasRole('ADMIN')")
  Object preview(@RequestBody Map<String, Object> body) {
    return service.preview(body);
  }

  @PostMapping("/{id}/run")
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR')")
  ResponseEntity<?> run(@PathVariable String id, @RequestBody Map<String, Object> body) {
    RegistryController.fields(body, java.util.Set.of("idempotencyKey"));
    RegistryController.required(body, "idempotencyKey");
    return ResponseEntity.accepted().body(service.run(id, Json.str(body, "idempotencyKey")));
  }

  @GetMapping("/runs")
  Object runs(@RequestParam Map<String, String> parameters) {
    return service.runs(parameters);
  }

  @GetMapping("/runs/{id}")
  Object run(@PathVariable String id) {
    return service.status(id);
  }
}

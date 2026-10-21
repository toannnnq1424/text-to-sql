package dev.nla;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/settings/model-providers")
public class ModelProviderController {
  private final ModelProviderService service;

  ModelProviderController(ModelProviderService service) {
    this.service = service;
  }

  @GetMapping
  Object list() {
    return service.list();
  }

  @PostMapping
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> create(@RequestBody Map<String, Object> body) {
    return ResponseEntity.status(201).body(service.create(body));
  }

  @PutMapping("/{id}")
  @PreAuthorize("hasRole('ADMIN')")
  Object update(@PathVariable String id, @RequestBody Map<String, Object> body) {
    return service.update(id, body);
  }

  @PutMapping("/default")
  @PreAuthorize("hasRole('ADMIN')")
  Object defaultProvider(@RequestBody Map<String, Object> body) {
    return service.setDefault(body);
  }

  @DeleteMapping("/{id}")
  @PreAuthorize("hasRole('ADMIN')")
  ResponseEntity<?> delete(@PathVariable String id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }
}

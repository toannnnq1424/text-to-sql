package dev.nla;

import java.io.IOException;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/warehouse/ingestion/files")
@PreAuthorize("hasAnyRole('ADMIN','OPERATOR')")
public class FileIngestionController {
  private final FileIngestionService service;

  FileIngestionController(FileIngestionService service) {
    this.service = service;
  }

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  Object upload(
      @RequestPart MultipartFile file,
      @RequestParam(required = false) String sheet,
      @RequestParam(required = false) String delimiter)
      throws IOException {
    return service.upload(file, sheet, delimiter);
  }

  @GetMapping("/targets")
  Object targets(@RequestParam String warehouseId) {
    return service.targets(warehouseId);
  }

  @GetMapping("/{id}")
  Object upload(@PathVariable String id) {
    return service.upload(id);
  }

  @PostMapping("/{id}/validate")
  Object validate(@PathVariable String id, @RequestBody Map<String, Object> body)
      throws IOException {
    return service.validate(id, body);
  }

  @PostMapping("/runs")
  ResponseEntity<?> confirm(@RequestBody Map<String, Object> body) throws IOException {
    return ResponseEntity.accepted().body(service.confirm(body));
  }

  @GetMapping("/runs")
  Object runs(@RequestParam Map<String, String> parameters) {
    return service.runs(parameters);
  }

  @GetMapping("/runs/{id}")
  Object run(@PathVariable String id) {
    return service.run(id);
  }

  @PostMapping("/runs/{id}/cancel")
  Object cancel(@PathVariable String id) {
    return service.cancel(id);
  }
}

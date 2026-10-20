package dev.nla;

import java.io.IOException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/import/sql")
public class SqlImportController {
  private static final long MAX_FILE_BYTES = 2L * 1024 * 1024;
  private final SqlImportService imports;

  public SqlImportController(SqlImportService imports) {
    this.imports = imports;
  }

  @PostMapping(
      path = "/validate",
      consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
      produces = MediaType.APPLICATION_JSON_VALUE)
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR')")
  Object validate(
      @RequestParam String warehouseId,
      @RequestParam String sourceDialect,
      @RequestParam String targetSchema,
      @RequestPart("file") MultipartFile file) {
    if (file.getSize() > MAX_FILE_BYTES) throw ApiException.bad("File SQL vượt giới hạn 2 MiB.");
    String contentType = file.getContentType();
    if (contentType != null
        && !contentType.isBlank()
        && !contentType.equals(MediaType.TEXT_PLAIN_VALUE)
        && !contentType.equals("application/sql")
        && !contentType.equals("text/x-sql")
        && !contentType.equals(MediaType.APPLICATION_OCTET_STREAM_VALUE))
      throw ApiException.bad("Content-Type của file không được hỗ trợ.");
    try {
      return imports.validate(
          warehouseId, sourceDialect, targetSchema, file.getOriginalFilename(), file.getBytes());
    } catch (IOException e) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST, "SQL_IMPORT_PARSE_ERROR", "Không thể đọc file tải lên.");
    }
  }

  @PostMapping(path = "/runs", consumes = MediaType.APPLICATION_JSON_VALUE)
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR')")
  ResponseEntity<?> confirm(@RequestBody Map<String, Object> request) {
    return ResponseEntity.accepted().body(imports.confirm(request));
  }

  @GetMapping("/runs")
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR','ANALYST','VIEWER')")
  Object list(@RequestParam Map<String, String> params) {
    return imports.list(params);
  }

  @GetMapping("/runs/{runId}")
  @PreAuthorize("hasAnyRole('ADMIN','OPERATOR','ANALYST','VIEWER')")
  Object run(@PathVariable String runId) {
    return imports.run(runId);
  }
}

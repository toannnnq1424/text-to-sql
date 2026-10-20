package dev.nla;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.multipart.MultipartFile;

@Component
final class FileParserClient {
  private final RestClient client;
  private final String token;
  private final String url;

  FileParserClient(Environment environment) {
    url = environment.getProperty("FILE_SERVICE_URL", "");
    token = environment.getProperty("FILE_SERVICE_TOKEN", "");
    var factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Duration.ofSeconds(5));
    factory.setReadTimeout(Duration.ofSeconds(90));
    client = RestClient.builder().requestFactory(factory).build();
  }

  Map<String, Object> parse(MultipartFile file, String sheet, String delimiter, Path spool)
      throws IOException {
    if (url.isBlank() || token.length() < 32)
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "FILE_SERVICE_UNAVAILABLE",
          "Chưa cấu hình dịch vụ đọc file.");
    var body = new LinkedMultiValueMap<String, Object>();
    body.add("file", file.getResource());
    if (sheet != null && !sheet.isBlank()) body.add("sheet", sheet);
    if (delimiter != null && !delimiter.isEmpty()) body.add("delimiter", delimiter);
    try {
      return client
          .post()
          .uri(url + "/internal/v1/parse")
          .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
          .contentType(MediaType.MULTIPART_FORM_DATA)
          .body(body)
          .exchange(
              (request, response) -> {
                if (!response.getStatusCode().is2xxSuccessful()) {
                  if (response.getStatusCode().value() == 413)
                    throw new ApiException(
                        HttpStatus.PAYLOAD_TOO_LARGE,
                        "PAYLOAD_TOO_LARGE",
                        "File vượt giới hạn 25 MiB.");
                  if (response.getStatusCode().value() == 422)
                    throw new ApiException(
                        HttpStatus.UNPROCESSABLE_ENTITY,
                        "FILE_PARSE_ERROR",
                        "File không hợp lệ. Kiểm tra định dạng, header, ô công thức và giới hạn dữ"
                            + " liệu.");
                  throw new ApiException(
                      HttpStatus.SERVICE_UNAVAILABLE,
                      "FILE_SERVICE_UNAVAILABLE",
                      "Dịch vụ đọc file chưa sẵn sàng.");
                }
                var reader =
                    new BufferedReader(
                        new InputStreamReader(response.getBody(), StandardCharsets.UTF_8));
                String header = boundedLine(reader, 1024 * 1024);
                if (header == null) throw new IOException("Missing parser metadata");
                var metadata = Json.read(header);
                var columns = Json.objects(metadata.get("columns"));
                int expected = ((Number) metadata.getOrDefault("rowCount", 0)).intValue();
                if (columns.isEmpty() || columns.size() > 200 || expected < 1 || expected > 100000)
                  throw new IOException("Invalid parser bounds");
                List<List<?>> preview = new ArrayList<>();
                int count = 0;
                long bytes = 0;
                try (var writer =
                    Files.newBufferedWriter(
                        spool, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW)) {
                  String line;
                  while ((line = boundedLine(reader, 4 * 1024 * 1024)) != null) {
                    bytes += line.getBytes(StandardCharsets.UTF_8).length + 1;
                    if (++count > expected || bytes > 75L * 1024 * 1024)
                      throw new IOException("Parser overflow");
                    var row = Json.read(line).get("row");
                    if (!(row instanceof List<?> values) || values.size() != columns.size())
                      throw new IOException("Parser row mismatch");
                    if (preview.size() < 20) preview.add(values);
                    writer.write(line);
                    writer.newLine();
                  }
                }
                if (count != expected) throw new IOException("Truncated parser output");
                metadata.put("previewRows", preview);
                metadata.put("columnCount", columns.size());
                return metadata;
              });
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "FILE_SERVICE_UNAVAILABLE",
          "Không thể đọc file; chưa có dữ liệu nào được nạp.");
    }
  }

  private static String boundedLine(BufferedReader reader, int limit) throws IOException {
    var line = new StringBuilder();
    int value;
    while ((value = reader.read()) != -1) {
      if (value == '\n') return line.toString();
      if (line.length() >= limit) throw new IOException("Parser line overflow");
      line.append((char) value);
    }
    return line.isEmpty() ? null : line.toString();
  }
}

package dev.nla;

import java.net.*;
import java.net.http.*;
import java.time.*;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class AiClient {
  private final Environment env;
  private final HttpClient http =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();

  public AiClient(Environment env) {
    this.env = env;
  }

  public Map<String, Object> invoke(String path, Map<String, Object> request, int timeoutSeconds) {
    if (!Set.of(
            "business-plan",
            "model-provider/status",
            "business-validate",
            "semantic-assist",
            "knowledge/status",
            "knowledge/index",
            "knowledge/search",
            "knowledge/examples",
            "knowledge/remember",
            "knowledge/forget",
            "knowledge/reset",
            "transform-plan")
        .contains(path)) throw ApiException.bad("Private capability không hợp lệ.");
    String base = env.getProperty("nla.python-url", "");
    String token = env.getProperty("nla.python-token", "");
    if (base.isBlank() || token.length() < 32)
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE, "LLM_ERROR", "Chưa cấu hình dịch vụ xử lý.");
    try {
      URI uri = URI.create(base + "/internal/v1/" + path);
      if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getUserInfo() != null)
        throw new IllegalArgumentException();
      var response =
          http.send(
              HttpRequest.newBuilder(uri)
                  .timeout(Duration.ofSeconds(QueryDeadline.seconds(timeoutSeconds)))
                  .header("Content-Type", "application/json")
                  .header("Authorization", "Bearer " + token)
                  .header("X-Correlation-ID", Json.str(request, "correlationId"))
                  .POST(HttpRequest.BodyPublishers.ofString(Json.write(request)))
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      if (response.body().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 1048576)
        throw new ApiException(HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Phản hồi vượt giới hạn.");
      var body = Json.read(response.body());
      if (response.statusCode() != 200) {
        String code = Json.str(Json.map(body.get("error")), "code");
        if (code.equals("SEMANTIC_MODEL_INVALID"))
          throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              code,
              "Ngữ nghĩa không hợp lệ: kiểm tra tên cột, biểu thức tổng hợp, dimensions và đường"
                  + " join giữ đúng mức hạt.");
        if (code.equals("INVALID_REQUEST")) throw ApiException.bad("Cấu hình xử lý không hợp lệ.");
        if (path.equals("model-provider/status"))
          throw new ApiException(
              HttpStatus.SERVICE_UNAVAILABLE,
              "LLM_ERROR",
              "Không đọc được cấu hình model từ dịch vụ xử lý.");

        if (path.equals("semantic-assist")) {
          if (Set.of("INSUFFICIENT_CONTEXT", "UNSUPPORTED_QUESTION", "LOW_CONFIDENCE")
              .contains(code))
            throw new ApiException(
                HttpStatus.UNPROCESSABLE_ENTITY,
                code,
                "Metadata chưa đủ hoặc yêu cầu chưa được hỗ trợ; hãy mô tả rõ công thức, cột và mức"
                    + " hạt.");
          if (code.equals("PROVIDER_TIMEOUT"))
            throw new ApiException(
                HttpStatus.GATEWAY_TIMEOUT,
                "QUERY_TIMEOUT",
                "Model phản hồi quá thời gian cho phép.");
          if (code.equals("INVALID_MODEL_RESPONSE"))
            throw new ApiException(
                HttpStatus.BAD_GATEWAY,
                "SEMANTIC_MODEL_INVALID",
                "Đề xuất của model không khớp schema hoặc ngữ nghĩa hợp lệ; chưa có cấu hình nào"
                    + " được kích hoạt.");
          throw new ApiException(
              HttpStatus.SERVICE_UNAVAILABLE,
              "LLM_ERROR",
              "Model chưa sẵn sàng. Kiểm tra cấu hình provider hoặc model local; không có bản nháp"
                  + " thay thế giả.");
        }
        throw new ApiException(
            HttpStatus.SERVICE_UNAVAILABLE,
            "KNOWLEDGE_UNAVAILABLE",
            "Bộ xử lý tri thức chưa sẵn sàng; kiểm tra model local và chỉ mục của dataset.");
      }
      if (path.equals("business-plan")) validateCandidate(body);
      return body;
    } catch (ApiException exception) {
      throw exception;
    } catch (java.net.http.HttpTimeoutException exception) {
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Xử lý vượt thời gian cho phép.");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Yêu cầu truy vấn đã dừng.");
    } catch (Exception exception) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE, "LLM_ERROR", "Không kết nối được dịch vụ xử lý.");
    }
  }

  static void validateCandidate(Map<String, Object> body) {
    Set<String> fields =
        Set.of(
            "sql",
            "explanation",
            "assumptions",
            "selectedMetrics",
            "selectedDimensions",
            "chartRecommendation",
            "confidence",
            "model");
    if (!body.keySet().equals(fields)
        || !(body.get("confidence") instanceof Number confidence)
        || !Double.isFinite(confidence.doubleValue())
        || confidence.doubleValue() < 0
        || confidence.doubleValue() > 1) throw invalidCandidate();
    for (String field : List.of("sql", "explanation", "model")) {
      int bound = field.equals("sql") ? 100000 : field.equals("model") ? 500 : 10000;
      if (!(body.get(field) instanceof String text)
          || text.length() > bound
          || (!field.equals("explanation") && text.isBlank())) throw invalidCandidate();
    }
    for (String field : List.of("assumptions", "selectedMetrics", "selectedDimensions")) {
      if (!(body.get(field) instanceof List<?> values)
          || values.size() > 100
          || values.stream()
              .anyMatch(value -> !(value instanceof String text) || text.length() > 10000))
        throw invalidCandidate();
    }
    if (!(body.get("chartRecommendation") instanceof Map<?, ?> chart)
        || !(chart.get("type") instanceof String type)
        || type.isBlank()
        || type.length() > 40) throw invalidCandidate();
  }

  private static ApiException invalidCandidate() {
    return new ApiException(HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Phản hồi bộ xử lý sai contract.");
  }

  public Map<String, Object> generate(Map<String, Object> request, String mode) {
    String base = env.getProperty("nla.python-url", "");
    String token = env.getProperty("nla.python-token", "");
    if (base.isBlank() || token.length() < 32)
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE, "LLM_ERROR", "Python AI service chưa được cấu hình.");
    try {
      URI uri = URI.create(base + "/internal/v1/text-to-sql");
      if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getUserInfo() != null)
        throw new IllegalArgumentException();
      var response =
          http.send(
              HttpRequest.newBuilder(uri)
                  .timeout(Duration.ofSeconds(QueryDeadline.seconds(55)))
                  .header("Content-Type", "application/json")
                  .header("X-Execution-Mode", mode)
                  .header("Authorization", "Bearer " + token)
                  .header("X-Correlation-ID", Json.str(request, "correlationId"))
                  .POST(HttpRequest.BodyPublishers.ofString(Json.write(request)))
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      if (response.body().length() > 1048576)
        throw new ApiException(HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Phản hồi AI vượt giới hạn.");
      var body = Json.read(response.body());
      if (response.statusCode() != 200) {
        var error = Json.map(body.get("error"));
        String reason = Json.str(error, "code");
        if (Set.of("INSUFFICIENT_CONTEXT", "UNSUPPORTED_QUESTION", "LOW_CONFIDENCE")
            .contains(reason))
          throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              reason,
              switch (reason) {
                case "INSUFFICIENT_CONTEXT" ->
                    "Dataset chưa cung cấp đủ schema hoặc ngữ nghĩa để trả lời câu hỏi này.";
                case "UNSUPPORTED_QUESTION" ->
                    "Câu hỏi nằm ngoài dữ liệu hoặc khả năng truy vấn an toàn của dataset hiện"
                        + " tại.";
                default ->
                    "Model chưa tạo được SQL đủ tin cậy sau lần thử có giới hạn. Nếu bảng/cột đã"
                        + " nêu rõ, có thể đây là giới hạn của model hiện tại; hãy thử model phù"
                        + " hợp hơn hoặc cấu hình metric/dimension cho ý nghĩa nghiệp vụ.";
              });
        if (reason.equals("INVALID_MODEL_RESPONSE"))
          throw new ApiException(
              HttpStatus.BAD_GATEWAY,
              "LLM_ERROR",
              "Model có phản hồi nhưng SQL hoặc metadata không đạt kiểm tra an toàn. Hãy làm rõ"
                  + " phép tổng hợp và cột nhóm, hoặc chọn model phù hợp hơn.");
        if (reason.equals("PROVIDER_UNAVAILABLE"))
          throw new ApiException(
              HttpStatus.SERVICE_UNAVAILABLE,
              "LLM_ERROR",
              "Không kết nối được model provider đã chọn. Kiểm tra Ollama/model local hoặc cấu hình"
                  + " provider trong Settings.");
        if (response.statusCode() == 504)
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT,
              "QUERY_TIMEOUT",
              "Model không trả lời trong thời gian giới hạn. Với Ollama local, thử câu hỏi ngắn hơn"
                  + " hoặc tăng timeout provider.");
        throw new ApiException(
            HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Dịch vụ AI không xử lý được câu hỏi.");
      }
      validateCandidate(body);
      return body;
    } catch (ApiException e) {
      throw e;
    } catch (java.net.http.HttpTimeoutException e) {
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Dịch vụ AI hết thời gian xử lý.");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Yêu cầu truy vấn đã dừng.");
    } catch (Exception e) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Không kết nối được Python AI service.");
    }
  }
}

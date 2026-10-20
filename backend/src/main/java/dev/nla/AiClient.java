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
                  .timeout(Duration.ofSeconds(35))
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
              "Câu hỏi không được semantic context hỗ trợ hoặc chưa đủ rõ.");
        if (response.statusCode() == 504)
          throw new ApiException(
              HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Dịch vụ AI hết thời gian xử lý.");
        throw new ApiException(
            HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Dịch vụ AI không xử lý được câu hỏi.");
      }
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
          || !(body.get("confidence") instanceof Number n)
          || n.doubleValue() < 0
          || n.doubleValue() > 1
          || Json.str(body, "sql").isBlank())
        throw new ApiException(HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Phản hồi AI sai contract.");
      for (String field : List.of("assumptions", "selectedMetrics", "selectedDimensions"))
        if (!(body.get(field) instanceof List<?> list)
            || list.stream().anyMatch(v -> !(v instanceof String)))
          throw new ApiException(
              HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Phản hồi AI sai kiểu dữ liệu.");
      return body;
    } catch (ApiException e) {
      throw e;
    } catch (java.net.http.HttpTimeoutException e) {
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Dịch vụ AI hết thời gian xử lý.");
    } catch (Exception e) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Không kết nối được Python AI service.");
    }
  }
}

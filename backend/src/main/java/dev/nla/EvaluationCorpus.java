package dev.nla;

import java.nio.file.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Server-managed, data-independent suite catalog. Never resolves a browser file path. */
@Component
final class EvaluationCorpus {
  private final Path root;

  EvaluationCorpus() {
    this(Path.of(System.getProperty("nla.data.root", "../data")));
  }

  EvaluationCorpus(Path root) {
    this.root = root.toAbsolutePath().normalize();
  }

  List<Map<String, Object>> summaries() {
    List<Map<String, Object>> results = new ArrayList<>();
    for (var suite : catalog()) {
      Map<String, Object> files = Json.map(suite.get("caseFiles"));
      Integer count = null;
      for (String engine : files.keySet()) {
        int actual = cases(suite, engine).size();
        if (count != null && count != actual) throw invalid();
        count = actual;
      }
      results.add(
          Json.obj(
              "suiteId",
              suite.get("suiteId"),
              "name",
              suite.get("name"),
              "version",
              suite.get("version"),
              "caseCount",
              count,
              "engines",
              files.keySet().stream().sorted().toList()));
    }
    return List.copyOf(results);
  }

  List<Map<String, Object>> cases(String id, String engine) {
    Map<String, Object> suite =
        catalog().stream()
            .filter(s -> id.equals(s.get("suiteId")))
            .findFirst()
            .orElseThrow(ApiException::notFound);
    if (!Json.map(suite.get("caseFiles")).containsKey(engine))
      throw ApiException.bad("Suite không hỗ trợ engine đã chọn.");
    return cases(suite, engine);
  }

  private List<Map<String, Object>> catalog() {
    List<Map<String, Object>> suites = Json.objects(read("evaluation/suites.json").get("suites"));
    if (suites.isEmpty() || suites.size() > 100) throw invalid();
    Set<String> ids = new HashSet<>();
    for (var suite : suites) {
      String id = Json.str(suite, "suiteId");
      if (!id.matches("[A-Za-z0-9_-]{1,100}")
          || !ids.add(id)
          || Json.str(suite, "name").isBlank()
          || Json.str(suite, "version").isBlank()) throw invalid();
      Set<String> engines = Json.map(suite.get("caseFiles")).keySet();
      if (engines.isEmpty() || !Set.of("POSTGRESQL", "MYSQL", "SQL_SERVER").containsAll(engines))
        throw invalid();
    }
    return suites;
  }

  private List<Map<String, Object>> cases(Map<String, Object> suite, String engine) {
    Map<String, Object> corpus = read(Json.str(Json.map(suite.get("caseFiles")), engine));
    if (!Objects.equals(corpus.get("suiteId"), suite.get("suiteId"))
        || !Objects.equals(corpus.get("engine"), engine)) throw invalid();
    List<Map<String, Object>> cases = Json.objects(corpus.get("cases"));
    if (cases.isEmpty() || cases.size() > 1000) throw invalid();
    Set<String> ids = new HashSet<>();
    for (var item : cases) {
      if (!ids.add(Json.str(item, "caseId"))
          || Json.str(item, "caseId").isBlank()
          || Json.str(item, "question").isBlank()
          || Json.str(item, "question").length() > 1000
          || !(item.get("expectedRejection") instanceof Boolean)) throw invalid();
      if (!Boolean.TRUE.equals(item.get("expectedRejection"))
          && (Json.str(item, "expectedSql").isBlank() || Json.str(item, "expectedChart").isBlank()))
        throw invalid();
    }
    return cases;
  }

  private Map<String, Object> read(String relative) {
    try {
      if (relative.isBlank() || Path.of(relative).isAbsolute()) throw invalid();
      Path path = root.resolve(relative).normalize();
      if (!path.startsWith(root)
          || !path.toRealPath().startsWith(root.toRealPath())
          || Files.size(path) > 4 * 1024 * 1024) throw invalid();
      return Json.read(Files.readString(path));
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw invalid();
    }
  }

  private static ApiException invalid() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "EVALUATION_CONFIG_ERROR",
        "Cấu hình bộ evaluation không hợp lệ hoặc chưa có trên server.");
  }
}

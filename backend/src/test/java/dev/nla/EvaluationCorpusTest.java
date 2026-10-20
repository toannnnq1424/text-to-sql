package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class EvaluationCorpusTest {
  @TempDir Path root;

  private void write(String file, Object value) throws Exception {
    Path target = root.resolve(file);
    Files.createDirectories(target.getParent());
    Files.writeString(target, Json.write(value));
  }

  private void fixture(String id, String file) throws Exception {
    write(
        "evaluation/suites.json",
        Json.obj(
            "suites",
            List.of(
                Json.obj(
                    "suiteId",
                    id,
                    "name",
                    "Custom configured domain",
                    "version",
                    "1.0",
                    "caseFiles",
                    Json.obj("POSTGRESQL", file)))));
    write(
        "custom/cases.json",
        Json.obj(
            "suiteId",
            id,
            "engine",
            "POSTGRESQL",
            "cases",
            List.of(
                Json.obj(
                    "caseId",
                    "one",
                    "question",
                    "How many?",
                    "expectedRejection",
                    false,
                    "expectedSql",
                    "SELECT COUNT(*) FROM analytics.custom",
                    "expectedChart",
                    "number"))));
  }

  @Test
  void loadsArbitraryConfiguredSuiteWithoutDomainCode() throws Exception {
    fixture("configured-domain", "custom/cases.json");
    var corpus = new EvaluationCorpus(root);
    assertEquals(1, corpus.summaries().getFirst().get("caseCount"));
    assertEquals(
        "How many?", corpus.cases("configured-domain", "POSTGRESQL").getFirst().get("question"));
    assertThrows(ApiException.class, () -> corpus.cases("configured-domain", "MYSQL"));
  }

  @Test
  void rejectsTraversalOutsideRoot() throws Exception {
    fixture("configured-domain", "../outside.json");
    assertThrows(ApiException.class, () -> new EvaluationCorpus(root).summaries());
  }

  @Test
  void derivesCheckedInCountsFromCaseFiles() {
    var corpus = new EvaluationCorpus(Path.of(System.getProperty("nla.data.root", "../data")));
    var suites = corpus.summaries();
    assertEquals(2, suites.size());
    for (var suite : suites)
      for (Object engine : (List<?>) suite.get("engines"))
        assertEquals(
            suite.get("caseCount"),
            corpus.cases(Json.str(suite, "suiteId"), engine.toString()).size());
  }
}

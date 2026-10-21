package dev.nla;

import dev.nla.warehouse.WarehouseAdapter;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

/**
 * Independent count oracles compiled from this dataset's discovered tables, never model answers.
 */
final class DatasetEvaluation {
  static final String ID = "dataset-schema";

  private DatasetEvaluation() {}

  static List<Map<String, Object>> cases(
      List<Map<String, Object>> tables, WarehouseAdapter adapter) {
    var selected = tables.stream().limit(8).toList();
    return IntStream.range(0, selected.size())
        .mapToObj(
            index -> {
              var table = selected.get(index);
              String qualified =
                  adapter.quoteIdentifier(Json.str(table, "schema"))
                      + "."
                      + adapter.quoteIdentifier(Json.str(table, "name"));
              return Json.obj(
                  "caseId",
                  "SCHEMA-" + (index + 1),
                  "question",
                  "Có bao nhiêu bản ghi trong bảng "
                      + CatalogService.key(table)
                      + "? Trả về một cột tên record_count.",
                  "difficulty",
                  "EASY",
                  "expectedRejection",
                  false,
                  "expectedSql",
                  "SELECT COUNT(*) AS record_count FROM " + qualified,
                  "expectedChart",
                  "number");
            })
        .toList();
  }

  static Map<String, Object> summary(Map<String, Object> dataset, String engine, int count) {
    return Json.obj(
        "suiteId",
        ID,
        "name",
        "Kiểm tra schema · " + dataset.get("name"),
        "version",
        dataset.get("schemaVersion"),
        "caseCount",
        count,
        "engines",
        List.of(engine),
        "origin",
        "CURRENT_SCHEMA",
        "description",
        "Câu kiểm tra và SQL tham chiếu được tạo từ metadata dataset hiện tại; kết quả tham chiếu"
            + " được thực thi độc lập. Đây là kiểm tra schema cơ bản, không phải thước đo toàn bộ"
            + " năng lực AI.");
  }
}

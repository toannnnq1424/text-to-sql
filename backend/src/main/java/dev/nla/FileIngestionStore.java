package dev.nla;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Repository;

@Repository
final class FileIngestionStore {
  private final Store store;

  FileIngestionStore(Store store) {
    this.store = store;
  }

  Map<String, Object> get(String kind, String id) {
    String table =
        switch (kind) {
          case "upload" -> "file_upload";
          case "plan" -> "file_ingestion_plan";
          case "run" -> "file_ingestion_run";
          default -> throw new IllegalArgumentException("Unknown file entity");
        };
    var rows =
        store.jdbc().queryForList("SELECT actor,document::text FROM " + table + " WHERE id=?", id);
    if (rows.isEmpty()) throw ApiException.notFound();
    var row = rows.getFirst();
    if (!store.admin() && !store.actor().equals(row.get("actor"))) throw ApiException.notFound();
    var document = Json.read(row.get("document").toString());
    if (document.containsKey("warehouseId")) store.authorize(Json.str(document, "warehouseId"));
    return document;
  }

  void upload(Map<String, Object> document, String digest) {
    store
        .jdbc()
        .update(
            "INSERT INTO file_upload(id,actor,document,digest,expires_at) VALUES"
                + " (?,?,?::jsonb,?,?::timestamptz)",
            document.get("id"),
            store.actor(),
            Json.write(document),
            digest,
            document.get("expiresAt"));
  }

  String uploadDigest(String id) {
    get("upload", id);
    return store
        .jdbc()
        .queryForObject("SELECT digest FROM file_upload WHERE id=?", String.class, id);
  }

  void plan(Map<String, Object> document) {
    store
        .jdbc()
        .update(
            "INSERT INTO file_ingestion_plan(id,upload_id,actor,warehouse_id,document,expires_at)"
                + " VALUES (?,?,?,?,?::jsonb,?::timestamptz)",
            document.get("id"),
            document.get("uploadId"),
            store.actor(),
            document.get("warehouseId"),
            Json.write(document),
            document.get("expiresAt"));
  }

  Map<String, Object> retry(String key, String digest) {
    var rows =
        store
            .jdbc()
            .queryForList(
                "SELECT request_digest,document::text FROM file_ingestion_run WHERE actor=? AND"
                    + " idempotency_key=?",
                store.actor(),
                key);
    if (rows.isEmpty()) return null;
    if (!digest.equals(rows.getFirst().get("request_digest")))
      throw new ApiException(
          HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "Khóa retry đã dùng cho yêu cầu khác.");
    var run = Json.read(rows.getFirst().get("document").toString());
    store.authorize(Json.str(run, "warehouseId"));
    return run;
  }

  void createRun(Map<String, Object> run, Map<String, Object> plan, String key, String digest) {
    store
        .jdbc()
        .update(
            "INSERT INTO"
                + " file_ingestion_run(id,upload_id,plan_id,actor,warehouse_id,target_schema,target_table,idempotency_key,request_digest,document)"
                + " VALUES (?,?,?,?,?,?,?,?,?,?::jsonb)",
            run.get("id"),
            plan.get("uploadId"),
            plan.get("id"),
            store.actor(),
            run.get("warehouseId"),
            plan.get("targetSchema"),
            plan.get("targetTable"),
            key,
            digest,
            Json.write(run));
  }

  void save(Map<String, Object> run) {
    store
        .jdbc()
        .update(
            "UPDATE file_ingestion_run SET document=?::jsonb WHERE id=?",
            Json.write(run),
            run.get("id"));
  }

  List<Map<String, Object>> runs() {
    var rows =
        store.admin()
            ? store
                .jdbc()
                .queryForList(
                    "SELECT document::text FROM file_ingestion_run ORDER BY created_at DESC")
            : store
                .jdbc()
                .queryForList(
                    "SELECT document::text FROM file_ingestion_run WHERE actor=? ORDER BY"
                        + " created_at DESC",
                    store.actor());
    return rows.stream()
        .map(row -> Json.read(row.get("document").toString()))
        .filter(
            run -> {
              try {
                store.authorize(Json.str(run, "warehouseId"));
                return true;
              } catch (ApiException forbidden) {
                return false;
              }
            })
        .toList();
  }

  void recover() {
    var rows =
        store
            .jdbc()
            .queryForList(
                "SELECT document::text FROM file_ingestion_run WHERE document->>'status' IN"
                    + " ('PENDING','RUNNING')");
    for (var row : rows) {
      var run = Json.read(row.get("document").toString());
      run.put("status", "FAILED");
      run.put("partialFailure", true);
      run.put("completedAt", java.time.Instant.now().toString());
      run.put(
          "error",
          Errors.body(
              "FILE_INGESTION_ERROR",
              "Tác vụ bị gián đoạn khi dịch vụ khởi động lại; kiểm tra bảng đích trước khi thử"
                  + " lại.",
              Json.obj()));
      save(run);
    }
  }
}

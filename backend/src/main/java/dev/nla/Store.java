package dev.nla;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Repository;

@Repository
public class Store {
  private final JdbcTemplate jdbc;
  private final boolean local;

  public Store(JdbcTemplate jdbc, @Value("${nla.local:false}") boolean local) {
    this.jdbc = jdbc;
    this.local = local;
  }

  public JdbcTemplate jdbc() {
    return jdbc;
  }

  public String actor() {
    var a = SecurityContextHolder.getContext().getAuthentication();
    return a == null ? "anonymous" : a.getName();
  }

  public boolean admin() {
    var a = SecurityContextHolder.getContext().getAuthentication();
    return a != null
        && a.getAuthorities().stream().anyMatch(x -> x.getAuthority().equals("ROLE_ADMIN"));
  }

  public void authorize(String warehouse) {
    if (local || admin()) return;
    if (jdbc.queryForObject(
            "SELECT count(*) FROM resource_access WHERE subject=? AND warehouse_id=?",
            Integer.class,
            actor(),
            warehouse)
        == 0)
      throw new ApiException(
          HttpStatus.FORBIDDEN, "FORBIDDEN", "Không có quyền truy cập warehouse.");
  }

  public List<Map<String, Object>> all(String table) {
    allowed(table);
    return jdbc.query(
        "SELECT document::text FROM " + table + " ORDER BY id",
        (rs, n) -> Json.read(rs.getString(1)));
  }

  public List<Map<String, Object>> warehouses() {
    return all("warehouse").stream()
        .filter(
            w -> {
              try {
                authorize(Json.str(w, "warehouseId"));
                return true;
              } catch (ApiException e) {
                return false;
              }
            })
        .toList();
  }

  public Map<String, Object> warehouse(String id) {
    authorize(id);
    return get("warehouse", id);
  }

  public Map<String, Object> dataset(String id) {
    var d = get("dataset", id);
    authorize(Json.str(d, "warehouseId"));
    return d;
  }

  public Map<String, Object> get(String table, String id) {
    allowed(table);
    var rows =
        jdbc.query(
            "SELECT document::text FROM " + table + " WHERE id=?",
            (rs, n) -> Json.read(rs.getString(1)),
            id);
    if (rows.isEmpty()) throw ApiException.notFound();
    return rows.getFirst();
  }

  public Map<String, Object> semantic(String id) {
    dataset(id);
    return Json.read(
        jdbc.queryForObject(
            "SELECT semantic_model::text FROM dataset WHERE id=?", String.class, id));
  }

  public void insertWarehouse(
      Map<String, Object> doc,
      String reference,
      String importCredentialReference,
      String importUsername,
      String ingestionUsername,
      String ingestionCredentialReference) {
    jdbc.update(
        "INSERT INTO warehouse"
            + "(id,document,credential_reference,import_credential_reference,"
            + "import_username,ingestion_username,ingestion_credential_reference)"
            + " VALUES (?,?::jsonb,?,?,?,?,?)",
        doc.get("warehouseId"),
        Json.write(doc),
        reference,
        importCredentialReference,
        importUsername,
        ingestionUsername,
        ingestionCredentialReference);
  }

  public String importCredential(String id) {
    return jdbc.queryForObject(
        "SELECT import_credential_reference FROM warehouse WHERE id=?", String.class, id);
  }

  public String importUsername(String id) {
    return jdbc.queryForObject(
        "SELECT import_username FROM warehouse WHERE id=?", String.class, id);
  }

  public void saveImportPlan(
      String id, String actor, String warehouseId, String digest, Map<String, Object> document) {
    jdbc.update(
        "INSERT INTO sql_import_plan(plan_id,actor,warehouse_id,digest,document,expires_at)"
            + " VALUES (?,?,?, ?,?::jsonb,?::timestamptz)",
        id,
        actor,
        warehouseId,
        digest,
        Json.write(document),
        document.get("expiresAt"));
  }

  public void removeExpiredSqlImportPlans() {
    jdbc.update("DELETE FROM sql_import_plan WHERE expires_at < now() - interval '1 day'");
  }

  public Map<String, Object> sqlImportPlan(String id, String actor) {
    var plans =
        jdbc.query(
            "SELECT digest,document::text FROM sql_import_plan WHERE plan_id=? AND actor=?",
            (rs, n) -> Map.of("digest", rs.getString(1), "document", Json.read(rs.getString(2))),
            id,
            actor);
    if (plans.isEmpty()) throw ApiException.notFound();
    return plans.getFirst();
  }

  public Map<String, Object> sqlImportRun(String id) {
    var runs =
        jdbc.query(
            "SELECT document::text FROM sql_import_run WHERE run_id=?",
            (rs, n) -> Json.read(rs.getString(1)),
            id);
    if (runs.isEmpty()) throw ApiException.notFound();
    var run = runs.getFirst();
    authorize(Json.str(run, "warehouseId"));
    return run;
  }

  public List<Map<String, Object>> sqlImportRuns() {
    return jdbc
        .query(
            "SELECT document::text FROM sql_import_run ORDER BY created_at DESC",
            (rs, n) -> Json.read(rs.getString(1)))
        .stream()
        .filter(
            run -> {
              try {
                authorize(Json.str(run, "warehouseId"));
                return true;
              } catch (ApiException e) {
                return false;
              }
            })
        .toList();
  }

  public Map<String, Object> existingSqlImport(String actor, String idempotencyKey) {
    var runs =
        jdbc.query(
            "SELECT request_digest,document::text FROM sql_import_run"
                + " WHERE actor=? AND idempotency_key=?",
            (rs, n) -> Map.of("digest", rs.getString(1), "document", Json.read(rs.getString(2))),
            actor,
            idempotencyKey);
    return runs.isEmpty() ? null : runs.getFirst();
  }

  public void saveSqlImportRun(
      String id,
      String actor,
      String warehouseId,
      String idempotencyKey,
      String requestDigest,
      Map<String, Object> document) {
    jdbc.update(
        "INSERT INTO sql_import_run"
            + "(run_id,actor,warehouse_id,idempotency_key,request_digest,document)"
            + " VALUES (?,?,?,?,?,?::jsonb)",
        id,
        actor,
        warehouseId,
        idempotencyKey,
        requestDigest,
        Json.write(document));
  }

  public void updateWarehouse(Map<String, Object> doc, String reference) {
    jdbc.update(
        "UPDATE warehouse SET"
            + " document=?::jsonb,credential_reference=coalesce(?,credential_reference),updated_at=now()"
            + " WHERE id=?",
        Json.write(doc),
        reference,
        doc.get("warehouseId"));
  }

  public void updateImportCredential(String id, String reference) {
    jdbc.update(
        "UPDATE warehouse SET import_credential_reference=?, updated_at=now() WHERE id=?",
        reference,
        id);
  }

  public void updateImportWriter(String id, String username, String reference) {
    jdbc.update(
        "UPDATE warehouse SET import_username=?,import_credential_reference=?,updated_at=now()"
            + " WHERE id=?",
        username,
        reference,
        id);
  }

  public void ensureImportWriter(String id, String username, String reference) {
    jdbc.update(
        "UPDATE warehouse SET import_username=coalesce(import_username,?),"
            + "import_credential_reference=coalesce(import_credential_reference,?),"
            + "updated_at=now() WHERE id=?",
        username,
        reference,
        id);
  }

  public void updateIngestionCredential(String id, String username, String credentialReference) {
    jdbc.update(
        "UPDATE warehouse SET ingestion_username=?,ingestion_credential_reference=?,"
            + "updated_at=now() WHERE id=?",
        username,
        credentialReference,
        id);
  }

  public void ensureIngestionWriter(String id, String username, String credentialReference) {
    jdbc.update(
        "UPDATE warehouse SET ingestion_username=coalesce(ingestion_username,?),"
            + "ingestion_credential_reference=coalesce(ingestion_credential_reference,?),"
            + "updated_at=now() WHERE id=?",
        username,
        credentialReference,
        id);
  }

  public String ingestionUsername(String id) {
    return jdbc.queryForObject(
        "SELECT ingestion_username FROM warehouse WHERE id=?", String.class, id);
  }

  public String ingestionCredential(String id) {
    return jdbc.queryForObject(
        "SELECT ingestion_credential_reference FROM warehouse WHERE id=?", String.class, id);
  }

  public void insertIngestionSource(Map<String, Object> document) {
    jdbc.update(
        "INSERT INTO ingestion_source"
            + "(source_id,warehouse_id,dataset_id,source_warehouse_id,source_dataset_id,status,document)"
            + " VALUES (?,?,?,?,?,?,?::jsonb)",
        document.get("sourceId"),
        document.get("warehouseId"),
        document.get("datasetId"),
        document.get("sourceWarehouseId"),
        document.get("sourceDatasetId"),
        document.get("status"),
        Json.write(document));
  }

  public boolean ingestionSourceExists(String sourceId) {
    return jdbc.queryForObject(
            "SELECT count(*) FROM ingestion_source WHERE source_id=?", Integer.class, sourceId)
        > 0;
  }

  public void updateIngestionSource(Map<String, Object> document) {
    jdbc.update(
        "UPDATE ingestion_source SET warehouse_id=?,dataset_id=?,source_warehouse_id=?"
            + ",source_dataset_id=?,status=?,document=?::jsonb,updated_at=now() WHERE source_id=?",
        document.get("warehouseId"),
        document.get("datasetId"),
        document.get("sourceWarehouseId"),
        document.get("sourceDatasetId"),
        document.get("status"),
        Json.write(document),
        document.get("sourceId"));
  }

  public Map<String, Object> ingestionSource(String id) {
    var rows =
        jdbc.query(
            "SELECT document::text FROM ingestion_source WHERE source_id=?",
            (rs, n) -> Json.read(rs.getString(1)),
            id);
    if (rows.isEmpty()) throw ApiException.notFound();
    var source = rows.getFirst();
    authorize(Json.str(source, "warehouseId"));
    authorize(Json.str(source, "sourceWarehouseId"));
    return source;
  }

  public List<Map<String, Object>> ingestionSources() {
    return jdbc
        .query(
            "SELECT document::text FROM ingestion_source ORDER BY updated_at DESC,source_id",
            (rs, n) -> Json.read(rs.getString(1)))
        .stream()
        .filter(
            source -> {
              try {
                authorize(Json.str(source, "warehouseId"));
                authorize(Json.str(source, "sourceWarehouseId"));
                return true;
              } catch (ApiException e) {
                return false;
              }
            })
        .toList();
  }

  public String credential(String id) {
    return jdbc.queryForObject(
        "SELECT credential_reference FROM warehouse WHERE id=?", String.class, id);
  }

  public void insertDataset(Map<String, Object> doc, Map<String, Object> semantic) {
    jdbc.update(
        "INSERT INTO dataset(id,warehouse_id,document,semantic_model) VALUES"
            + " (?,?,?::jsonb,?::jsonb)",
        doc.get("datasetId"),
        doc.get("warehouseId"),
        Json.write(doc),
        Json.write(semantic));
  }

  public void updateDataset(Map<String, Object> doc, Map<String, Object> semantic) {
    jdbc.update(
        "UPDATE dataset SET document=?::jsonb,semantic_model=?::jsonb,updated_at=now() WHERE id=?",
        Json.write(doc),
        Json.write(semantic),
        doc.get("datasetId"));
  }

  public void putQuery(Map<String, Object> doc) {
    jdbc.update(
        "INSERT INTO query_history(id,warehouse_id,dataset_id,document) VALUES (?,?,?,?::jsonb) ON"
            + " CONFLICT(id) DO UPDATE SET document=excluded.document",
        doc.get("queryId"),
        doc.get("warehouseId"),
        doc.get("datasetId"),
        Json.write(doc));
  }

  public void run(String id, String kind, Map<String, Object> document) {
    jdbc.update(
        "INSERT INTO operation_run(id,kind,document) VALUES (?,?,?::jsonb) ON CONFLICT(id) DO"
            + " UPDATE SET document=excluded.document",
        id,
        kind,
        Json.write(document));
  }

  public Map<String, Object> run(String id, String kind) {
    var list =
        jdbc.query(
            "SELECT document::text FROM operation_run WHERE id=? AND kind=?",
            (rs, n) -> Json.read(rs.getString(1)),
            id,
            kind);
    if (list.isEmpty()) throw ApiException.notFound();
    var doc = list.getFirst();
    if (doc.get("warehouseId") != null) authorize(doc.get("warehouseId").toString());
    if (doc.get("sourceWarehouseId") != null) authorize(doc.get("sourceWarehouseId").toString());
    return doc;
  }

  public List<Map<String, Object>> runs(String kind) {
    return jdbc
        .query(
            "SELECT document::text FROM operation_run WHERE kind=? ORDER BY created_at DESC",
            (rs, n) -> Json.read(rs.getString(1)),
            kind)
        .stream()
        .filter(
            r -> {
              try {
                if (r.get("warehouseId") != null) authorize(r.get("warehouseId").toString());
                if (r.get("sourceWarehouseId") != null)
                  authorize(r.get("sourceWarehouseId").toString());
                return true;
              } catch (ApiException e) {
                return false;
              }
            })
        .toList();
  }

  public Map<String, Object> settings() {
    return Json.read(
        jdbc.queryForObject(
            "SELECT document::text FROM platform_settings WHERE id=1", String.class));
  }

  public void settings(Map<String, Object> doc) {
    jdbc.update("UPDATE platform_settings SET document=?::jsonb WHERE id=1", Json.write(doc));
  }

  public void audit(String action, String id) {
    jdbc.update(
        "INSERT INTO audit_event(actor,action,resource_id,correlation_id) VALUES (?,?,?,?)",
        actor(),
        action,
        id,
        Errors.correlation());
  }

  public void audit(String action, String id, Map<String, Object> details) {
    jdbc.update(
        "INSERT INTO audit_event(actor,action,resource_id,correlation_id,details)"
            + " VALUES (?,?,?,?,?::jsonb)",
        actor(),
        action,
        id,
        Errors.correlation(),
        Json.write(details));
  }

  public List<Map<String, Object>> warehouseAccess(String warehouseId) {
    return jdbc.query(
        "SELECT subject,warehouse_id FROM resource_access WHERE warehouse_id=? ORDER BY subject",
        (rs, row) -> Json.obj("subject", rs.getString(1), "warehouseId", rs.getString(2)),
        warehouseId);
  }

  public void grantWarehouseAccess(String warehouseId, String subject) {
    jdbc.update(
        "INSERT INTO resource_access(subject,warehouse_id) VALUES (?,?)"
            + " ON CONFLICT(subject,warehouse_id) DO NOTHING",
        subject,
        warehouseId);
  }

  public void revokeWarehouseAccess(String warehouseId, String subject) {
    jdbc.update(
        "DELETE FROM resource_access WHERE subject=? AND warehouse_id=?", subject, warehouseId);
  }

  private static void allowed(String table) {
    if (!Set.of("warehouse", "dataset", "query_history", "saved_result").contains(table))
      throw new IllegalArgumentException("Invalid metadata table");
  }
}

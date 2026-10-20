package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class SemanticPlannerClientTest {
  @Test
  void manifestContainsOnlyPhysicalMetadataAuthorizedByContext() {
    Map<String, Object> album = table("dbo", "Album", "INTEGER");
    Map<String, Object> artist = table("dbo", "Artist", "VARCHAR");
    List<Map<String, Object>> relationships =
        List.of(
            Json.obj(
                "from",
                Json.obj("table", Json.obj("schema", "dbo", "name", "Album"), "column", "ArtistId"),
                "to",
                Json.obj(
                    "table", Json.obj("schema", "dbo", "name", "Artist"), "column", "ArtistId"),
                "cardinality",
                "MANY_TO_ONE"));
    var context = Json.obj("tables", List.of(album, artist), "relationships", relationships);

    Map<String, Object> manifest = SemanticPlannerClient.manifest("SQL_SERVER", context);

    assertEquals("mssql", manifest.get("dataSource"));
    assertEquals("nla", manifest.get("catalog"));
    assertEquals("semantic", manifest.get("schema"));
    assertEquals(2, Json.objects(manifest.get("models")).size());
    assertEquals(1, Json.objects(manifest.get("relationships")).size());
    assertFalse(Json.write(manifest).toLowerCase(Locale.ROOT).contains("password"));
    assertTrue(Json.write(manifest).contains("dbo"));
  }

  @Test
  void ignoresRelationshipWhoseOtherTableIsOutsideAuthorizedContext() {
    Map<String, Object> album = table("public", "Album", "INTEGER");
    var relationship =
        Json.obj(
            "from",
            Json.obj("table", Json.obj("schema", "public", "name", "Album"), "column", "ArtistId"),
            "to",
            Json.obj("table", Json.obj("schema", "public", "name", "Artist"), "column", "ArtistId"),
            "cardinality",
            "MANY_TO_ONE");
    var context = Json.obj("tables", List.of(album), "relationships", List.of(relationship));

    Map<String, Object> manifest = SemanticPlannerClient.manifest("POSTGRESQL", context);

    assertTrue(Json.objects(manifest.get("relationships")).isEmpty());
    assertEquals(1, Json.objects(manifest.get("models")).size());
  }

  @Test
  void javaGuardAcceptsWrenRewritesAndRecoversPhysicalSource() {
    Map<String, String> sqlByEngine =
        Map.of(
            "POSTGRESQL",
            "WITH \"nla_model_0\" AS (SELECT 1 FROM (SELECT __source.\"AlbumId\" AS \"AlbumId\""
                + " FROM \"public\".\"Album\" AS __source) AS nla_model_0) SELECT COUNT(*) FROM"
                + " \"nla_model_0\"",
            "MYSQL",
            "WITH `nla_model_0` AS (SELECT 1 FROM (SELECT __source.`AlbumId` AS `AlbumId` FROM"
                + " public.`Album` AS __source) AS nla_model_0) SELECT COUNT(*) FROM `nla_model_0`",
            "SQL_SERVER",
            "WITH [nla_model_0] AS (SELECT 1 AS [1] FROM (SELECT __source.[AlbumId] AS [AlbumId]"
                + " FROM dbo.[Album] AS __source) AS nla_model_0) SELECT COUNT(*) FROM"
                + " [nla_model_0]");
    for (var entry : sqlByEngine.entrySet()) {
      String schema = entry.getKey().equals("SQL_SERVER") ? "dbo" : "public";
      List<Map<String, Object>> physical = List.of(table(schema, "Album", "INTEGER"));
      var result = new SqlGuard().validate(entry.getValue(), entry.getKey(), physical);
      assertEquals(List.of(Json.obj("schema", schema, "name", "Album")), result.sourceTables());
    }
  }

  private Map<String, Object> table(String schema, String name, String type) {
    return Json.obj(
        "schema",
        schema,
        "name",
        name,
        "primaryKey",
        List.of("Id"),
        "columns",
        List.of(
            Json.obj("name", "Id", "dataType", "INTEGER"),
            Json.obj("name", "ArtistId", "dataType", type)));
  }
}

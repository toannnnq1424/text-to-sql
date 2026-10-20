package dev.nla;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class SqlImportParserTest {
  @Test
  void previewSummarizesEveryCanonicalActionWithoutExposingLiteralValues() {
    var parsed =
        SqlImportParser.parse(
            "CREATE TABLE items (id INT PRIMARY KEY, note TEXT);"
                + "INSERT INTO items (id,note) VALUES (1,'private text');"
                + "CREATE INDEX items_note_idx ON items (note);",
            "POSTGRESQL",
            "nla_import");

    var preview = SqlImportService.previewStatements(parsed.steps());

    assertEquals(3, preview.size());
    assertEquals("CREATE_TABLE", preview.get(0).get("kind"));
    assertEquals("items", preview.get(0).get("objectName"));
    assertEquals("INSERT", preview.get(1).get("kind"));
    assertEquals("Insert 1 rows into items columns id, note.", preview.get(1).get("summary"));
    assertEquals("CREATE_INDEX", preview.get(2).get("kind"));
    assertEquals("items_note_idx", preview.get(2).get("objectName"));
    assertEquals(
        false,
        preview.stream().anyMatch(statement -> statement.toString().contains("private text")));
  }

  @Test
  void parsesSqlServerIdentityAndBoundInsertValues() {
    var result =
        SqlImportParser.parse(
            "CREATE TABLE [nla_import].[items] ([id] INT IDENTITY(1,1) PRIMARY KEY,"
                + " [name] NVARCHAR(50) NOT NULL);"
                + " INSERT INTO [nla_import].[items] ([name]) VALUES ('can''t run sql');",
            "AUTO_DETECT",
            "nla_import");

    assertEquals("SQL_SERVER", result.detectedDialect());
    assertEquals(2, result.steps().size());
    assertEquals("items", result.steps().getFirst().table());
    assertEquals("can't run sql", result.steps().getLast().rows().getFirst().getFirst());
  }

  @Test
  void parsesMySqlAndPostgreSqlWithExplicitDialect() {
    var mysql =
        SqlImportParser.parse(
            "CREATE TABLE `nla_import`.`items` (`id` BIGINT AUTO_INCREMENT PRIMARY KEY);",
            "AUTO_DETECT",
            "nla_import");
    var postgres =
        SqlImportParser.parse(
            "CREATE TABLE \"nla_import\".\"items\" (\"id\" BIGINT PRIMARY KEY);",
            "POSTGRESQL",
            "nla_import");

    assertEquals("MYSQL", mysql.detectedDialect());
    assertEquals("POSTGRESQL", postgres.detectedDialect());
  }

  @Test
  void rejectsWriteStatementsCommentsAndOutOfTargetObjects() {
    assertThrows(
        ApiException.class,
        () -> SqlImportParser.parse("DROP TABLE x;", "POSTGRESQL", "nla_import"));
    assertThrows(
        ApiException.class,
        () ->
            SqlImportParser.parse(
                "CREATE TABLE x (id INT); -- comment", "POSTGRESQL", "nla_import"));
    assertThrows(
        ApiException.class,
        () ->
            SqlImportParser.parse(
                "CREATE TABLE other.items (id INT);", "POSTGRESQL", "nla_import"));
  }

  @Test
  void rejectsAmbiguousDetectionAndDialectMismatch() {
    assertThrows(
        ApiException.class,
        () ->
            SqlImportParser.parse("CREATE TABLE items (id INTEGER);", "AUTO_DETECT", "nla_import"));
    assertThrows(
        ApiException.class,
        () ->
            SqlImportParser.parse("CREATE TABLE `items` (`id` INT);", "POSTGRESQL", "nla_import"));
  }

  @Test
  void preservesNullInsertLiteralsWithoutThrowing() {
    var result =
        SqlImportParser.parse(
            "CREATE TABLE `items` (`id` INT, `note` TEXT);"
                + " INSERT INTO `items` (`id`,`note`) VALUES (1,NULL);",
            "AUTO_DETECT",
            "nla_import");

    assertEquals(2, result.steps().size());
    assertEquals(null, result.steps().getLast().rows().getFirst().get(1));
  }

  @Test
  void dialectDetectionIgnoresStringLiteralContents() {
    var result =
        SqlImportParser.parse(
            "CREATE TABLE `items` (`note` TEXT DEFAULT 'SERIAL [IDENTITY]');",
            "AUTO_DETECT",
            "nla_import");

    assertEquals("MYSQL", result.detectedDialect());
  }

  @Test
  void preservesDecimalScaleAndExplicitDefaultNull() {
    var result =
        SqlImportParser.parse(
            "CREATE SCHEMA nla_import; CREATE TABLE x (id INT PRIMARY KEY, amount DECIMAL(18,3),"
                + " note TEXT DEFAULT NULL); INSERT INTO x (id,amount) VALUES (1,123.125);",
            "POSTGRESQL",
            "nla_import");
    assertEquals(3, result.steps().size());
    assertEquals("DECIMAL(18,3)", result.steps().get(1).columns().get(1).type());
    org.junit.jupiter.api.Assertions.assertTrue(
        result.steps().get(1).columns().get(2).hasDefault());
  }

  @Test
  void ordersCompositeForeignKeysAndIndexesAndRejectsCycles() {
    var result =
        SqlImportParser.parse(
            "CREATE TABLE child (a INT, b INT, CONSTRAINT fk_child FOREIGN KEY (a,b) REFERENCES"
                + " parent (a,b)); CREATE TABLE parent (a INT, b INT, CONSTRAINT pk_parent PRIMARY"
                + " KEY (a,b)); INSERT INTO child (a,b) VALUES (1,2); INSERT INTO parent (a,b)"
                + " VALUES (1,2); CREATE UNIQUE INDEX child_key ON child (a,b);",
            "POSTGRESQL",
            "nla_import");
    assertEquals("parent", result.steps().getFirst().table());
    assertEquals("parent", result.steps().get(2).table());
    assertEquals(SqlImportParser.Kind.CREATE_INDEX, result.steps().getLast().kind());
    assertThrows(
        ApiException.class,
        () ->
            SqlImportParser.parse(
                "CREATE TABLE a (id INT PRIMARY KEY, b INT REFERENCES b(id)); CREATE TABLE b (id"
                    + " INT PRIMARY KEY, a INT REFERENCES a(id));",
                "POSTGRESQL",
                "nla_import"));
  }

  @Test
  void rejectsUnsafeTypesDefaultsReferencesAndMalformedDimensions() {
    for (String sql :
        java.util.List.of(
            "CREATE TABLE x (id VARCHAR(99999999999999999999));",
            "CREATE TABLE x (id DECIMAL(38,39));",
            "CREATE TABLE x (id INT DEFAULT NULL NOT NULL);",
            "CREATE TABLE x (id DATE DEFAULT '2026-02-30');",
            "CREATE TABLE x (id INT DEFAULT current_user);",
            "CREATE TABLE x (id INT PRIMARY KEY, y INT REFERENCES public.secret(id));",
            "CREATE TABLE x (id INT, id INT);",
            "CREATE TABLE x (id INT); INSERT INTO x (id,id) VALUES (1,2);",
            "CREATE TABLE x (id DECIMAL(4,2)); INSERT INTO x (id) VALUES (999.999);",
            "CREATE TABLE x (t TIMESTAMP(2)); INSERT INTO x (t) VALUES ('2026-10-20"
                + " 01:02:03.123');"))
      assertThrows(
          ApiException.class, () -> SqlImportParser.parse(sql, "POSTGRESQL", "nla_import"), sql);
  }

  @Test
  void supportsGeneratedIdentityAndUnicodeStringButRejectsMixedDialect() {
    var result =
        SqlImportParser.parse(
            "CREATE TABLE x (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, note"
                + " VARCHAR(40)); INSERT INTO x (note) VALUES (N'Hỏi đáp');",
            "POSTGRESQL",
            "nla_import");
    assertEquals("BIGINT IDENTITY", result.steps().getFirst().columns().getFirst().type());
    assertEquals("Hỏi đáp", result.steps().getLast().rows().getFirst().getFirst());
    assertThrows(
        ApiException.class,
        () -> SqlImportParser.parse("CREATE TABLE `x` ([id] INT);", "MYSQL", "nla_import"));
  }

  @Test
  void persistedPlanRetainsFullDecimalPrecision() {
    var parsed =
        SqlImportParser.parse(
            "CREATE TABLE x (amount DECIMAL(38,6)); INSERT INTO x(amount) VALUES"
                + " (123456789012345678901234567890.123456);",
            "POSTGRESQL",
            "nla_import");
    var document = SqlImportExecutor.document(parsed.steps().getLast());
    var restored = Json.read(Json.write(document));
    Object value =
        ((java.util.List<?>) ((java.util.List<?>) restored.get("rows")).getFirst()).getFirst();
    assertEquals(new java.math.BigDecimal("123456789012345678901234567890.123456"), value);
  }
}

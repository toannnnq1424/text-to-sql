package dev.nla;

import java.math.BigDecimal;
import java.util.*;
import org.springframework.http.HttpStatus;

/** Value-only SQL grammar. Never delegates an uploaded statement to a database. */
final class SqlImportParser {
  enum Kind {
    CREATE_SCHEMA,
    CREATE_TABLE,
    INSERT,
    CREATE_INDEX
  }

  record Column(
      String name,
      String type,
      boolean nullable,
      boolean primaryKey,
      boolean unique,
      boolean hasDefault,
      Object defaultValue) {}

  record Constraint(
      String kind,
      String name,
      List<String> columns,
      String referenceSchema,
      String referenceTable,
      List<String> referenceColumns) {}

  record Step(
      int index,
      Kind kind,
      String schema,
      String table,
      List<Column> columns,
      List<Constraint> constraints,
      List<String> insertColumns,
      List<List<Object>> rows,
      String indexName,
      boolean uniqueIndex) {}

  record Result(String detectedDialect, List<Step> steps, List<String> warnings) {}

  private enum TokenType {
    WORD,
    IDENTIFIER,
    STRING,
    NUMBER,
    SYMBOL
  }

  private record Token(TokenType type, String value, char quote) {}

  private static final Set<String> RESERVED =
      Set.of(
          "CREATE",
          "SCHEMA",
          "TABLE",
          "INSERT",
          "INTO",
          "VALUES",
          "NULL",
          "NOT",
          "DEFAULT",
          "PRIMARY",
          "KEY",
          "UNIQUE",
          "CONSTRAINT",
          "FOREIGN",
          "REFERENCES",
          "INDEX",
          "ON",
          "BOOLEAN",
          "BOOL",
          "BIT",
          "SMALLINT",
          "INT",
          "INTEGER",
          "BIGINT",
          "DECIMAL",
          "NUMERIC",
          "FLOAT",
          "REAL",
          "DOUBLE",
          "VARCHAR",
          "CHAR",
          "TEXT",
          "NVARCHAR",
          "NCHAR",
          "DATE",
          "TIME",
          "TIMESTAMP",
          "DATETIME",
          "DATETIME2",
          "SERIAL",
          "BIGSERIAL",
          "IDENTITY",
          "AUTO_INCREMENT",
          "TRUE",
          "FALSE",
          "SELECT",
          "DROP",
          "ALTER",
          "EXEC",
          "CALL");
  private final List<Token> tokens;
  private final String dialect;
  private int position;
  private int valueCount;

  private SqlImportParser(List<Token> tokens, String dialect) {
    this.tokens = tokens;
    this.dialect = dialect;
  }

  static Result parse(String sql, String requestedDialect, String targetSchema) {
    if (sql == null || sql.isBlank() || sql.length() > 2 * 1024 * 1024)
      unsupported("File SQL rỗng hoặc vượt giới hạn 2 MiB.");
    List<Token> tokens = lex(sql);
    String detected = detect(tokens);
    if (detected.equals("MIXED")
        || (!requestedDialect.equals("AUTO_DETECT")
            && !detected.equals("AMBIGUOUS")
            && !requestedDialect.equals(detected)))
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "SQL_IMPORT_DIALECT_MISMATCH",
          "Cú pháp nguồn có dialect mâu thuẫn hoặc không khớp lựa chọn.");
    if (requestedDialect.equals("AUTO_DETECT") && detected.equals("AMBIGUOUS"))
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "SQL_IMPORT_DIALECT_MISMATCH",
          "Không thể nhận diện dialect duy nhất; hãy chọn dialect nguồn.");
    String resolved = detected.equals("AMBIGUOUS") ? requestedDialect : detected;
    var parser = new SqlImportParser(tokens, resolved);
    List<Step> original = parser.statements(targetSchema);
    if (original.stream().noneMatch(step -> step.kind() == Kind.CREATE_TABLE))
      unsupported("File phải khai báo ít nhất một bảng mới.");
    List<Step> ordered = validateAndOrder(original, targetSchema);
    List<String> warnings =
        original.equals(ordered)
            ? List.of()
            : List.of("Plan sắp bảng và INSERT theo phụ thuộc khóa ngoại; INDEX tạo sau dữ liệu.");
    return new Result(resolved, ordered, warnings);
  }

  private List<Step> statements(String schema) {
    List<Step> steps = new ArrayList<>();
    while (position < tokens.size()) {
      if (take(";")) continue;
      int index = steps.size() + 1;
      if (index > 1000) unsupported("Số câu lệnh vượt giới hạn 1000.");
      if (takeWord("CREATE")) {
        if (takeWord("SCHEMA")) {
          String name = identifier();
          if (!name.equals(schema)) unsupported("CREATE SCHEMA ngoài targetSchema.");
          steps.add(step(index, Kind.CREATE_SCHEMA, name, name));
        } else if (takeWord("TABLE")) {
          steps.add(createTable(index, schema));
        } else {
          boolean unique = takeWord("UNIQUE");
          expectWord("INDEX");
          String name = identifier();
          expectWord("ON");
          String[] object = qualifiedName(schema);
          steps.add(
              new Step(
                  index,
                  Kind.CREATE_INDEX,
                  object[0],
                  object[1],
                  List.of(),
                  List.of(),
                  columnList(),
                  List.of(),
                  name,
                  unique));
        }
      } else if (takeWord("INSERT")) {
        steps.add(insert(index, schema));
      } else unsupported("Chỉ hỗ trợ CREATE SCHEMA/TABLE/INDEX và INSERT VALUES.");
      if (position < tokens.size() && !take(";"))
        unsupported("Mỗi câu lệnh phải kết thúc bằng dấu chấm phẩy.");
    }
    return List.copyOf(steps);
  }

  private Step createTable(int index, String schema) {
    String[] object = qualifiedName(schema);
    expect("(");
    List<Column> columns = new ArrayList<>();
    List<Constraint> constraints = new ArrayList<>();
    do {
      String constraintName = takeWord("CONSTRAINT") ? identifier() : "";
      if (!constraintName.isEmpty()
          || peekWord("PRIMARY")
          || peekWord("UNIQUE")
          || peekWord("FOREIGN")) {
        constraints.add(constraint(constraintName, schema));
      } else {
        String name = identifier();
        String type = type();
        boolean identity = type.endsWith(" IDENTITY");
        boolean nullable = true, primary = false, unique = false, hasDefault = false;
        Object defaultValue = null;
        while (position < tokens.size() && !peek(",") && !peek(")")) {
          if (takeWord("NOT")) {
            expectWord("NULL");
            nullable = false;
          } else if (takeWord("NULL")) nullable = true;
          else if (takeWord("PRIMARY")) {
            expectWord("KEY");
            primary = true;
            nullable = false;
          } else if (takeWord("UNIQUE")) unique = true;
          else if (takeWord("DEFAULT")) {
            if (hasDefault) unsupported("DEFAULT bị lặp.");
            boolean wrapped = take("(");
            defaultValue = literal();
            if (wrapped) expect(")");
            hasDefault = true;
          } else if (takeWord("IDENTITY")) {
            identity = true;
            if (take("(")) {
              if (dimension(1, 1) != 1) unsupported("Chỉ hỗ trợ IDENTITY(1,1).");
              expect(",");
              dimension(1, 1);
              expect(")");
            }
          } else if (takeWord("AUTO_INCREMENT")) identity = true;
          else if (takeWord("GENERATED")) {
            expectWord("BY");
            expectWord("DEFAULT");
            expectWord("AS");
            expectWord("IDENTITY");
            identity = true;
          } else if (takeWord("REFERENCES")) {
            String[] reference = qualifiedName(schema);
            constraints.add(
                new Constraint(
                    "FOREIGN_KEY", "", List.of(name), reference[0], reference[1], columnList()));
          } else unsupported("Ràng buộc hoặc biểu thức cột chưa hỗ trợ.");
        }
        String base = type.replace(" IDENTITY", "");
        if (identity && (!Set.of("SMALLINT", "INTEGER", "BIGINT").contains(base) || hasDefault))
          unsupported("Identity chỉ áp dụng kiểu integer và không dùng cùng DEFAULT.");
        columns.add(
            new Column(
                name,
                base + (identity ? " IDENTITY" : ""),
                nullable,
                primary,
                unique,
                hasDefault,
                defaultValue));
        if (primary)
          constraints.add(new Constraint("PRIMARY_KEY", "", List.of(name), "", "", List.of()));
        if (unique) constraints.add(new Constraint("UNIQUE", "", List.of(name), "", "", List.of()));
        if (columns.size() > 500) unsupported("Bảng vượt giới hạn 500 cột.");
      }
    } while (take(","));
    expect(")");
    if (columns.isEmpty()) unsupported("Bảng phải có cột.");
    return new Step(
        index,
        Kind.CREATE_TABLE,
        object[0],
        object[1],
        List.copyOf(columns),
        List.copyOf(constraints),
        List.of(),
        List.of(),
        "",
        false);
  }

  private Constraint constraint(String name, String schema) {
    String kind;
    if (takeWord("PRIMARY")) {
      expectWord("KEY");
      kind = "PRIMARY_KEY";
    } else if (takeWord("UNIQUE")) {
      takeWord("KEY");
      kind = "UNIQUE";
    } else {
      expectWord("FOREIGN");
      expectWord("KEY");
      kind = "FOREIGN_KEY";
    }
    List<String> columns = columnList();
    if (!kind.equals("FOREIGN_KEY")) return new Constraint(kind, name, columns, "", "", List.of());
    expectWord("REFERENCES");
    String[] reference = qualifiedName(schema);
    return new Constraint(kind, name, columns, reference[0], reference[1], columnList());
  }

  private String type() {
    String type = word().toUpperCase(Locale.ROOT);
    if (type.equals("DOUBLE")) {
      takeWord("PRECISION");
      return "DOUBLE";
    }
    if (type.equals("SERIAL")) return "INTEGER IDENTITY";
    if (type.equals("BIGSERIAL")) return "BIGINT IDENTITY";
    if (type.equals("INT")) type = "INTEGER";
    if (type.equals("BOOL") || type.equals("BIT")) type = "BOOLEAN";
    if (type.equals("DATETIME") || type.equals("DATETIME2")) type = "TIMESTAMP";
    else if (type.equals("TIMESTAMP") && dialect.equals("SQL_SERVER"))
      unsupported("SQL Server TIMESTAMP là rowversion; dùng DATETIME2 cho thời gian.");
    if (type.equals("NVARCHAR")) type = "VARCHAR";
    if (type.equals("NCHAR")) type = "CHAR";
    if (Set.of("DECIMAL", "NUMERIC").contains(type)) {
      int precision = 18, scale = 0;
      if (take("(")) {
        precision = dimension(1, 38);
        if (take(",")) scale = dimension(0, Math.min(precision, 30));
        expect(")");
      }
      return "DECIMAL(" + precision + "," + scale + ")";
    }
    if (Set.of("VARCHAR", "CHAR").contains(type)) {
      int size = type.equals("CHAR") ? 1 : 255;
      if (take("(")) {
        size = dimension(1, 4000);
        expect(")");
      }
      return type + "(" + size + ")";
    }
    if (Set.of("TIME", "TIMESTAMP").contains(type)) {
      int precision = 6;
      if (take("(")) {
        precision = dimension(0, 7);
        expect(")");
      }
      return type + "(" + precision + ")";
    }
    if (!Set.of("SMALLINT", "INTEGER", "BIGINT", "FLOAT", "REAL", "BOOLEAN", "DATE", "TEXT")
        .contains(type)) unsupported("Kiểu dữ liệu chưa hỗ trợ.");
    return type;
  }

  private Step insert(int index, String schema) {
    expectWord("INTO");
    String[] object = qualifiedName(schema);
    List<String> columns = columnList();
    expectWord("VALUES");
    List<List<Object>> rows = new ArrayList<>();
    do {
      expect("(");
      List<Object> values = new ArrayList<>();
      do {
        values.add(literal());
        if (++valueCount > 100_000) unsupported("Tổng số giá trị vượt giới hạn 100000.");
      } while (take(","));
      expect(")");
      if (values.size() != columns.size()) unsupported("Số giá trị INSERT không khớp cột.");
      rows.add(Collections.unmodifiableList(values));
      if (rows.size() > 10_000) unsupported("INSERT vượt giới hạn 10000 dòng.");
    } while (take(","));
    return new Step(
        index,
        Kind.INSERT,
        object[0],
        object[1],
        List.of(),
        List.of(),
        columns,
        List.copyOf(rows),
        "",
        false);
  }

  private static List<Step> validateAndOrder(List<Step> steps, String schema) {
    Map<String, Step> tables = new LinkedHashMap<>();
    Set<String> objectNames = new HashSet<>();
    for (Step step : steps) {
      if (!step.schema().equals(schema)) unsupported("Câu lệnh ngoài targetSchema.");
      if (step.kind() == Kind.CREATE_TABLE) {
        if (!objectNames.add(step.table().toLowerCase(Locale.ROOT)))
          unsupported("Tên bảng bị trùng.");
        tables.put(step.table(), step);
        Set<String> columns = new HashSet<>();
        for (Column column : step.columns()) {
          if (!columns.add(column.name().toLowerCase(Locale.ROOT)))
            unsupported("Tên cột bị trùng.");
          if (column.hasDefault())
            validateValue(column, column.defaultValue(), column.primaryKey());
        }
        if (step.constraints().stream().filter(c -> c.kind().equals("PRIMARY_KEY")).count() > 1)
          unsupported("Chỉ có một PRIMARY KEY cho mỗi bảng.");
        if (step.columns().stream().filter(c -> c.type().endsWith(" IDENTITY")).count() > 1)
          unsupported("Chỉ có một identity column cho mỗi bảng.");
      }
    }
    Set<String> namedConstraints = new HashSet<>();
    for (Step step : steps) {
      if (step.kind() == Kind.CREATE_SCHEMA) continue;
      Step table = tables.get(step.table());
      if (table == null) unsupported("Chỉ được dùng bảng mới khai báo trong file.");
      Set<String> columns =
          table.columns().stream().map(Column::name).collect(java.util.stream.Collectors.toSet());
      if (!columns.containsAll(step.insertColumns())) unsupported("Tham chiếu cột chưa khai báo.");
      if (step.kind() == Kind.CREATE_INDEX
          && !namedConstraints.add(step.indexName().toLowerCase(Locale.ROOT)))
        unsupported("Tên INDEX bị trùng.");
      for (Constraint constraint : step.constraints()) {
        if (!columns.containsAll(constraint.columns()))
          unsupported("Constraint tham chiếu cột chưa khai báo.");
        if (!constraint.name().isBlank()
            && !namedConstraints.add(constraint.name().toLowerCase(Locale.ROOT)))
          unsupported("Tên constraint bị trùng.");
        if (constraint.kind().equals("FOREIGN_KEY")) {
          Step referenced = tables.get(constraint.referenceTable());
          if (!constraint.referenceSchema().equals(schema) || referenced == null)
            unsupported("FK chỉ tham chiếu bảng trong cùng import plan.");
          if (constraint.columns().size() != constraint.referenceColumns().size())
            unsupported("FK lệch số cột.");
          boolean key =
              referenced.constraints().stream()
                  .anyMatch(
                      c ->
                          !c.kind().equals("FOREIGN_KEY")
                              && c.columns().equals(constraint.referenceColumns()));
          if (!key) unsupported("FK phải tham chiếu PRIMARY KEY hoặc UNIQUE đã khai báo.");
          for (int i = 0; i < constraint.columns().size(); i++) {
            String localName = constraint.columns().get(i),
                remoteName = constraint.referenceColumns().get(i);
            String localType =
                table.columns().stream()
                    .filter(c -> c.name().equals(localName))
                    .findFirst()
                    .orElseThrow()
                    .type()
                    .replace(" IDENTITY", "");
            String remoteType =
                referenced.columns().stream()
                    .filter(c -> c.name().equals(remoteName))
                    .findFirst()
                    .orElseThrow()
                    .type()
                    .replace(" IDENTITY", "");
            if (!localType.equals(remoteType))
              unsupported("Kiểu cột FK phải khớp khóa được tham chiếu.");
          }
        }
      }
      if (step.kind() == Kind.INSERT) {
        for (List<Object> row : step.rows()) {
          for (Column column : table.columns()) {
            int at = step.insertColumns().indexOf(column.name());
            boolean primary =
                table.constraints().stream()
                    .anyMatch(
                        c -> c.kind().equals("PRIMARY_KEY") && c.columns().contains(column.name()));
            if (at < 0) {
              if ((!column.nullable() || primary)
                  && !column.hasDefault()
                  && !column.type().endsWith(" IDENTITY"))
                unsupported("INSERT thiếu cột bắt buộc.");
            } else validateValue(column, row.get(at), primary);
          }
        }
      }
    }
    List<Step> orderedTables = new ArrayList<>();
    Set<String> visiting = new HashSet<>(), visited = new HashSet<>();
    for (Step table : tables.values()) order(table, tables, visiting, visited, orderedTables);
    List<Step> ordered =
        new ArrayList<>(steps.stream().filter(s -> s.kind() == Kind.CREATE_SCHEMA).toList());
    ordered.addAll(orderedTables);
    for (Step table : orderedTables)
      ordered.addAll(
          steps.stream()
              .filter(s -> s.kind() == Kind.INSERT && s.table().equals(table.table()))
              .toList());
    ordered.addAll(steps.stream().filter(s -> s.kind() == Kind.CREATE_INDEX).toList());
    return List.copyOf(ordered);
  }

  static void validateValue(Column column, Object value, boolean primary) {
    if (value == null) {
      if (!column.nullable() || primary) unsupported("NULL không hợp lệ cho cột bắt buộc.");
      return;
    }
    String type = column.type().replace(" IDENTITY", "");
    try {
      if (Set.of("SMALLINT", "INTEGER", "BIGINT").contains(type)) {
        if (!(value instanceof Number)) unsupported("Cột integer yêu cầu literal số.");
        BigDecimal number = new BigDecimal(value.toString());
        if (type.equals("SMALLINT")) number.shortValueExact();
        else if (type.equals("INTEGER")) number.intValueExact();
        else number.longValueExact();
      } else if (type.startsWith("DECIMAL")) {
        if (!(value instanceof Number)) unsupported("Cột decimal yêu cầu literal số.");
        String[] parts = type.substring(type.indexOf('(') + 1, type.indexOf(')')).split(",");
        int precision = Integer.parseInt(parts[0]), scale = Integer.parseInt(parts[1]);
        BigDecimal number =
            new BigDecimal(value.toString()).setScale(scale, java.math.RoundingMode.UNNECESSARY);
        if (number.precision() > precision) unsupported("Literal decimal vượt precision/scale.");
      } else if (Set.of("FLOAT", "REAL", "DOUBLE").contains(type)) {
        if (!(value instanceof Number) || !Double.isFinite(((Number) value).doubleValue()))
          unsupported("Literal float không hợp lệ.");
      } else if (type.equals("BOOLEAN")) {
        if (!(value instanceof Boolean)
            && !(value instanceof Number
                && (new BigDecimal(value.toString()).compareTo(BigDecimal.ZERO) == 0
                    || new BigDecimal(value.toString()).compareTo(BigDecimal.ONE) == 0)))
          unsupported("BOOLEAN chỉ nhận TRUE/FALSE hoặc 0/1.");
      } else if (type.equals("DATE")) {
        if (!(value instanceof String)) unsupported("DATE cần ISO date literal.");
        java.time.LocalDate.parse(value.toString());
      } else if (type.startsWith("TIMESTAMP")) {
        if (!(value instanceof String)) unsupported("TIMESTAMP cần local ISO timestamp literal.");
        checkTimePrecision(
            type, java.time.LocalDateTime.parse(value.toString().replace(' ', 'T')).getNano());
      } else if (type.startsWith("TIME(")) {
        if (!(value instanceof String)) unsupported("TIME cần ISO time literal.");
        checkTimePrecision(type, java.time.LocalTime.parse(value.toString()).getNano());
      } else {
        if (!(value instanceof String)) unsupported("Cột text yêu cầu string literal.");
        if (!type.equals("TEXT")) {
          int max = Integer.parseInt(type.substring(type.indexOf('(') + 1, type.indexOf(')')));
          if (value.toString().codePointCount(0, value.toString().length()) > max)
            unsupported("String vượt độ dài cột.");
        }
      }
    } catch (ArithmeticException | java.time.DateTimeException | NumberFormatException e) {
      unsupported("Literal không tương thích kiểu dữ liệu hoặc vượt giới hạn.");
    }
  }

  private static void checkTimePrecision(String type, int nanos) {
    int precision = Integer.parseInt(type.substring(type.indexOf('(') + 1, type.indexOf(')')));
    if (nanos % (int) Math.pow(10, 9 - precision) != 0)
      unsupported("Literal thời gian vượt precision đã khai báo.");
  }

  private static void order(
      Step table,
      Map<String, Step> tables,
      Set<String> visiting,
      Set<String> visited,
      List<Step> result) {
    if (visited.contains(table.table())) return;
    if (!visiting.add(table.table()))
      unsupported("FK cycle nhiều bảng chưa hỗ trợ; cần plan không có chu kỳ.");
    for (Constraint constraint : table.constraints())
      if (constraint.kind().equals("FOREIGN_KEY")
          && !constraint.referenceTable().equals(table.table()))
        order(tables.get(constraint.referenceTable()), tables, visiting, visited, result);
    visiting.remove(table.table());
    visited.add(table.table());
    result.add(table);
  }

  private static Step step(int index, Kind kind, String schema, String table) {
    return new Step(
        index, kind, schema, table, List.of(), List.of(), List.of(), List.of(), "", false);
  }

  private List<String> columnList() {
    expect("(");
    List<String> columns = new ArrayList<>();
    do {
      columns.add(identifier());
    } while (take(","));
    expect(")");
    if (new HashSet<>(columns).size() != columns.size()) unsupported("Danh sách cột bị trùng.");
    return List.copyOf(columns);
  }

  private String[] qualifiedName(String schema) {
    String first = identifier();
    return take(".") ? new String[] {first, identifier()} : new String[] {schema, first};
  }

  private Object literal() {
    Token token = current();
    position++;
    if (token.type() == TokenType.STRING) return token.value();
    if (token.type() == TokenType.WORD) {
      if (token.value().equalsIgnoreCase("NULL")) return null;
      if (token.value().equalsIgnoreCase("TRUE")) return true;
      if (token.value().equalsIgnoreCase("FALSE")) return false;
    }
    if (token.type() == TokenType.NUMBER) {
      try {
        return new BigDecimal(token.value());
      } catch (NumberFormatException e) {
        unsupported("Literal số không hợp lệ.");
      }
    }
    unsupported("Chỉ hỗ trợ string, number, boolean hoặc NULL literal.");
    return null;
  }

  private String identifier() {
    Token token = current();
    if (!(token.type() == TokenType.IDENTIFIER || token.type() == TokenType.WORD)
        || (token.type() == TokenType.WORD
            && RESERVED.contains(token.value().toUpperCase(Locale.ROOT)))
        || !token.value().matches("[\\p{L}_][\\p{L}\\p{N}_$]{0,127}"))
      unsupported("Tên định danh không hợp lệ.");
    position++;
    return token.value();
  }

  private String word() {
    Token token = current();
    if (token.type() != TokenType.WORD) unsupported("Thiếu kiểu dữ liệu.");
    position++;
    return token.value();
  }

  private int dimension(int min, int max) {
    Token token = current();
    if (token.type() != TokenType.NUMBER || !token.value().matches("[0-9]{1,5}"))
      unsupported("Kích thước không hợp lệ.");
    position++;
    int value = Integer.parseInt(token.value());
    if (value < min || value > max) unsupported("Kích thước vượt giới hạn.");
    return value;
  }

  private void expect(String value) {
    if (!take(value)) unsupported("Thiếu dấu phân cách SQL.");
  }

  private void expectWord(String value) {
    if (!takeWord(value)) unsupported("Thiếu từ khóa SQL.");
  }

  private boolean take(String value) {
    if (!peek(value)) return false;
    position++;
    return true;
  }

  private boolean takeWord(String value) {
    if (!peekWord(value)) return false;
    position++;
    return true;
  }

  private boolean peekWord(String value) {
    return position < tokens.size()
        && tokens.get(position).type() == TokenType.WORD
        && tokens.get(position).value().equalsIgnoreCase(value);
  }

  private boolean peek(String value) {
    return position < tokens.size()
        && tokens.get(position).type() == TokenType.SYMBOL
        && tokens.get(position).value().equals(value);
  }

  private Token current() {
    if (position >= tokens.size()) unsupported("Cú pháp SQL bị thiếu.");
    return tokens.get(position);
  }

  private static String detect(List<Token> tokens) {
    Set<String> dialects = new HashSet<>();
    for (Token token : tokens) {
      if (token.type() == TokenType.IDENTIFIER) {
        if (token.quote() == '`') dialects.add("MYSQL");
        if (token.quote() == '[') dialects.add("SQL_SERVER");
      } else if (token.type() == TokenType.WORD) {
        String word = token.value().toUpperCase(Locale.ROOT);
        if (Set.of("SERIAL", "BIGSERIAL", "GENERATED").contains(word)) dialects.add("POSTGRESQL");
        if (word.equals("DATETIME2")
            || (word.equals("IDENTITY")
                && !tokens.stream()
                    .anyMatch(
                        t ->
                            t.type() == TokenType.WORD && t.value().equalsIgnoreCase("GENERATED"))))
          dialects.add("SQL_SERVER");
        if (Set.of("AUTO_INCREMENT", "UNSIGNED", "ENGINE").contains(word)) dialects.add("MYSQL");
      }
    }
    return dialects.size() > 1
        ? "MIXED"
        : dialects.isEmpty() ? "AMBIGUOUS" : dialects.iterator().next();
  }

  private static List<Token> lex(String sql) {
    List<Token> out = new ArrayList<>();
    for (int i = 0; i < sql.length(); ) {
      char c = sql.charAt(i);
      if (Character.isWhitespace(c) || (i == 0 && c == '\uFEFF')) {
        i++;
        continue;
      }
      if ((c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-')
          || (c == '/' && i + 1 < sql.length() && sql.charAt(i + 1) == '*'))
        unsupported("SQL comments chưa hỗ trợ.");
      if ((c == 'N' || c == 'n') && i + 1 < sql.length() && sql.charAt(i + 1) == '\'') {
        i++;
        c = '\'';
      }
      if (c == '\'' || c == '"' || c == '`' || c == '[') {
        char end = c == '[' ? ']' : c;
        StringBuilder value = new StringBuilder();
        i++;
        boolean closed = false;
        while (i < sql.length()) {
          char next = sql.charAt(i++);
          if (next == end && i < sql.length() && sql.charAt(i) == end) {
            value.append(end);
            i++;
          } else if (next == end) {
            closed = true;
            break;
          } else value.append(next);
        }
        if (!closed) unsupported("SQL quote chưa đóng.");
        out.add(
            new Token(c == '\'' ? TokenType.STRING : TokenType.IDENTIFIER, value.toString(), c));
      } else if (Character.isDigit(c)
          || ((c == '-' || c == '+')
              && i + 1 < sql.length()
              && Character.isDigit(sql.charAt(i + 1)))) {
        int start = i++;
        while (i < sql.length() && (Character.isDigit(sql.charAt(i)) || sql.charAt(i) == '.')) i++;
        out.add(new Token(TokenType.NUMBER, sql.substring(start, i), '\0'));
      } else if (Character.isLetter(c) || c == '_') {
        int start = i++;
        while (i < sql.length()
            && (Character.isLetterOrDigit(sql.charAt(i))
                || sql.charAt(i) == '_'
                || sql.charAt(i) == '$')) i++;
        out.add(new Token(TokenType.WORD, sql.substring(start, i), '\0'));
      } else if ("(),.;".indexOf(c) >= 0) {
        out.add(new Token(TokenType.SYMBOL, Character.toString(c), '\0'));
        i++;
      } else unsupported("Ký tự/cú pháp SQL chưa hỗ trợ.");
    }
    return List.copyOf(out);
  }

  private static void unsupported(String message) {
    throw new ApiException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_IMPORT_FEATURE", message);
  }
}

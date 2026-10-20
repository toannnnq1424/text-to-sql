package dev.nla;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.*;
import java.util.*;

/** Canonical file values never become SQL literals. */
final class FileTypes {
  static final Set<String> TYPES =
      Set.of("STRING", "BIGINT", "DECIMAL", "BOOLEAN", "DATE", "TIMESTAMP");

  static String hash(String text) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static Object convert(Object value, Map<String, Object> column) {
    String type = Json.str(column, "dataType");
    if (value == null || (!type.equals("STRING") && value.toString().isEmpty())) {
      if (Boolean.FALSE.equals(column.get("nullable")))
        throw new IllegalArgumentException("Null not allowed");
      return null;
    }
    String text = value.toString();
    if (text.length() > 16384 || text.indexOf('\0') >= 0)
      throw new IllegalArgumentException("Cell limit");
    return switch (type) {
      case "STRING" -> text;
      case "BIGINT" -> Long.valueOf(text);
      case "DECIMAL" -> {
        BigDecimal number = new BigDecimal(text).setScale(10, java.math.RoundingMode.UNNECESSARY);
        if (number.precision() > 38) throw new IllegalArgumentException("Decimal precision");
        yield number;
      }
      case "BOOLEAN" -> {
        if (!Set.of("true", "false", "1", "0").contains(text.toLowerCase(Locale.ROOT)))
          throw new IllegalArgumentException("Boolean value");
        yield text.equalsIgnoreCase("true") || text.equals("1");
      }
      case "DATE" -> {
        LocalDate date = LocalDate.parse(text);
        if (date.getYear() < 1000 || date.getYear() > 9999)
          throw new IllegalArgumentException("Date range");
        yield date;
      }
      case "TIMESTAMP" -> {
        String normalized = text.replace(' ', 'T');
        LocalDateTime time;
        if (normalized.length() == 10) time = LocalDate.parse(normalized).atStartOfDay();
        else {
          try {
            time =
                OffsetDateTime.parse(normalized)
                    .withOffsetSameInstant(ZoneOffset.UTC)
                    .toLocalDateTime();
          } catch (java.time.format.DateTimeParseException noOffset) {
            time = LocalDateTime.parse(normalized);
          }
        }
        if (time.getYear() < 1000 || time.getYear() > 9999 || time.getNano() % 1000 != 0)
          throw new IllegalArgumentException("Timestamp range/precision");
        yield time;
      }
      default -> throw new IllegalArgumentException("Unsupported type");
    };
  }

  static String sqlType(String type, String engine) {
    return switch (type) {
      case "STRING" ->
          engine.equals("MYSQL")
              ? "LONGTEXT"
              : engine.equals("SQL_SERVER") ? "NVARCHAR(MAX)" : "TEXT";
      case "DECIMAL" -> "DECIMAL(38,10)";
      case "BOOLEAN" -> engine.equals("SQL_SERVER") ? "BIT" : "BOOLEAN";
      case "TIMESTAMP" ->
          engine.equals("MYSQL")
              ? "DATETIME(6)"
              : engine.equals("SQL_SERVER") ? "DATETIME2(6)" : "TIMESTAMP(6)";
      case "DATE", "BIGINT" -> type;
      default -> throw new IllegalArgumentException("Unsupported type");
    };
  }

  static void bind(PreparedStatement statement, int index, Object value) throws SQLException {
    if (value == null) statement.setObject(index, null);
    else if (value instanceof LocalDate date) statement.setDate(index, java.sql.Date.valueOf(date));
    else if (value instanceof LocalDateTime time)
      statement.setTimestamp(index, java.sql.Timestamp.valueOf(time));
    else statement.setObject(index, value);
  }
}

package dev.nla.warehouse;
public final class SqlServerDialect implements SqlDialect {
 public String name(){return "SQL_SERVER";}public String quoteIdentifier(String value){return "["+value.replace("]","]]")+"]";}
 // JDBC maxRows bounds the original SELECT, retaining SQL Server ORDER BY semantics.
 public String applySafeLimit(String sql,int rows){if(rows<1)throw new IllegalArgumentException();return sql;}
 public String monthExpression(String e){return "DATEFROMPARTS(YEAR("+e+"), MONTH("+e+"), 1)";}public String castText(String e){return "CAST("+e+" AS NVARCHAR(MAX))";}public String booleanLiteral(boolean value){return value?"1":"0";}
}

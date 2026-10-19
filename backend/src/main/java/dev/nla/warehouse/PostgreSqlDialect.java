package dev.nla.warehouse;
public final class PostgreSqlDialect implements SqlDialect {
 public String name(){return "POSTGRESQL";}public String quoteIdentifier(String value){return "\""+value.replace("\"","\"\"")+"\"";}
 public String applySafeLimit(String sql,int rows){if(rows<1)throw new IllegalArgumentException();return "SELECT * FROM ("+sql+") AS nla_bounded LIMIT "+rows;}
 public String monthExpression(String e){return "DATE_TRUNC('month', "+e+")";}public String castText(String e){return "CAST("+e+" AS TEXT)";}public String booleanLiteral(boolean value){return value?"TRUE":"FALSE";}
}

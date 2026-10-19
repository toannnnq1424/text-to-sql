package dev.nla.warehouse;
public interface SqlDialect {
 String name();String quoteIdentifier(String identifier);String applySafeLimit(String sql,int maxRows);String monthExpression(String expression);String castText(String expression);String booleanLiteral(boolean value);
}

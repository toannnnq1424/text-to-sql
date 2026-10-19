import { describe, expect, it } from "vitest";
import { formatSqlForDisplay } from "./sqlDisplay";

describe("formatSqlForDisplay", () => {
  it("adds readable clauses and projection lines without changing literals", () => {
    const sql =
      "SELECT r.region_name, SUM(o.total_amount) AS revenue FROM orders o JOIN regions r ON o.region_id = r.region_id WHERE o.order_date >= '2024-09-01' AND o.order_date < '2024-10-01' GROUP BY r.region_name ORDER BY revenue DESC;";
    expect(formatSqlForDisplay(sql)).toBe(
      "SELECT\n    r.region_name,\n    SUM(o.total_amount) AS revenue\nFROM orders o\nJOIN regions r ON o.region_id = r.region_id\nWHERE o.order_date >= '2024-09-01'\n    AND o.order_date < '2024-10-01'\nGROUP BY r.region_name\nORDER BY revenue DESC;",
    );
  });

  it("does not break commas inside function arguments, quoted strings, or nested expressions", () => {
    const sql =
      "SELECT COALESCE(name, 'A, B') AS label, COUNT(*) AS total FROM tracks WHERE (name = 'x, y' OR name = 'z')";
    const display = formatSqlForDisplay(sql);
    expect(display).toContain("COALESCE(name, 'A, B') AS label,");
    expect(display).toContain("WHERE (name = 'x, y' OR name = 'z')");
    expect(display.split("\n")).toHaveLength(5);
  });

  it("preserves existing multiline SQL unchanged", () => {
    const sql = "SELECT\n  id\nFROM tracks";
    expect(formatSqlForDisplay(sql)).toBe(sql);
  });

  it("keeps SELECT modifiers together and separates top-level clauses", () => {
    expect(formatSqlForDisplay("SELECT DISTINCT region FROM sales")).toBe(
      "SELECT DISTINCT\n    region\nFROM sales",
    );
  });
});

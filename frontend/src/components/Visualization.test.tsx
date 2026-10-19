import { describe, it, expect } from "vitest";
import { validateChart } from "./Visualization";
import * as f from "../test/fixtures";
describe("chart allowlist and field validation", () => {
  it("accepts a real dimension + metric", () =>
    expect(validateChart(f.query.chart, f.query.result!).spec.type).toBe(
      "bar",
    ));
  it.each([
    { type: "javascript", code: "alert(1)" },
    { ...f.query.chart, x: "missing" },
    { ...f.query.chart, series: [{ column: "region", label: "text" }] },
  ])("falls back to a table for unsafe or invalid chart metadata", (spec) =>
    expect(validateChart(spec, f.query.result!).spec.type).toBe("table"),
  );
  it("requires one scalar for number and a time dimension for trends", () => {
    expect(
      validateChart({ ...f.query.chart, type: "number" }, f.query.result!).spec
        .type,
    ).toBe("table");
    expect(
      validateChart({ ...f.query.chart, type: "line" }, f.query.result!).spec
        .type,
    ).toBe("table");
  });
  it("rejects mixed units and unsafe integer chart coercion", () => {
    const result = {
      ...f.query.result!,
      columns: [
        ...f.query.result!.columns,
        {
          name: "orders",
          label: "Orders",
          dataType: "INTEGER" as const,
          semanticRole: "METRIC" as const,
          unit: "count",
        },
      ],
      rows: [{ region: "A", total_revenue: "1", orders: 2 }],
    };
    expect(
      validateChart(
        {
          ...f.query.chart,
          series: [
            ...f.query.chart!.series,
            { column: "orders", label: "orders" },
          ],
        },
        result,
      ).spec.type,
    ).toBe("table");
    expect(
      validateChart(f.query.chart, {
        ...f.query.result!,
        rows: [{ region: "A", total_revenue: "900719925474099300" }],
      }).spec.type,
    ).toBe("table");
  });
  it("rejects negative pie values and empty results", () => {
    expect(
      validateChart(
        { ...f.query.chart, type: "pie" },
        { ...f.query.result!, rows: [{ region: "A", total_revenue: "-1" }] },
      ).spec.type,
    ).toBe("table");
    expect(
      validateChart(f.query.chart, {
        ...f.query.result!,
        rows: [],
        returnedRowCount: 0,
      }).spec.type,
    ).toBe("table");
  });
});

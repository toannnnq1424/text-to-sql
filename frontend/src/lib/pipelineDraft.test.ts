import { describe, expect, it } from "vitest";
import { mappingReference, passThroughTransform } from "./pipelineDraft";

describe("pipeline mapping defaults", () => {
  it("quotes physical identifiers according to the target dialect", () => {
    expect(mappingReference('Order "Date"', "POSTGRESQL")).toBe(
      'input."Order ""Date"""',
    );
    expect(mappingReference("order`date", "MYSQL")).toBe("input.`order``date`");
    expect(mappingReference("Order]Date", "SQL_SERVER")).toBe(
      "input.[Order]]Date]",
    );
  });
  it("preserves source references while creating unique portable output aliases", () => {
    const transform = passThroughTransform(
      ["Order Date", "Order_Date", "order_date", "2026", "a".repeat(70)],
      "POSTGRESQL",
    );
    expect(transform.columns.map((column) => column.name)).toEqual([
      "Order_Date",
      "Order_Date_1",
      "order_date_2",
      "column_2026",
      "a".repeat(63),
    ]);
    expect(transform.columns[0].expression).toBe('input."Order Date"');
    expect(transform.filter).toBe("");
    expect(transform.groupBy).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { formatValue, formatDate, utcDateRange } from "./format";
import {
  QuerySchema,
  ResultSchema,
  QueryRequestSchema,
  EngineSchema,
  WarehouseInputSchema,
} from "../api/schema";
import * as f from "../test/fixtures";
describe("precision and contract boundaries", () => {
  it("preserves decimal digits beyond floating point precision", () =>
    expect(
      formatValue("9007199254740993.123456789", {
        name: "x",
        label: "x",
        dataType: "DECIMAL",
        semanticRole: "METRIC",
      }),
    ).toBe("9.007.199.254.740.993,123456789"));
  it.each([null, true, false, "<script>alert(1)</script>"])(
    "formats %s as text",
    (v) => expect(typeof formatValue(v)).toBe("string"),
  );
  it("requires DECIMAL/BIGINT strings and unique aliases", () => {
    expect(
      ResultSchema.safeParse({
        ...f.query.result,
        rows: [{ region: "A", total_revenue: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ResultSchema.safeParse({
        ...f.query.result,
        columns: [f.query.result!.columns[0], f.query.result!.columns[0]],
      }).success,
    ).toBe(false);
  });
  it("rejects rendering thousands of rows in one page", () =>
    expect(
      ResultSchema.safeParse({
        ...f.query.result,
        rows: Array.from({ length: 1001 }, () => f.query.result!.rows[0]),
        pageSize: 1001,
      }).success,
    ).toBe(false));
  it.each(["POSTGRESQL", "MYSQL", "SQL_SERVER"])(
    "accepts canonical %s",
    (engine) => expect(EngineSchema.parse(engine)).toBe(engine),
  );
  it("accepts the shared public query fixture", () =>
    expect(QuerySchema.safeParse(f.query).success).toBe(true));
  it("requires an actual question and rejects injected request fields", () => {
    expect(
      QueryRequestSchema.safeParse({
        warehouseId: "w",
        datasetId: "d",
        question: "  ",
      }).success,
    ).toBe(false);
    expect(
      QueryRequestSchema.safeParse({
        warehouseId: "w",
        datasetId: "d",
        question: "test",
        sql: "SELECT 1",
      }).success,
    ).toBe(false);
    expect(
      QueryRequestSchema.safeParse({
        warehouseId: "w",
        datasetId: "d",
        question: "a".repeat(1001),
      }).success,
    ).toBe(false);
  });
  it("counts Unicode codepoints instead of UTF-16 units", () =>
    expect(
      QueryRequestSchema.safeParse({
        warehouseId: "w",
        datasetId: "d",
        question: "😀".repeat(1000),
      }).success,
    ).toBe(true));
  it("builds an inclusive local date range as exclusive UTC bounds", () => {
    expect(utcDateRange("2026-10-19", "2026-10-19")).toEqual({
      from: "2026-10-18T17:00:00.000Z",
      to: "2026-10-19T17:00:00.000Z",
    });
    expect(() => utcDateRange("2026-10-20", "2026-10-19")).toThrow();
  });
  it("does not format null timestamps as the Unix epoch", () =>
    expect(formatDate(null)).toBe("—"));
  it("validates warehouse connection fields without asking for a secret password", () => {
    const input = {
      name: "Warehouse",
      engine: "MYSQL",
      host: "mysql",
      port: 3306,
      database: "analytics",
      defaultSchema: null,
      username: "reader",
      credentialReference: "warehouse/mysql",
    };
    expect(WarehouseInputSchema.safeParse(input).success).toBe(true);
    expect(
      WarehouseInputSchema.safeParse({
        ...input,
        host: "https://untrusted.example/path",
      }).success,
    ).toBe(false);
    expect(
      WarehouseInputSchema.safeParse({ ...input, port: 65536 }).success,
    ).toBe(false);
  });
});

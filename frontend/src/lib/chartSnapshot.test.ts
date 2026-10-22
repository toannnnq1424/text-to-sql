import { afterEach, describe, expect, it, vi } from "vitest";
import { queryApi } from "../api/queryApi";
import type { QueryResult } from "../api/schema";
import { loadChartSnapshot } from "./chartSnapshot";

afterEach(() => vi.restoreAllMocks());
const columns: QueryResult["columns"] = [
  {
    name: "country",
    label: "Country",
    dataType: "STRING",
    semanticRole: "DIMENSION",
  },
  {
    name: "amount",
    label: "Amount",
    dataType: "DECIMAL",
    semanticRole: "METRIC",
  },
];
function result(count: number, start = 0, size = 20): QueryResult {
  return {
    columns,
    returnedRowCount: count,
    rows: Array.from({ length: Math.min(size, count - start) }, (_, i) => ({
      country: "Group " + (start + i),
      amount: String(start + i),
    })),
    page: Math.floor(start / 100) + 1,
    pageSize: 100,
    truncated: false,
  };
}
describe("complete chart snapshot", () => {
  it("includes groups beyond the initial preview without generating a query again", async () => {
    const pages = vi
      .spyOn(queryApi, "result")
      .mockResolvedValueOnce(result(124, 0, 100))
      .mockResolvedValueOnce(result(124, 100, 24));
    const generation = vi.spyOn(queryApi, "run");
    const signal = new AbortController().signal;
    const actual = await loadChartSnapshot(
      "query-real-pages",
      result(124),
      signal,
    );
    expect(actual.rows).toHaveLength(124);
    expect(actual.rows.at(-1)?.country).toBe("Group 123");
    expect(pages).toHaveBeenNthCalledWith(
      2,
      "query-real-pages",
      { page: 2, pageSize: 100 },
      signal,
    );
    expect(generation).not.toHaveBeenCalled();
  });
  it("fails on a later-page error instead of returning a partial chart", async () => {
    vi.spyOn(queryApi, "result")
      .mockResolvedValueOnce(result(124, 0, 100))
      .mockRejectedValueOnce(new Error("Stored result expired"));
    await expect(loadChartSnapshot("expired", result(124))).rejects.toThrow(
      "expired",
    );
  });
  it("rejects inconsistent empty pages rather than looping or silently omitting rows", async () => {
    vi.spyOn(queryApi, "result").mockResolvedValueOnce(result(124, 0, 0));
    await expect(
      loadChartSnapshot("inconsistent", result(124)),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });
  it("bounds plotted rows while preserving the full snapshot count", async () => {
    const pages = vi
      .spyOn(queryApi, "result")
      .mockImplementation(async (_id, params) =>
        result(1500, (Number(params?.page) - 1) * 100, 100),
      );
    const actual = await loadChartSnapshot("bounded", result(1500));
    expect(pages).toHaveBeenCalledTimes(10);
    expect(actual.rows).toHaveLength(1000);
    expect(actual.returnedRowCount).toBe(1500);
  });
  it("preserves exact scalar and complete results without requesting pages", async () => {
    const pages = vi.spyOn(queryApi, "result");
    const initial = result(1);
    expect(await loadChartSnapshot("scalar", initial)).toEqual(initial);
    expect(pages).not.toHaveBeenCalled();
  });
  it("rejects incomplete nonempty pages and oversized complete data", async () => {
    vi.spyOn(queryApi, "result").mockResolvedValueOnce(result(124, 0, 20));
    await expect(
      loadChartSnapshot("incomplete-page", result(124)),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
    const huge = result(1);
    huge.rows[0].country = "x".repeat(5 * 1024 * 1024);
    await expect(loadChartSnapshot("oversized", huge)).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });
});

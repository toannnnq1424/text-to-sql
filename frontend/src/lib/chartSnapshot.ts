import { ApiError } from "../api/client";
import { queryApi } from "../api/queryApi";
import type { QueryResult } from "../api/schema";

const chartRowBudget = 1000;
const chartByteBudget = 5 * 1024 * 1024;

/** Read immutable result pages, never rerun SQL/model or silently fall back to the preview. */
export async function loadChartSnapshot(
  queryId: string,
  preview: QueryResult,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const target = Math.min(preview.returnedRowCount, chartRowBudget);
  if (preview.rows.length >= target) {
    const selected = preview.rows.slice(0, target);
    checkBytes(new TextEncoder().encode(JSON.stringify(selected)).byteLength);
    return { ...preview, rows: selected };
  }
  const rows: QueryResult["rows"] = [];
  let bytes = 0;
  for (let page = 1; rows.length < target; page++) {
    const part = await queryApi.result(
      queryId,
      { page, pageSize: 100 },
      signal,
    );
    if (
      part.returnedRowCount !== preview.returnedRowCount ||
      JSON.stringify(part.columns) !== JSON.stringify(preview.columns) ||
      part.page !== page ||
      part.pageSize !== 100 ||
      part.rows.length !==
        Math.min(100, preview.returnedRowCount - (page - 1) * 100)
    )
      throw new ApiError(
        "CONTRACT_MISMATCH",
        "Các trang snapshot không nhất quán. Không thể vẽ biểu đồ đầy đủ.",
      );
    const selected = part.rows.slice(0, target - rows.length);
    bytes += new TextEncoder().encode(JSON.stringify(selected)).byteLength;
    checkBytes(bytes);
    rows.push(...selected);
  }
  return { ...preview, rows, page: 1 };
}

function checkBytes(bytes: number) {
  if (bytes > chartByteBudget)
    throw new ApiError(
      "RESPONSE_TOO_LARGE",
      "Snapshot vượt giới hạn 5 MiB của biểu đồ. Xem bảng hoặc xuất CSV để giữ dữ liệu đầy đủ.",
    );
}

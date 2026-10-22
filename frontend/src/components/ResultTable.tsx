import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Search } from "lucide-react";
import { queryApi } from "../api/queryApi";
import type { Column, QueryResult } from "../api/schema";
import { copyText, formatValue } from "../lib/format";
import { Button, Empty, ErrorState, Loading, Notice, Pagination } from "./ui";

function resultColumnWidth(column: Column, result: QueryResult) {
  const labelLength = Array.from(column.label || column.name).length;
  const labelWidth = labelLength * 8 + 40;

  if (column.dataType === "BOOLEAN") return Math.max(120, labelWidth);
  if (column.dataType === "DATE") return Math.max(150, labelWidth);
  if (column.dataType === "TIMESTAMP") return Math.max(210, labelWidth);
  if (["INTEGER", "BIGINT"].includes(column.dataType))
    return Math.max(140, labelWidth);
  if (["DECIMAL", "FLOAT"].includes(column.dataType))
    return Math.max(160, labelWidth);

  const longestValue = Math.max(
    0,
    ...result.rows.map((row) =>
      row[column.name] == null
        ? 0
        : Array.from(String(row[column.name])).length,
    ),
  );
  const contentWidth = Math.min(360, Math.max(170, longestValue * 8 + 40));

  return Math.min(360, Math.max(labelWidth, contentWidth));
}

export function ResultTable({
  queryId,
  initial,
  readonly = false,
}: {
  queryId?: string;
  initial: QueryResult;
  readonly?: boolean;
}) {
  const [page, setPage] = useState(initial.page),
    [pageSize, setPageSize] = useState(initial.pageSize),
    [sort, setSort] = useState(""),
    [direction, setDirection] = useState("ASC"),
    [draftSearch, setDraftSearch] = useState(""),
    [search, setSearch] = useState(""),
    [actionError, setActionError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const unchanged =
    page === initial.page && pageSize === initial.pageSize && !sort && !search;
  const result = useQuery({
    queryKey: ["result", queryId, page, pageSize, sort, direction, search],
    queryFn: ({ signal }) =>
      queryApi.result(
        queryId!,
        { page, pageSize, sort, direction, search },
        signal,
      ),
    enabled: Boolean(queryId) && !readonly,
    initialData: unchanged ? initial : undefined,
    staleTime: unchanged ? 15000 : 0,
  });
  const data = queryId && !readonly ? result.data : initial;
  const compact = Boolean(data && data.columns.length <= 2);
  const columnWidths = data
    ? data.columns.map((column) => resultColumnWidth(column, data))
    : [];
  const naturalWidth =
    56 + columnWidths.reduce((total, width) => total + width, 0) + 56;
  const tableWidth = compact
    ? Math.min(720, Math.max(400, naturalWidth))
    : naturalWidth;
  const copy = (value: string) =>
    void copyText(value)
      .then(() => setNotice("Đã sao chép"))
      .catch(setActionError);
  async function download() {
    if (!queryId) return;
    setBusy(true);
    setActionError(null);
    try {
      await queryApi.exportCsv(queryId);
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`result-table ${data && data.columns.length <= 2 ? "compact-result-table" : ""}`}
    >
      {data?.truncated && (
        <Notice tone="warning">
          <strong>Kết quả đã được giới hạn.</strong> Hiển thị snapshot tối đa{" "}
          {data.returnedRowCount.toLocaleString("vi-VN")} dòng. CSV chỉ bao gồm
          snapshot này, không phải toàn bộ warehouse.
        </Notice>
      )}
      {!readonly &&
        queryId &&
        (initial.returnedRowCount > 1 || initial.truncated) && (
          <form
            className="table-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(draftSearch);
              setPage(1);
            }}
          >
            <div className="search-box">
              <Search size={17} />
              <input
                aria-label="Tìm trong kết quả"
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                placeholder="Tìm kiếm trong kết quả…"
              />
              <Button type="submit">Tìm</Button>
            </div>
            <Button disabled={busy || !data} onClick={() => void download()}>
              <Download size={17} />
              {busy ? "Đang tải…" : "Xuất CSV"}
            </Button>
          </form>
        )}
      {actionError != null && <ErrorState error={actionError} />}
      {notice && (
        <span className="sr-only" role="status">
          {notice}
        </span>
      )}
      {result.isLoading && queryId && !readonly ? (
        <Loading />
      ) : result.error && queryId && !readonly ? (
        <ErrorState error={result.error} retry={() => void result.refetch()} />
      ) : data && data.rows.length ? (
        <>
          <div
            className="table-scroll result-scroll"
            tabIndex={0}
            aria-label="Dữ liệu kết quả"
          >
            <table
              style={{
                width: `${tableWidth}px`,
                minWidth: compact ? undefined : "100%",
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: "56px" }} />
                {columnWidths.map((width, index) => (
                  <col
                    key={data.columns[index].name}
                    style={{ width: `${width}px` }}
                  />
                ))}
                <col style={{ width: "56px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {data.columns.map((c) => (
                    <th
                      key={c.name}
                      scope="col"
                      aria-sort={
                        sort === c.name
                          ? direction === "ASC"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      <button
                        className="sort-button"
                        disabled={readonly}
                        onClick={() => {
                          setSort(c.name);
                          setDirection(
                            sort === c.name && direction === "ASC"
                              ? "DESC"
                              : "ASC",
                          );
                          setPage(1);
                        }}
                      >
                        {c.label || c.name}
                        {c.unit && <small> ({c.unit})</small>}{" "}
                        {!readonly && "↕"}
                      </button>
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Sao chép dòng</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={`${page}-${i}`}>
                    <td>{(data.page - 1) * data.pageSize + i + 1}</td>
                    {data.columns.map((c) => (
                      <td
                        key={c.name}
                        className={
                          c.semanticRole === "METRIC" ||
                          (["INTEGER", "BIGINT", "DECIMAL", "FLOAT"].includes(
                            c.dataType,
                          ) &&
                            !["DIMENSION", "TIME"].includes(c.semanticRole))
                            ? "numeric"
                            : ""
                        }
                      >
                        <button
                          className={`cell-value ${row[c.name] === null ? "null" : ""}`}
                          title={`${String(row[c.name])} · Nhấn để sao chép`}
                          onClick={() =>
                            copy(
                              row[c.name] === null
                                ? "NULL"
                                : String(row[c.name]),
                            )
                          }
                        >
                          {formatValue(row[c.name], c)}
                        </button>
                      </td>
                    ))}
                    <td>
                      <Button
                        aria-label={`Sao chép dòng ${(data.page - 1) * data.pageSize + i + 1}`}
                        variant="ghost"
                        onClick={() => copy(JSON.stringify(row))}
                      >
                        <Copy size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readonly && queryId && data.returnedRowCount > 1 && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              totalItems={data.returnedRowCount}
              totalPages={Math.ceil(data.returnedRowCount / data.pageSize)}
              onChange={(p, s) => {
                setPage(p);
                setPageSize(s);
              }}
            />
          )}
          <small className="muted">
            Nhấn vào ô để sao chép giá trị gốc.
            {data.columns.length > 4
              ? " Kéo ngang để xem thêm cột dữ liệu."
              : ""}
          </small>
        </>
      ) : (
        <Empty
          title="Không có dòng dữ liệu"
          description="Truy vấn không trả về dòng nào hoặc bộ lọc không có kết quả."
        />
      )}
    </div>
  );
}

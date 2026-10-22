import { useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartSchema,
  type ChartSpec,
  type ChartType,
  type QueryResult,
} from "../api/schema";
import { formatValue } from "../lib/format";
import { Button, Empty, Notice, Field, CopyButton } from "./ui";
import { ResultTable } from "./ResultTable";
import { BarChart3, Maximize2, SlidersHorizontal } from "lucide-react";
const colors = ["#1673ff", "#13bf8a", "#ffb12c", "#9b5bff", "#fb5786"];
export function validateChart(
  spec: unknown,
  result: QueryResult,
): { spec: ChartSpec; reason?: string } {
  const fallback = (reason: string) => ({
    spec: { type: "table" as const, title: "Bảng kết quả", series: [] },
    reason,
  });
  const p = ChartSchema.safeParse(spec);
  if (!p.success)
    return fallback(
      "Biểu đồ không đúng định dạng hoặc nằm ngoài danh sách hỗ trợ.",
    );
  const chart = p.data;
  if (chart.type === "table") return { spec: chart };
  if (!result.rows.length) return fallback("Không có dữ liệu để vẽ biểu đồ.");
  const columns = result.columns;
  const metrics = chart.series.map((s) =>
    columns.find((c) => c.name === s.column),
  );
  if (
    !chart.series.length ||
    metrics.some(
      (c) =>
        !c || !["INTEGER", "BIGINT", "DECIMAL", "FLOAT"].includes(c.dataType),
    )
  )
    return fallback("Biểu đồ tham chiếu cột không tồn tại hoặc không phải số.");
  if (
    chart.type === "number" &&
    (chart.series.length !== 1 || result.returnedRowCount !== 1)
  )
    return fallback("Biểu đồ số cần đúng một giá trị.");
  if (
    chart.type !== "number" &&
    (!chart.x || !columns.some((c) => c.name === chart.x))
  )
    return fallback("Thiếu cột trục X hợp lệ.");
  if (
    chart.type === "pie" &&
    (chart.series.length !== 1 ||
      result.rows.some((row) => Number(row[chart.series[0].column]) < 0))
  )
    return fallback("Biểu đồ tròn cần một chuỗi số không âm.");
  if (
    ["line", "area"].includes(chart.type) &&
    !columns.some(
      (c) =>
        c.name === chart.x &&
        (c.semanticRole === "TIME" ||
          ["DATE", "TIMESTAMP"].includes(c.dataType)),
    )
  )
    return fallback("Biểu đồ xu hướng cần cột thời gian.");
  if (
    metrics.length > 1 &&
    (metrics.some((column) => !column?.unit?.trim()) ||
      new Set(metrics.map((column) => column?.unit?.trim())).size > 1)
  )
    return fallback(
      "Chỉ ghép chuỗi khi đã xác định cùng đơn vị cho mọi chỉ số.",
    );
  if (
    chart.type !== "number" &&
    result.rows.some((row) =>
      chart.series.some((s) => {
        const v = row[s.column];
        return (
          v !== null &&
          (!Number.isFinite(Number(v)) ||
            Math.abs(Number(v)) > Number.MAX_SAFE_INTEGER)
        );
      }),
    )
  )
    return fallback(
      "Giá trị quá lớn để vẽ chính xác; xem bảng để giữ nguyên độ chính xác.",
    );
  return { spec: chart };
}
export const numericTypes = ["INTEGER", "BIGINT", "DECIMAL", "FLOAT"];
export function scalarColumn(result: QueryResult) {
  return result.returnedRowCount === 1 &&
    result.rows.length === 1 &&
    result.columns.length === 1 &&
    numericTypes.includes(result.columns[0].dataType)
    ? result.columns[0]
    : undefined;
}
export function suggestChart(result: QueryResult): ChartSpec {
  const scalar = scalarColumn(result);
  if (scalar)
    return {
      type: "number",
      title: scalar.label || scalar.name,
      series: [{ column: scalar.name, label: scalar.label || scalar.name }],
    };
  const measures = result.columns.filter(
    (column) =>
      numericTypes.includes(column.dataType) &&
      column.semanticRole !== "DIMENSION" &&
      column.semanticRole !== "TIME",
  );
  const axis =
    result.columns.find(
      (column) =>
        column.semanticRole === "TIME" ||
        ["DATE", "TIMESTAMP"].includes(column.dataType),
    ) ||
    result.columns.find(
      (column) =>
        !numericTypes.includes(column.dataType) ||
        column.semanticRole === "DIMENSION",
    );
  if (!axis || !measures.length || !result.rows.length)
    return { type: "table", title: "Kết quả truy vấn", series: [] };
  const compatible = measures[0].unit?.trim()
    ? measures
        .filter((column) => column.unit?.trim() === measures[0].unit?.trim())
        .slice(0, 4)
    : measures.slice(0, 1);
  const time =
    axis.semanticRole === "TIME" ||
    ["DATE", "TIMESTAMP"].includes(axis.dataType);
  const candidate = {
    type: time ? "line" : compatible.length > 1 ? "grouped-bar" : "bar",
    title: "Kết quả phân tích",
    x: axis.name,
    series: compatible.map((column) => ({
      column: column.name,
      label: column.label || column.name,
    })),
  };
  return validateChart(candidate, result).spec;
}
export function plotRows(result: QueryResult, spec: ChartSpec) {
  const rows = [...result.rows];
  if (!["line", "area"].includes(spec.type) || !spec.x) return rows;
  const values = rows.map((row) => {
    const value = row[spec.x!];
    return typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(value)
      ? Date.parse(value)
      : NaN;
  });
  // Only canonical dates/instants have a reliable chronology. Preserve source order otherwise.
  if (values.some((value) => !Number.isFinite(value))) return rows;
  return rows
    .map((row, index) => ({ row, instant: values[index] }))
    .sort((a, b) => a.instant - b.instant)
    .map(({ row }) => row);
}

function SnapshotTable({ result }: { result: QueryResult }) {
  const [requestedPage, setPage] = useState(1);
  const pageSize = 20;
  const available = result.rows.length;
  const totalPages = Math.max(1, Math.ceil(available / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, available);
  const localPage = {
    ...result,
    page,
    pageSize,
    rows: result.rows.slice(start, end),
  };
  return (
    <>
      {available < result.returnedRowCount && (
        <Notice tone="warning">
          Bảng này có {available.toLocaleString("vi-VN")} dòng đã tải trong{" "}
          {result.returnedRowCount.toLocaleString("vi-VN")} dòng snapshot. Phân
          trang chỉ áp dụng cho các dòng đã tải; mở tab Dữ liệu hoặc xuất CSV để
          xem snapshot còn lại.
        </Notice>
      )}
      <ResultTable initial={localPage} readonly />
      {available > pageSize && (
        <nav className="pagination" aria-label="Phân trang bảng biểu đồ">
          <span role="status" aria-live="polite" aria-atomic="true">
            Hiển thị{" "}
            <strong>
              {start + 1}–{end}
            </strong>{" "}
            / {available.toLocaleString("vi-VN")} dòng đã tải
          </span>
          <div>
            <span>20 dòng/trang</span>
            <Button
              aria-label="Trang đầu"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              Đầu
            </Button>
            <Button
              aria-label="Trang trước"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Trước
            </Button>
            <span className="page-current">
              {page} / {totalPages}
            </span>
            <Button
              aria-label="Trang sau"
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
            >
              Sau
            </Button>
            <Button
              aria-label="Trang cuối"
              disabled={page === totalPages}
              onClick={() => setPage(totalPages)}
            >
              Cuối
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}

export function Visualization({
  spec: input,
  result,
  compact = false,
}: {
  spec: unknown;
  result: QueryResult;
  compact?: boolean;
}) {
  const original = validateChart(input, result);
  const inferred = suggestChart(result);
  const initial = scalarColumn(result)
    ? inferred
    : input == null
      ? inferred
      : original.spec;
  const [selection, setSelection] = useState<ChartSpec>(initial);
  const [fullscreenError, setFullscreenError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const validated = validateChart(selection, result);
  const spec = validated.spec;
  const numeric = result.columns.filter((column) =>
    numericTypes.includes(column.dataType),
  );
  const axes = result.columns.filter(
    (column) =>
      !selection.series.some((series) => series.column === column.name),
  );
  const selectedUnit =
    result.columns.find((column) => column.name === selection.series[0]?.column)
      ?.unit || "";
  const options: ChartType[] = [
    "number",
    "bar",
    "grouped-bar",
    "line",
    "area",
    "pie",
    "table",
  ];
  const labels: Record<ChartType, string> = {
    table: "Bảng",
    number: "Số",
    bar: "Cột",
    "grouped-bar": "Cột nhóm",
    line: "Đường",
    area: "Diện tích",
    pie: "Tròn",
  };
  const available = options.filter(
    (type) =>
      type === "table" ||
      ((type !== "grouped-bar" || selection.series.length > 1) &&
        validateChart({ ...selection, type }, result).spec.type === type),
  );
  const data = plotRows(result, spec).map((row) => ({
    ...row,
    ...Object.fromEntries(
      spec.series.map((series) => [
        series.column,
        row[series.column] === null ? null : Number(row[series.column]),
      ]),
    ),
  }));
  const toggleSeries = (name: string, checked: boolean) => {
    const column = result.columns.find((column) => column.name === name)!;
    const series = checked
      ? [...selection.series, { column: name, label: column.label || name }]
      : selection.series.filter((series) => series.column !== name);
    const type =
      series.length > 1 && ["bar", "pie", "number"].includes(selection.type)
        ? "grouped-bar"
        : series.length === 1 && selection.type === "grouped-bar"
          ? "bar"
          : selection.type;
    setSelection({ ...selection, series, type });
  };
  const tooltip = (value: unknown) =>
    typeof value === "number"
      ? value.toLocaleString("vi-VN", { maximumFractionDigits: 6 })
      : String(value ?? "NULL");
  return (
    <div
      ref={ref}
      className={`visualization ${compact ? "compact" : ""} ${scalarColumn(result) ? "scalar-visualization" : ""}`}
    >
      <div className="chart-layout">
        <section className="chart-main">
          {(!compact || spec.type !== "number") && (
            <div className="chart-header">
              {!compact && (
                <h3>
                  <BarChart3 size={19} />
                  {spec.title}
                </h3>
              )}
              {spec.type !== "number" && (
                <Button
                  title="Mở biểu đồ toàn màn hình"
                  onClick={() =>
                    void ref.current
                      ?.requestFullscreen?.()
                      .catch(() =>
                        setFullscreenError(
                          "Trình duyệt không cho phép chế độ toàn màn hình.",
                        ),
                      )
                  }
                >
                  <Maximize2 size={16} />
                  <span>Toàn màn hình</span>
                </Button>
              )}
            </div>
          )}
          {available.length > 1 && (
            <div className="chart-switcher" aria-label="Loại hiển thị">
              {available.map((type) => (
                <Button
                  key={type}
                  variant={spec.type === type ? "primary" : "secondary"}
                  onClick={() => setSelection({ ...selection, type })}
                >
                  {labels[type]}
                </Button>
              ))}
            </div>
          )}
          {(validated.reason || original.reason) && (
            <Notice tone="warning">
              {validated.reason || original.reason}
            </Notice>
          )}
          {fullscreenError && <Notice>{fullscreenError}</Notice>}
          {spec.type === "table" ? (
            <SnapshotTable result={result} />
          ) : spec.type === "number" ? (
            <div className="number-chart">
              <small>{spec.series[0].label}</small>
              <strong>
                {formatValue(
                  result.rows[0]?.[spec.series[0].column],
                  result.columns.find(
                    (column) => column.name === spec.series[0].column,
                  ),
                )}
              </strong>
              <span>
                {result.columns.find(
                  (column) => column.name === spec.series[0].column,
                )?.unit || "Giá trị trả về từ warehouse"}
              </span>
              <CopyButton
                text={String(result.rows[0]?.[spec.series[0].column] ?? "NULL")}
                label="Sao chép giá trị gốc"
              />
            </div>
          ) : data.length ? (
            <>
              <div className="chart-area" role="img" aria-label={spec.title}>
                <ResponsiveContainer width="100%" height="100%">
                  {spec.type === "pie" ? (
                    <PieChart>
                      <Pie
                        data={data}
                        dataKey={spec.series[0].column}
                        nameKey={spec.x}
                        outerRadius="75%"
                        paddingAngle={2}
                        isAnimationActive={false}
                      >
                        {data.map((_, index) => (
                          <Cell
                            key={index}
                            fill={colors[index % colors.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={tooltip} />
                      <Legend />
                    </PieChart>
                  ) : spec.type === "line" ? (
                    <LineChart
                      data={data}
                      margin={{ top: 20, right: 20, left: 10, bottom: 15 }}
                    >
                      <CartesianGrid stroke="#e5edf8" strokeDasharray="3 3" />
                      <XAxis
                        dataKey={spec.x}
                        stroke="#8191ac"
                        tick={{ fontSize: 11 }}
                        minTickGap={20}
                      />
                      <YAxis
                        stroke="#8191ac"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(n) =>
                          Number(n).toLocaleString("vi-VN", {
                            notation: "compact",
                          })
                        }
                      />
                      <Tooltip formatter={tooltip} />
                      <Legend />
                      {spec.series.map((series, index) => (
                        <Line
                          key={series.column}
                          type="monotone"
                          dataKey={series.column}
                          name={series.label}
                          stroke={colors[index % colors.length]}
                          strokeWidth={2.5}
                          dot={data.length < 30}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  ) : spec.type === "area" ? (
                    <AreaChart
                      data={data}
                      margin={{ top: 20, right: 20, left: 10, bottom: 15 }}
                    >
                      <CartesianGrid stroke="#e5edf8" strokeDasharray="3 3" />
                      <XAxis
                        dataKey={spec.x}
                        tick={{ fontSize: 11 }}
                        minTickGap={20}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(n) =>
                          Number(n).toLocaleString("vi-VN", {
                            notation: "compact",
                          })
                        }
                      />
                      <Tooltip formatter={tooltip} />
                      <Legend />
                      {spec.series.map((series, index) => (
                        <Area
                          key={series.column}
                          type="monotone"
                          dataKey={series.column}
                          name={series.label}
                          stroke={colors[index % colors.length]}
                          fill={colors[index % colors.length]}
                          fillOpacity={0.14}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  ) : (
                    <BarChart
                      data={data}
                      barCategoryGap="24%"
                      margin={{ top: 20, right: 20, left: 10, bottom: 15 }}
                    >
                      <CartesianGrid vertical={false} stroke="#e5edf8" />
                      <XAxis
                        dataKey={spec.x}
                        tick={{ fontSize: 11 }}
                        minTickGap={14}
                        stroke="#8191ac"
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="#8191ac"
                        tickFormatter={(n) =>
                          Number(n).toLocaleString("vi-VN", {
                            notation: "compact",
                          })
                        }
                      />
                      <Tooltip formatter={tooltip} />
                      <Legend />
                      {spec.series.map((series, index) => (
                        <Bar
                          key={series.column}
                          dataKey={series.column}
                          name={series.label}
                          fill={colors[index % colors.length]}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={68}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
              <p className="chart-caption">
                {result.rows.length} dòng đang hiển thị /{" "}
                {result.returnedRowCount} dòng snapshot
                {result.truncated ? " (đã giới hạn)" : ""}. Giá trị gốc được giữ
                nguyên trong bảng và CSV.
              </p>
            </>
          ) : (
            <Empty />
          )}
        </section>
        {!compact && !scalarColumn(result) && spec.type !== "number" && (
          <aside className="chart-inspector">
            <h3>
              <SlidersHorizontal size={18} />
              Thiết lập biểu đồ
            </h3>
            <Field label="Cột trục X">
              <select
                value={selection.x || ""}
                onChange={(event) =>
                  setSelection({ ...selection, x: event.target.value })
                }
              >
                <option value="">Chọn trục phân tích</option>
                {axes.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.label || column.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field series-options">
              <span>Chuỗi dữ liệu</span>
              {numeric.map((column, index) => {
                const selected = selection.series.some(
                  (series) => series.column === column.name,
                );
                const compatible = Boolean(
                  column.unit?.trim() &&
                  selectedUnit.trim() &&
                  column.unit.trim() === selectedUnit.trim(),
                );
                return (
                  <label
                    className="series-option"
                    key={column.name}
                    title={
                      !compatible && !selected
                        ? "Đơn vị khác hoặc chưa được xác định"
                        : ""
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={
                        (!selected &&
                          !compatible &&
                          selection.series.length > 0) ||
                        column.name === selection.x
                      }
                      onChange={(event) =>
                        toggleSeries(column.name, event.target.checked)
                      }
                    />
                    <i style={{ background: colors[index % colors.length] }} />
                    <span>
                      {column.label || column.name}
                      <small>
                        {column.dataType}
                        {column.unit ? ` · ${column.unit}` : ""}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="chart-info">
              <BarChart3 size={19} />
              <p>
                Biểu đồ chỉ dùng các cột và dòng trong kết quả thật. Nhiều chuỗi
                chỉ ghép khi đã xác định cùng đơn vị.
              </p>
            </div>
            {spec.reason && <p className="muted">{spec.reason}</p>}
          </aside>
        )}
      </div>
    </div>
  );
}

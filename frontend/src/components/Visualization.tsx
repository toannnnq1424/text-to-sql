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
import { Button, Empty, Notice } from "./ui";
import { ResultTable } from "./ResultTable";
import { Maximize2 } from "lucide-react";
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
  if (new Set(metrics.map((c) => c?.unit || "")).size > 1)
    return fallback(
      "Các chuỗi dữ liệu khác đơn vị không thể dùng chung một trục.",
    );
  if (
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
export function Visualization({
  spec: input,
  result,
}: {
  spec: unknown;
  result: QueryResult;
}) {
  const original = validateChart(input, result),
    [choice, setChoice] = useState<ChartType | null>(null),
    [fullscreenError, setFullscreenError] = useState(""),
    ref = useRef<HTMLDivElement>(null);
  const validated = validateChart(
      choice ? { ...original.spec, type: choice } : input,
      result,
    ),
    spec = validated.spec;
  const data = result.rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      spec.series.map((s) => [
        s.column,
        row[s.column] === null ? null : Number(row[s.column]),
      ]),
    ),
  }));
  const options: ChartType[] = [
    "table",
    "number",
    "bar",
    "grouped-bar",
    "line",
    "area",
    "pie",
  ];
  const tooltip = (value: unknown) => String(value ?? "NULL");
  return (
    <div ref={ref} className="visualization">
      <div className="table-toolbar">
        <h3>{spec.title}</h3>
        <Button
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
          <Maximize2 size={17} />
          Toàn màn hình
        </Button>
      </div>
      <div className="chart-switcher">
        {options.map((type) => (
          <Button
            key={type}
            variant={spec.type === type ? "primary" : "secondary"}
            disabled={
              type !== "table" &&
              validateChart({ ...original.spec, type }, result).spec.type !==
                type
            }
            onClick={() => setChoice(type)}
          >
            {
              {
                table: "Bảng",
                number: "Số",
                bar: "Cột",
                "grouped-bar": "Cột nhóm",
                line: "Đường",
                area: "Diện tích",
                pie: "Tròn",
              }[type]
            }
          </Button>
        ))}
      </div>
      {validated.reason && <Notice tone="warning">{validated.reason}</Notice>}
      {fullscreenError && <Notice>{fullscreenError}</Notice>}
      {spec.type === "table" ? (
        <ResultTable initial={result} readonly />
      ) : spec.type === "number" ? (
        <div className="number-chart">
          <small>{spec.series[0].label}</small>
          <strong>
            {formatValue(
              result.rows[0]?.[spec.series[0].column],
              result.columns.find((c) => c.name === spec.series[0].column),
            )}
          </strong>
          <span>
            {result.columns.find((c) => c.name === spec.series[0].column)?.unit}
          </span>
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
                  >
                    {data.map((_, i) => (
                      <Cell key={i} fill={colors[i % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={tooltip} />
                  <Legend />
                </PieChart>
              ) : spec.type === "line" ? (
                <LineChart data={data}>
                  <CartesianGrid stroke="#e8effa" strokeDasharray="3 3" />
                  <XAxis dataKey={spec.x} stroke="#7b8aab" />
                  <YAxis stroke="#7b8aab" />
                  <Tooltip formatter={tooltip} />
                  <Legend />
                  {spec.series.map((s, i) => (
                    <Line
                      key={s.column}
                      type="monotone"
                      dataKey={s.column}
                      name={s.label}
                      stroke={colors[i % colors.length]}
                      strokeWidth={3}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              ) : spec.type === "area" ? (
                <AreaChart data={data}>
                  <CartesianGrid stroke="#e8effa" />
                  <XAxis dataKey={spec.x} />
                  <YAxis />
                  <Tooltip formatter={tooltip} />
                  <Legend />
                  {spec.series.map((s, i) => (
                    <Area
                      key={s.column}
                      dataKey={s.column}
                      name={s.label}
                      stroke={colors[i % colors.length]}
                      fill={colors[i % colors.length]}
                      fillOpacity={0.18}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              ) : (
                <BarChart data={data} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke="#e8effa" />
                  <XAxis dataKey={spec.x} stroke="#7b8aab" />
                  <YAxis stroke="#7b8aab" />
                  <Tooltip formatter={tooltip} />
                  <Legend />
                  {spec.series.map((s, i) => (
                    <Bar
                      key={s.column}
                      dataKey={s.column}
                      name={s.label}
                      fill={colors[i % colors.length]}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={78}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <p className="chart-caption">
            Biểu đồ hiển thị {result.rows.length} dòng của trang {result.page}{" "}
            trong snapshot {result.returnedRowCount} dòng
            {result.truncated ? " đã được giới hạn" : ""}. Bảng giữ nguyên giá
            trị gốc; hình vẽ dùng số xấp xỉ của trình duyệt.
          </p>
        </>
      ) : (
        <Empty />
      )}
      {spec.reason && <p className="muted">{spec.reason}</p>}
    </div>
  );
}

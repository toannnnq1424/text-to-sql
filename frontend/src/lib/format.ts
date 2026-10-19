import type { Column } from "../api/schema";
export const engineLabel = {
  POSTGRESQL: "PostgreSQL",
  MYSQL: "MySQL",
  SQL_SERVER: "SQL Server",
};
export function formatDate(value: string | null | undefined, locale = "vi-VN") {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(d);
}
export function formatRate(value: number | null | undefined) {
  return value == null
    ? "—"
    : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}
export function formatDuration(value: number | null | undefined) {
  return value == null
    ? "—"
    : value < 1000
      ? `${value} ms`
      : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value / 1000)} s`;
}
export function formatValue(value: unknown, column?: Column): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  // Group decimal strings without conversion to floating point, preserving all significant digits.
  if (
    column &&
    ["DECIMAL", "BIGINT"].includes(column.dataType) &&
    typeof value === "string" &&
    /^-?\d+(\.\d+)?$/.test(value)
  ) {
    const [integer, decimal] = value.split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return grouped + (decimal !== undefined ? "," + decimal : "");
  }
  if (column?.dataType === "TIMESTAMP" && typeof value === "string")
    return formatDate(value);
  if (typeof value === "number")
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 12 }).format(
      value,
    );
  return String(value);
}
export function downloadText(
  filename: string,
  content: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyText(value: string) {
  if (!navigator.clipboard?.writeText)
    throw new Error(
      "Trình duyệt chưa cho phép sao chép. Hãy dùng kết nối HTTPS hoặc localhost.",
    );
  await navigator.clipboard.writeText(value);
}
export function utcDateRange(
  from: string,
  to: string,
): { from?: string; to?: string } {
  if (from && to && from > to)
    throw new Error("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
  // Date filters use the explicit UI zone UTC+07 and an exclusive next-day upper bound.
  return {
    from: from ? new Date(`${from}T00:00:00+07:00`).toISOString() : undefined,
    to: to
      ? new Date(
          new Date(`${to}T00:00:00+07:00`).getTime() + 86400000,
        ).toISOString()
      : undefined,
  };
}
export function isActive(status: string) {
  return ["PENDING", "RUNNING"].includes(status);
}

import {
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  LoaderCircle,
  RefreshCw,
  Search,
  Table2,
  X,
  Check,
  Info,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../app/auth";
import { useWarehouse, useLocale } from "../app/providers";
import { ApiError, type Params } from "../api/client";
import { copyText } from "../lib/format";
import { formatSqlForDisplay } from "../lib/sqlDisplay";
export function Card({
  title,
  icon,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="card-heading">
          <h2>
            {icon && <span className="icon-tile small">{icon}</span>}
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      type="button"
      className={`button ${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Badge({ status }: { status: string }) {
  const good = [
    "ACTIVE",
    "SUCCESS",
    "PASSED",
    "UP",
    "HEALTHY",
    "PUBLISHED",
  ].includes(status.toUpperCase());
  const running = ["PENDING", "RUNNING"].includes(status.toUpperCase());
  const warning = [
    "PARTIAL",
    "INVALID_SCHEMA",
    "VALIDATION_ERROR",
    "DISABLED",
    "SKIPPED",
  ].includes(status.toUpperCase());
  return (
    <span
      className={`badge ${good ? "good" : running ? "blue" : warning ? "warning" : "bad"}`}
    >
      <span className={running ? "dot pulsing" : "dot"} />
      {status}
    </span>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
}) {
  return (
    <div
      className={`notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "error" ? <AlertCircle size={20} /> : <Info size={20} />}
      <div>{children}</div>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const auth = useAuth();
  const e =
    error instanceof Error ? error : new Error("Có lỗi khi tải dữ liệu.");
  return (
    <Notice tone="error">
      <strong>{e.message}</strong>
      {e instanceof ApiError && (
        <>
          <small>
            {e.code}
            {e.correlationId && ` · Correlation ID: ${e.correlationId}`}
          </small>
          {typeof e.details.queryId === "string" && (
            <Link
              to={`/query/${encodeURIComponent(e.details.queryId)}/technical`}
            >
              Xem trạng thái truy vấn
            </Link>
          )}
        </>
      )}
      <div className="inline-actions">
        {retry && (
          <Button onClick={retry}>
            <RefreshCw size={15} />
            Thử lại
          </Button>
        )}
        {e instanceof ApiError && e.status === 401 && (
          <Button onClick={() => void auth.login().catch(() => {})}>
            Đăng nhập lại
          </Button>
        )}
      </div>
    </Notice>
  );
}
export function Loading({ label = "Đang tải dữ liệu…" }: { label?: string }) {
  const { t } = useLocale();
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      {t(label)}
    </div>
  );
}
export function Empty({
  title = "Không có dữ liệu",
  description = "Thử thay đổi bộ lọc hoặc chọn một dataset khác.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Database size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Resource<T>({
  resource,
  children,
  empty,
}: {
  resource: {
    isPending: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => unknown;
  };
  children: (data: T) => ReactNode;
  empty?: ReactNode;
}) {
  if (resource.isPending) return <Loading />;
  if (resource.error)
    return (
      <ErrorState
        error={resource.error}
        retry={() => void resource.refetch()}
      />
    );
  return resource.data !== undefined
    ? children(resource.data)
    : empty || <Empty />;
}
export function ContextGate({ children }: { children: ReactNode }) {
  const c = useWarehouse();
  if (c.warehouseLoading || c.datasetLoading) return <Loading />;
  if (c.error) return <ErrorState error={c.error} retry={c.reload} />;
  if (!c.warehouse)
    return (
      <Card>
        <Empty
          title="Chọn warehouse để bắt đầu"
          description="Kết nối tới một warehouse đã được dựng sẵn, sau đó chọn dataset để khám phá dữ liệu."
          action={
            <Link className="button primary" to="/warehouses">
              Quản lý warehouses
              <ArrowRight size={16} />
            </Link>
          }
        />
      </Card>
    );
  if (c.warehouse.status !== "ACTIVE")
    return (
      <Notice tone="warning">
        Warehouse <strong>{c.warehouse.name}</strong> đang ở trạng thái{" "}
        {c.warehouse.status}. Chọn warehouse hoạt động hoặc kiểm tra kết nối
        trong Warehouses.
      </Notice>
    );
  if (!c.dataset)
    return (
      <Card>
        <Empty
          title="Chưa chọn dataset"
          description="Chọn dataset thuộc warehouse hiện tại ở thanh phía trên. Dataset được đăng ký và xác thực qua Java API."
        />
      </Card>
    );
  if (c.dataset.status !== "ACTIVE")
    return (
      <Notice tone="warning">
        Dataset <strong>{c.dataset.name}</strong>:{" "}
        {c.dataset.status === "INVALID_SCHEMA"
          ? "Schema không khớp. Cần kiểm tra metadata và semantic mapping."
          : "Dataset đã bị vô hiệu hóa."}
      </Notice>
    );
  return <>{children}</>;
}
export function Stat({
  label,
  value,
  icon,
  note,
  tone = "blue",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  note?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="stat card">
      <span className={`icon-tile ${tone}`}>
        {icon || <Table2 size={23} />}
      </span>
      <div>
        <span className="stat-label">{label}</span>
        <strong>{value ?? "—"}</strong>
        {note && <small>{note}</small>}
      </div>
    </div>
  );
}
export function Tabs({
  items,
}: {
  items: { to: string; label: string; icon?: ReactNode; active: boolean }[];
}) {
  return (
    <nav className="tabs" aria-label="Điều hướng nội dung">
      {items.map((item) => (
        <Link
          key={item.to}
          className={`tab ${item.active ? "active" : ""}`}
          to={item.to}
          aria-current={item.active ? "page" : undefined}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
export function CopyButton({
  text,
  label = "Sao chép",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <span className="copy-control">
      <Button
        title={label}
        aria-label={label}
        onClick={() =>
          void copyText(text)
            .then(() => setStatus("Đã sao chép"))
            .catch((e) => setStatus(e.message))
        }
      >
        {status === "Đã sao chép" ? <Check size={16} /> : <Copy size={16} />}
        <span>{label}</span>
      </Button>
      {status && <small role="status">{status}</small>}
    </span>
  );
}
export function SqlBlock({
  sql,
  label = "SQL",
}: {
  sql: string | null | undefined;
  label?: string;
}) {
  const lines = sql ? formatSqlForDisplay(sql).split("\n") : undefined;
  return (
    <div className="sql-block">
      <header>
        <span>{label}</span>
        {sql && <CopyButton text={sql} label="Copy SQL" />}
      </header>
      {sql ? (
        <pre tabIndex={0} aria-label={label}>
          <code className="sql-code">
            {lines?.map((line, i) => (
              <span className="sql-line" key={i}>
                <span className="line-no" aria-hidden="true">
                  {i + 1}
                </span>
                <SqlSyntaxLine line={line} />
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
      ) : (
        <Empty
          title="Chưa có SQL"
          description="SQL được hiển thị sau khi Java API trả về kết quả sinh truy vấn."
        />
      )}
    </div>
  );
}
const sqlKeywords = new Set(
  "all and as asc between by case cast cross current_date date desc distinct else end from full group having in inner interval is join left like limit not null offset on or order outer over partition right select then top union when where with year month".split(
    " ",
  ),
);
const sqlTokenPattern = /--[^\n]*|\b[A-Za-z_][\w$]*\b|\b\d+(?:\.\d+)?\b|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]])*\]/g;
function SqlSyntaxLine({ line }: { line: string }) {
  const tokens: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(sqlTokenPattern)) {
    const token = match[0];
    const start = match.index ?? cursor;
    if (start > cursor) tokens.push(line.slice(cursor, start));
    let kind = "sql-identifier";
    if (token.startsWith("--")) kind = "sql-comment";
    else if (token.startsWith("'")) kind = "sql-string";
    else if (/^\d/.test(token)) kind = "sql-number";
    else if (/^[\[\`\"]/.test(token)) kind = "sql-quoted-identifier";
    else if (/^\s*\(/.test(line.slice((match.index ?? 0) + token.length)))
      kind = "sql-function";
    else if (sqlKeywords.has(token.toLowerCase())) kind = "sql-keyword";
    tokens.push(
      <span className={kind} key={`${start}-${token}`}>
        {token}
      </span>,
    );
    cursor = start + token.length;
  }
  if (cursor < line.length) tokens.push(line.slice(cursor));
  return <>{tokens}</>;
}
export function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="detail-list">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const d = ref.current;
    const prior = document.activeElement as HTMLElement | null;
    d?.showModal();
    return () => {
      d?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <Button aria-label="Đóng" onClick={onClose}>
          <X size={18} />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
export function Pagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  onChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onChange: (page: number, pageSize: number) => void;
}) {
  const start = totalItems ? (page - 1) * pageSize + 1 : 0,
    end = Math.min(page * pageSize, totalItems);
  return (
    <div className="pagination">
      <span>
        Hiển thị{" "}
        <strong>
          {start}–{end}
        </strong>{" "}
        / {totalItems.toLocaleString("vi-VN")}
      </span>
      <div>
        <label>
          {" "}
          Số dòng{" "}
          <select
            aria-label="Số dòng mỗi trang"
            value={pageSize}
            onChange={(e) => onChange(1, Number(e.target.value))}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button
          aria-label="Trang trước"
          disabled={page <= 1}
          onClick={() => onChange(page - 1, pageSize)}
        >
          <ChevronLeft size={17} />
        </Button>
        <span className="page-current">
          {page} / {Math.max(1, totalPages)}
        </span>
        <Button
          aria-label="Trang sau"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1, pageSize)}
        >
          <ChevronRight size={17} />
        </Button>
      </div>
    </div>
  );
}
export type GridColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
};
export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  onSelect,
  selected,
  sort,
  direction,
  onSort,
}: {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onSelect?: (row: T) => void;
  selected?: string;
  sort?: string;
  direction?: string;
  onSort?: (key: string) => void;
}) {
  if (!rows.length) return <Empty />;
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Bảng dữ liệu"
    >
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                aria-sort={
                  sort === c.key
                    ? direction === "ASC"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {c.sortable && onSort ? (
                  <button className="sort-button" onClick={() => onSort(c.key)}>
                    {c.label}
                    <span aria-hidden="true">↕</span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={selected === rowKey(row) ? "selected" : ""}
            >
              {columns.map((c, i) => (
                <td key={c.key}>
                  {i === 0 && onSelect ? (
                    <button className="row-link" onClick={() => onSelect(row)}>
                      {c.render(row)}
                    </button>
                  ) : (
                    c.render(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function useListState(defaultSort = "createdAt") {
  const [search, setSearch] = useSearchParams();
  const rawPage = Number(search.get("page")),
    rawSize = Number(search.get("pageSize"));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize = [10, 20, 50, 100].includes(rawSize) ? rawSize : 20;
  const params: Params = Object.fromEntries(search.entries());
  params.page = page;
  params.pageSize = pageSize;
  params.sort = search.get("sort") || defaultSort;
  params.direction = search.get("direction") === "ASC" ? "ASC" : "DESC";
  const patch = (values: Params, resetPage = true) => {
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      if (resetPage) next.set("page", "1");
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined || v === null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      return next;
    });
  };
  return {
    params,
    page,
    pageSize,
    patch,
    paginate: (p: number, s: number) => patch({ page: p, pageSize: s }, false),
    sort: (key: string) =>
      patch({
        sort: key,
        direction:
          params.sort === key && params.direction === "ASC" ? "DESC" : "ASC",
      }),
    reset: () => setSearch({}),
  };
}
export function Filters({
  children,
  onApply,
  onReset,
}: {
  children: ReactNode;
  onApply: (values: Record<string, string>) => void;
  onReset: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      className="filters card"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        try {
          onApply(
            Object.fromEntries(
              new FormData(e.currentTarget).entries(),
            ) as Record<string, string>,
          );
          setError("");
        } catch (error) {
          setError(
            error instanceof Error ? error.message : "Bộ lọc không hợp lệ.",
          );
        }
      }}
    >
      {children}
      <div className="filter-actions">
        <Button
          onClick={() => {
            setError("");
            onReset();
          }}
        >
          <RefreshCw size={15} />
          Đặt lại
        </Button>
        <Button variant="primary" type="submit">
          <Search size={16} />
          Áp dụng
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
export function AsyncSelect<T>({
  label,
  value,
  onSelect,
  load,
  getId,
  getLabel,
  getValueLabel,
  disabled = false,
  cacheKey = "",
}: {
  cacheKey?: string;
  label: string;
  value?: T;
  onSelect: (item: T) => void;
  load: (
    params: Params,
    signal: AbortSignal,
  ) => Promise<{ items: T[]; page: number; totalPages: number }>;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  getValueLabel?: (item: T) => string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ["selector", label, cacheKey, search, page],
    queryFn: ({ signal }) => load({ search, page, pageSize: 20 }, signal),
    enabled: open && !disabled,
  });
  const outer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!outer.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="async-select" ref={outer}>
      <span className="selector-label">{label}</span>
      <Button
        title={value ? getLabel(value) : label}
        className="selector-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span className="selector-value">
          {value
            ? (getValueLabel || getLabel)(value)
            : `Chọn ${label.toLowerCase()}`}
        </span>
        <span aria-hidden="true">⌄</span>
      </Button>
      {open && (
        <div
          className="select-menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              outer.current
                ?.querySelector<HTMLButtonElement>(".selector-trigger")
                ?.focus();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const options = Array.from(
                outer.current?.querySelectorAll<HTMLButtonElement>(
                  "[role=option]",
                ) || [],
              );
              if (!options.length) return;
              const index = options.findIndex(
                (o) => o === document.activeElement,
              );
              const next =
                e.key === "ArrowDown"
                  ? (index + 1) % options.length
                  : index <= 0
                    ? options.length - 1
                    : index - 1;
              options[next]?.focus();
            }
          }}
        >
          <input
            autoFocus
            aria-label={`Tìm ${label}`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo tên…"
          />
          {result.isPending ? (
            <Loading />
          ) : result.error ? (
            <ErrorState
              error={result.error}
              retry={() => void result.refetch()}
            />
          ) : (
            <>
              <div role="listbox" aria-label={`Danh sách ${label}`}>
                {result.data?.items.map((item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={value && getId(item) === getId(value)}
                    key={getId(item)}
                    onClick={() => {
                      onSelect(item);
                      setOpen(false);
                    }}
                  >
                    {getLabel(item)}
                  </button>
                ))}
              </div>
              {result.data?.items.length === 0 && (
                <p>Không tìm thấy dữ liệu.</p>
              )}
              <div className="inline-actions">
                <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  <ArrowLeft size={15} />
                </Button>
                <span>Trang {page}</span>
                <Button
                  disabled={!result.data || page >= result.data.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ArrowRight size={15} />
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiAccess({ children }: { children: ReactNode }) {
  const c = useWarehouse(),
    auth = useAuth();
  if (!auth.ready) return <Loading label="Đang kiểm tra phiên đăng nhập…" />;
  if (!c.enabled)
    return (
      <Card>
        <Empty
          title="Dữ liệu cần phiên truy cập hợp lệ"
          description={
            auth.configured
              ? "Đăng nhập bằng tài khoản được cấp quyền để tải dữ liệu từ Java API."
              : "Kết nối đăng nhập OIDC chưa được cấu hình. Không có dữ liệu giả hoặc truy cập bỏ qua xác thực."
          }
        />
      </Card>
    );
  return <>{children}</>;
}

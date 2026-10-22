import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCode2,
  FileText,
  Play,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { importApi } from "../api/importApi";
import { warehouseApi } from "../api/warehouseApi";
import type { ImportPlan, ImportRun } from "../api/schema";
import { engineLabel, formatDate } from "../lib/format";
import { PageHeading } from "../components/Shell";
import {
  ApiAccess,
  Badge,
  Button,
  Card,
  DataGrid,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Modal,
  Notice,
  Pagination,
  Resource,
  useListState,
} from "../components/ui";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const acceptedTypes = new Set([
  "",
  "text/plain",
  "application/sql",
  "text/x-sql",
  "application/octet-stream",
]);

export function SqlImportPage() {
  const c = useWarehouse();
  return (
    <>
      <PageHeading
        title="Import SQL"
        description="Tải lên script SQL để phân tích, xem trước kế hoạch và nhập dữ liệu đã xác thực vào warehouse. File không được thực thi trực tiếp."
        art={<FileCode2 size={52} />}
      />
      <ApiAccess>
        <SqlImportContent key={c.warehouseId} />
      </ApiAccess>
    </>
  );
}

function SqlImportContent() {
  const c = useWarehouse();
  const auth = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { runId } = useParams();
  const list = useListState("createdAt");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [targetWarehouseId, setTargetWarehouseId] = useState(c.warehouseId);
  const [targetSchema, setTargetSchema] = useState("");
  const [formError, setFormError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const attempt = useRef<{ planId: string; key: string } | null>(null);

  const warehouses = useQuery({
    queryKey: ["warehouses", "sql-import-targets"],
    queryFn: ({ signal }) =>
      warehouseApi.list({ page: 1, pageSize: 100 }, signal),
  });
  useEffect(() => {
    setTargetWarehouseId(c.warehouseId);
    setTargetSchema("");
  }, [c.warehouseId]);
  const runs = useQuery({
    queryKey: ["sql-import-runs", list.params],
    queryFn: ({ signal }) => importApi.runs(list.params, signal),
    refetchInterval: (query) =>
      query.state.data?.items.some((run) =>
        ["PENDING", "RUNNING"].includes(run.status),
      )
        ? 3000
        : false,
  });
  const selectedRun = useQuery({
    queryKey: ["sql-import-run", runId],
    queryFn: ({ signal }) => importApi.get(runId!, signal),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      query.state.data &&
      ["PENDING", "RUNNING"].includes(query.state.data.status)
        ? 2000
        : false,
  });
  const validate = useMutation({
    mutationFn: (input: Parameters<typeof importApi.validate>[0]) =>
      importApi.validate(input),
    onSuccess: (result) => {
      setPlan(result);
      setFormError("");
      attempt.current = null;
    },
  });
  const start = useMutation({
    mutationFn: (current: ImportPlan) => {
      if (!attempt.current || attempt.current.planId !== current.planId) {
        attempt.current = {
          planId: current.planId,
          key: crypto.randomUUID(),
        };
      }
      return importApi.run({
        planId: current.planId,
        planDigest: current.planDigest,
        idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: (run) => {
      setConfirming(false);
      setPlan(null);
      setFile(null);
      void client.invalidateQueries({ queryKey: ["sql-import-runs"] });
      navigate(`/import/sql/${encodeURIComponent(run.runId)}`);
    },
  });

  const submitValidation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setPlan(null);
    const form = new FormData(event.currentTarget);
    const sourceDialect = String(form.get("sourceDialect") || "");
    const warehouseId = String(form.get("warehouseId") || "");
    const schema = String(form.get("targetSchema") || "").trim();
    if (!auth.can("OPERATOR") && !auth.can("ADMIN")) {
      setFormError("Bạn cần quyền OPERATOR hoặc ADMIN để nhập SQL.");
      return;
    }
    if (!file) {
      setFormError("Chọn một file .sql để kiểm tra.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".sql")) {
      setFormError("Chỉ chấp nhận tệp có phần mở rộng .sql.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      setFormError("Kích thước file phải từ 1 byte đến 2 MiB.");
      return;
    }
    if (!acceptedTypes.has(file.type.toLowerCase())) {
      setFormError("Kiểu nội dung file không được hỗ trợ.");
      return;
    }
    if (!sourceDialect || !warehouseId || !schema) {
      setFormError("Chọn dialect, warehouse và schema đích.");
      return;
    }
    validate.mutate({ file, sourceDialect, warehouseId, targetSchema: schema });
  };

  return (
    <>
      <Card title="Tạo kế hoạch import" icon={<Upload size={22} />}>
        <Notice>
          <ShieldCheck size={17} />
          Java phân tích và validate file trước. Chỉ kế hoạch đã xem trước mới
          có thể được xác nhận; SQL gốc không được gửi trực tiếp tới database.
        </Notice>
        <form className="stack import-form" onSubmit={submitValidation}>
          <fieldset disabled={!auth.can("OPERATOR") && !auth.can("ADMIN")}>
            <div className="form-grid">
              <Field label="Dialect nguồn">
                <select
                  name="sourceDialect"
                  defaultValue="AUTO_DETECT"
                  required
                >
                  <option value="AUTO_DETECT">Tự nhận diện</option>
                  <option value="POSTGRESQL">PostgreSQL</option>
                  <option value="MYSQL">MySQL</option>
                  <option value="SQL_SERVER">SQL Server</option>
                </select>
              </Field>
              <Field label="Warehouse đích">
                <Resource resource={warehouses}>
                  {(page) => (
                    <select
                      name="warehouseId"
                      value={targetWarehouseId}
                      required
                      onChange={(event) => {
                        const nextId = event.currentTarget.value;
                        setTargetWarehouseId(nextId);
                        setTargetSchema("");
                        setPlan(null);
                      }}
                    >
                      <option value="">Chọn warehouse</option>
                      {page.items
                        .filter((warehouse) => warehouse.status === "ACTIVE")
                        .map((warehouse) => (
                          <option
                            key={warehouse.warehouseId}
                            value={warehouse.warehouseId}
                          >
                            {warehouse.name} · {engineLabel[warehouse.engine]}
                          </option>
                        ))}
                    </select>
                  )}
                </Resource>
              </Field>
              <Field label="Schema đích">
                <input
                  name="targetSchema"
                  value={targetSchema}
                  placeholder="Nhập namespace đã tạo và cấp quyền writer"
                  onChange={(event) =>
                    setTargetSchema(event.currentTarget.value)
                  }
                  minLength={1}
                  maxLength={128}
                  autoComplete="off"
                  required
                />
              </Field>
              <Field label="File SQL (tối đa 2 MiB)">
                <input
                  type="file"
                  accept=".sql,text/plain,application/sql,text/x-sql"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setPlan(null);
                    setFormError("");
                  }}
                />
              </Field>
            </div>
          </fieldset>
          {file && (
            <p className="muted import-file-summary">
              <FileText size={17} /> {file.name} · {formatBytes(file.size)}
            </p>
          )}
          {formError && <Notice tone="error">{formError}</Notice>}
          {validate.error && <ErrorState error={validate.error} />}
          <div className="inline-actions">
            <Button
              type="submit"
              variant="primary"
              disabled={
                validate.isPending ||
                (!auth.can("OPERATOR") && !auth.can("ADMIN"))
              }
            >
              <ShieldCheck size={17} />
              {validate.isPending
                ? "Đang kiểm tra file…"
                : "Kiểm tra và xem trước"}
            </Button>
            {plan && (
              <Button
                type="button"
                onClick={() => {
                  setPlan(null);
                  setFile(null);
                }}
              >
                Hủy kế hoạch
              </Button>
            )}
          </div>
        </form>
      </Card>

      {plan && (
        <ImportPlanReview
          plan={plan}
          busy={start.isPending}
          error={start.error}
          onConfirm={() => setConfirming(true)}
        />
      )}

      <div className={runId ? "catalog-grid" : "catalog-single"}>
        <Card title="Lịch sử SQL Import" icon={<Database size={22} />}>
          <Resource resource={runs}>
            {(page) => (
              <>
                <DataGrid
                  rows={page.items}
                  rowKey={(run) => run.runId}
                  selected={runId}
                  onSelect={(run) =>
                    navigate(`/import/sql/${encodeURIComponent(run.runId)}`)
                  }
                  columns={[
                    {
                      key: "runId",
                      label: "Run ID",
                      render: (run) => run.runId,
                    },
                    {
                      key: "warehouseId",
                      label: "Warehouse / schema",
                      render: (run) => {
                        const warehouse = warehouses.data?.items.find(
                          (item) => item.warehouseId === run.warehouseId,
                        );
                        return (
                          <>
                            <span>{warehouse?.name || run.warehouseId}</span>
                            <small>
                              {run.targetSchema} ·{" "}
                              {engineLabel[run.targetEngine]}
                            </small>
                          </>
                        );
                      },
                    },
                    {
                      key: "sourceDialect",
                      label: "Dialect",
                      render: (run) =>
                        `${run.sourceDialect} → ${run.targetEngine}`,
                    },
                    {
                      key: "status",
                      label: "Trạng thái",
                      render: (run) => <Badge status={run.status} />,
                    },
                    {
                      key: "statements",
                      label: "Statements",
                      render: (run) =>
                        `${run.completedStatements}/${run.statementCount}`,
                    },
                    {
                      key: "createdAt",
                      label: "Thời gian tạo",
                      render: (run) => formatDate(run.createdAt),
                    },
                  ]}
                />
                <Pagination {...page} onChange={list.paginate} />
              </>
            )}
          </Resource>
        </Card>
        {runId && (
          <aside>
            <Card title="Chi tiết lần import">
              <Resource resource={selectedRun}>
                {(run) => <ImportRunDetail run={run} />}
              </Resource>
            </Card>
          </aside>
        )}
      </div>

      {confirming && plan && (
        <Modal
          title="Xác nhận thực thi kế hoạch?"
          role="alertdialog"
          descriptionId="import-confirm-copy"
          onClose={() => {
            if (!start.isPending) setConfirming(false);
          }}
        >
          <p id="import-confirm-copy">
            {plan.statementCount} câu lệnh sẽ tác động lên warehouse
            <strong> {plan.warehouseId}</strong>, schema
            <strong> {plan.targetSchema}</strong>. Hành động này chỉ chạy những
            statement đã được server validate.
          </p>
          <div className="inline-actions">
            <Button
              disabled={start.isPending}
              onClick={() => setConfirming(false)}
            >
              Quay lại xem
            </Button>
            <Button
              variant="primary"
              disabled={start.isPending}
              onClick={() => start.mutate(plan)}
            >
              <Play size={17} />
              {start.isPending ? "Đang tạo lần import…" : "Xác nhận import"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ImportPlanReview({
  plan,
  busy,
  error,
  onConfirm,
}: {
  plan: ImportPlan;
  busy: boolean;
  error: Error | null;
  onConfirm: () => void;
}) {
  const expired = Date.parse(plan.expiresAt) <= Date.now();
  return (
    <Card
      title="Kế hoạch đã xác thực"
      icon={<CheckCircle2 size={22} />}
      actions={<Badge status={expired ? "EXPIRED" : "VALIDATED"} />}
    >
      <DetailList
        items={[
          ["Dialect được chọn", plan.sourceDialect],
          ["Dialect nhận diện", plan.detectedDialect],
          ["Warehouse đích", plan.warehouseId],
          ["Engine đích", engineLabel[plan.targetEngine]],
          ["Schema", plan.targetSchema],
          ["Chế độ", plan.mode],
          ["Statements", plan.statementCount],
          ["Objects", plan.objectCount],
          ["Hết hạn", formatDate(plan.expiresAt)],
        ]}
      />
      {plan.warnings.length > 0 && (
        <Notice>
          <AlertTriangle size={17} />
          <div>
            <strong>Cảnh báo từ parser</strong>
            <ul>
              {plan.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        </Notice>
      )}
      {plan.unsupportedFeatures.length > 0 && (
        <Notice tone="error">
          <div>
            <strong>
              Có feature không được hỗ trợ; kế hoạch không thể chạy.
            </strong>
            <ul>
              {plan.unsupportedFeatures.map((feature, index) => (
                <li key={index}>{feature}</li>
              ))}
            </ul>
          </div>
        </Notice>
      )}
      {plan.supportedActions.length > 0 && (
        <div className="chips">
          {plan.supportedActions.map((action) => (
            <span className="chip" key={action}>
              {action}
            </span>
          ))}
        </div>
      )}
      <h3>Statement preview</h3>
      {plan.preview.statements?.length ? (
        <DataGrid
          rows={plan.preview.statements}
          rowKey={(statement) => String(statement.index)}
          columns={[
            {
              key: "index",
              label: "#",
              render: (statement) => statement.index,
            },
            {
              key: "kind",
              label: "Loại",
              render: (statement) => statement.kind,
            },
            {
              key: "objectName",
              label: "Đối tượng",
              render: (statement) => statement.objectName,
            },
            {
              key: "summary",
              label: "Thao tác đã phân tích",
              render: (statement) => statement.summary,
            },
          ]}
        />
      ) : (
        <Notice>
          Parser đã tạo preview schema/table có cấu trúc. Server không gửi danh
          sách statement thô trong phản hồi này.
        </Notice>
      )}
      {plan.preview.schemas.map((schema) => (
        <details className="import-schema" key={schema.name} open>
          <summary>
            {schema.name} · {schema.tables.length} bảng
          </summary>
          {schema.tables.map((table) => (
            <details key={`${schema.name}.${table.name}`}>
              <summary>
                {table.name} · {table.columns.length} cột
              </summary>
              <ul>
                {table.columns.map((column) => (
                  <li key={column.name}>
                    <code>{column.name}</code> · {column.dataType}
                    {column.nullable ? " · nullable" : " · required"}
                    {column.primaryKey ? " · PK" : ""}
                    {column.unique ? " · UNIQUE" : ""}
                    {column.identity ? " · identity" : ""}
                    {column.hasDefault
                      ? ` · DEFAULT ${column.defaultValue ?? "(empty)"}`
                      : ""}
                  </li>
                ))}
              </ul>
              {table.constraints.length > 0 && (
                <div className="import-preview-metadata">
                  <strong>Ràng buộc</strong>
                  <ul>
                    {table.constraints.map((constraint, index) => (
                      <li
                        key={`${constraint.kind}-${constraint.name}-${index}`}
                      >
                        {constraint.kind}
                        {constraint.name ? ` ${constraint.name}` : ""} (
                        {constraint.columns.join(", ")})
                        {constraint.kind === "FOREIGN_KEY" &&
                          ` → ${constraint.referenceSchema}.${constraint.referenceTable} (${constraint.referenceColumns.join(", ")})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {table.indexes.length > 0 && (
                <div className="import-preview-metadata">
                  <strong>Indexes</strong>
                  <ul>
                    {table.indexes.map((index) => (
                      <li key={index.name}>
                        {index.unique ? "UNIQUE " : ""}
                        {index.name} ({index.columns.join(", ")})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
          ))}
        </details>
      ))}
      {error && <ErrorState error={error} />}
      <div className="inline-actions">
        <Button
          variant="primary"
          disabled={busy || expired || plan.unsupportedFeatures.length > 0}
          onClick={onConfirm}
        >
          <Play size={17} /> Xem lại và xác nhận
        </Button>
        {expired && (
          <Notice tone="error">
            Kế hoạch đã hết hạn. Hãy validate file lại.
          </Notice>
        )}
      </div>
    </Card>
  );
}

function ImportRunDetail({ run }: { run: ImportRun }) {
  return (
    <>
      <div className="dataset-title">
        <span className="icon-tile">
          <Database />
        </span>
        <div>
          <h3>{run.runId}</h3>
          <Badge status={run.status} />
        </div>
      </div>
      <DetailList
        items={[
          ["Warehouse", run.warehouseId],
          ["Schema", run.targetSchema],
          ["Engine", engineLabel[run.targetEngine]],
          ["Dialect nguồn", run.sourceDialect],
          [
            "Statements hoàn tất",
            `${run.completedStatements}/${run.statementCount}`,
          ],
          ["Rows affected", run.rowsAffected],
          ["Bắt đầu", formatDate(run.createdAt)],
          ["Hoàn tất", formatDate(run.completedAt)],
        ]}
      />
      {run.error && <Notice tone="error">{run.error.message}</Notice>}
      <h3>Các bước thực thi</h3>
      {run.steps.length ? (
        <ol className="import-step-list">
          {run.steps.map((step) => (
            <li key={step.index}>
              <div>
                <strong>{step.kind}</strong>
                <span>{step.objectName}</span>
              </div>
              <Badge status={step.status} />
              {step.rowsAffected > 0 && (
                <small>{step.rowsAffected.toLocaleString("vi-VN")} rows</small>
              )}
              {step.error && <Notice tone="error">{step.error.message}</Notice>}
            </li>
          ))}
        </ol>
      ) : (
        <Empty
          title="Chưa có kết quả statement"
          description="Chi tiết sẽ tự làm mới khi lần import đang chạy."
        />
      )}
    </>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

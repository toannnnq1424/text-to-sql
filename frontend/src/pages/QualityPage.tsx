import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { ApiError } from "../api/client";
import { qualityApi } from "../api/qualityApi";
import {
  type QualityRule,
  type QualityRun,
  type QualityCheck,
} from "../api/qualitySchema";
import type { ErrorBody } from "../api/schema";
import { PageHeading } from "../components/Shell";
import {
  QualityRuleEditor,
  qualityTypeHelp,
  qualityTypeLabel,
} from "../components/QualityRuleEditor";
import {
  ApiAccess,
  Badge,
  Button,
  Card,
  ContextGate,
  CopyButton,
  DataGrid,
  DetailList,
  Empty,
  ErrorState,
  Modal,
  Notice,
  Pagination,
  Resource,
  Stat,
} from "../components/ui";
import { formatDate, formatDuration } from "../lib/format";

const tableLabel = (table: { schema: string; name: string }) =>
  `${table.schema}.${table.name}`;
const countLabel = (value: string | null) =>
  value === null ? "—" : BigInt(value).toLocaleString("vi-VN");
const failure = (error: ErrorBody) =>
  new ApiError(
    error.code,
    error.message,
    error.correlationId,
    0,
    error.details,
    error.retryable,
  );
export function QualityPage() {
  const context = useWarehouse();
  return (
    <ApiAccess>
      <PageHeading
        title="Chất lượng dữ liệu"
        description="Định nghĩa quy tắc theo schema hiện tại, kiểm tra toàn bộ dữ liệu được phép và theo dõi kết quả có lịch sử. Không tự sửa dữ liệu nguồn."
      />
      <ContextGate>
        <QualityWorkbench key={`${context.warehouseId}/${context.datasetId}`} />
      </ContextGate>
    </ApiAccess>
  );
}
function QualityWorkbench() {
  const context = useWarehouse();
  const auth = useAuth();
  const client = useQueryClient();
  const canManage = auth.can("OPERATOR");
  const [draft, setDraft] = useState<QualityRule[] | null>(null);
  const [editing, setEditing] = useState<QualityRule | "new" | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedCheckId, setSelectedCheckId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const rules = useQuery({
    queryKey: ["quality-rules", context.datasetId],
    queryFn: ({ signal }) => qualityApi.rules(context.datasetId, signal),
  });
  const history = useQuery({
    queryKey: ["quality-runs", context.datasetId, page, pageSize],
    queryFn: ({ signal }) =>
      qualityApi.runs(context.datasetId, { page, pageSize }, signal),
  });
  const runId = selectedRunId || history.data?.items[0]?.runId || "";
  const selected = useQuery({
    queryKey: ["quality-run", context.datasetId, runId],
    queryFn: ({ signal }) => qualityApi.get(context.datasetId, runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      query.state.data?.status === "RUNNING" ? 1000 : false,
  });
  const currentRules = draft ?? rules.data?.rules ?? [];
  const dirty = draft !== null;
  const running = selected.data?.status === "RUNNING";
  const save = useMutation({
    mutationFn: () =>
      qualityApi.save(context.datasetId, {
        revision: rules.data!.revision,
        rules: currentRules,
      }),
    onSuccess: (data) => {
      client.setQueryData(["quality-rules", context.datasetId], data);
      if (mounted.current) {
        setDraft(null);
        setNotice(
          "Đã lưu bộ quy tắc. Các lần chạy trước giữ nguyên snapshot và kết quả.",
        );
      }
    },
  });
  const start = useMutation({
    mutationFn: () => qualityApi.run(context.datasetId),
    onSuccess: (data) => {
      client.setQueryData(["quality-run", context.datasetId, data.runId], data);
      void client.invalidateQueries({
        queryKey: ["quality-runs", context.datasetId],
      });
      if (mounted.current) {
        setSelectedRunId(data.runId);
        setSelectedCheckId("");
        setPage(1);
        setNotice("");
      }
    },
  });
  useEffect(() => {
    if (selected.data?.status && selected.data.status !== "RUNNING")
      void client.invalidateQueries({
        queryKey: ["quality-runs", context.datasetId],
      });
  }, [selected.data?.runId, selected.data?.status, context.datasetId, client]);
  const busy = save.isPending || start.isPending;
  const remove = (id: string) => {
    setDraft(currentRules.filter((item) => item.ruleId !== id));
    setNotice("");
    save.reset();
  };
  const reload = async () => {
    setDraft(null);
    save.reset();
    await rules.refetch();
  };
  return (
    <div className="quality-workbench">
      <div className="stats-grid four">
        <Stat
          label="Quy tắc đã lưu"
          value={rules.data?.rules.length ?? "—"}
          icon={<ClipboardCheck size={22} />}
          note={
            rules.data
              ? `Phiên bản ${rules.data.revision}`
              : "Đang lấy cấu hình"
          }
        />
        <Stat
          label="Đang bật"
          value={rules.data?.rules.filter((rule) => rule.enabled).length ?? "—"}
          icon={<ShieldCheck size={22} />}
          note="Chỉ quy tắc đã lưu được chạy"
        />
        <Stat
          label="Lần chạy mới nhất"
          value={
            history.data?.items[0] ? (
              <Badge status={history.data.items[0].status} />
            ) : (
              "—"
            )
          }
          icon={<Clock3 size={22} />}
          note={
            history.data?.items[0]
              ? formatDate(history.data.items[0].createdAt)
              : "Chưa có lần kiểm tra"
          }
        />
        <Stat
          label="Phạm vi kiểm tra"
          value="Toàn bảng"
          icon={<CheckCircle2 size={22} />}
          note="Theo quyền đọc và thời hạn thực thi"
        />
      </div>
      {!canManage && (
        <Notice>
          Bạn có thể xem quy tắc và kết quả. Chỉ ADMIN hoặc OPERATOR có quyền
          tài nguyên được lưu quy tắc và chạy kiểm tra.
        </Notice>
      )}
      <Card
        title="Bộ quy tắc của dataset"
        icon={<ClipboardCheck size={21} />}
        actions={
          canManage && (
            <div className="quality-actions">
              <Button
                disabled={busy || !rules.data || currentRules.length >= 20}
                onClick={() => setEditing("new")}
              >
                <Plus size={17} />
                Thêm quy tắc
              </Button>
              <Button
                variant="primary"
                disabled={busy || !dirty || !rules.data}
                onClick={() => {
                  setNotice("");
                  save.mutate();
                }}
              >
                <Save size={17} />
                {save.isPending ? "Đang lưu…" : "Lưu bộ quy tắc"}
              </Button>
            </div>
          )
        }
      >
        <p className="muted">
          {context.dataset?.name} · tối đa 20 quy tắc. Các kiểm tra chỉ đọc dữ
          liệu và lưu số liệu tổng hợp, không lấy mẫu dòng nhạy cảm.
        </p>
        {dirty && (
          <Notice tone="warning">
            Bản nháp chưa lưu. Lưu bộ quy tắc trước khi chạy; thay đổi này chưa
            ảnh hưởng tới dữ liệu hoặc lịch sử.
            <Button disabled={busy} onClick={() => void reload()}>
              <RefreshCw size={15} />
              Bỏ nháp / tải lại
            </Button>
          </Notice>
        )}
        {save.error && <ErrorState error={save.error} />}
        {save.error instanceof ApiError && save.error.status === 409 && (
          <Button onClick={() => void reload()}>
            <RefreshCw size={16} />
            Tải lại cấu hình sau xung đột
          </Button>
        )}
        {notice && <Notice tone="success">{notice}</Notice>}
        <Resource resource={rules}>
          {() =>
            currentRules.length ? (
              <div className="quality-rule-list">
                {currentRules.map((rule) => (
                  <article className="quality-rule-row" key={rule.ruleId}>
                    <div
                      className={`quality-rule-icon ${rule.enabled ? "" : "muted"}`}
                    >
                      <ShieldCheck size={21} />
                    </div>
                    <div className="quality-rule-identity">
                      <h3>{rule.name}</h3>
                      <span>
                        {qualityTypeLabel[rule.type]} ·{" "}
                        <code>
                          {tableLabel(rule.table)}
                          {"column" in rule ? `.${rule.column}` : ""}
                        </code>
                      </span>
                      <small>{ruleSummary(rule)}</small>
                    </div>
                    <span
                      className={`badge ${rule.enabled ? "good" : "neutral"}`}
                    >
                      {rule.enabled ? "Đang bật" : "Đã tắt"}
                    </span>
                    {canManage && (
                      <div className="quality-actions">
                        <Button
                          aria-label={`Sửa ${rule.name}`}
                          disabled={busy}
                          onClick={() => setEditing(rule)}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="danger"
                          aria-label={`Bỏ ${rule.name} khỏi bản nháp`}
                          disabled={busy}
                          onClick={() => remove(rule.ruleId)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title="Chưa có quy tắc"
                description="Tạo quy tắc từ bảng và cột được phép của dataset hiện tại. Không có dữ liệu kiểm tra giả hoặc quy tắc mẫu được tự chèn."
              />
            )
          }
        </Resource>
        <div className="quality-run-controls">
          <div>
            <strong>Chạy trên bộ quy tắc đã lưu</strong>
            <small>
              Đọc toàn bảng; tối đa 15 giây mỗi kiểm tra và 120 giây mỗi lần
              chạy. Dữ liệu có thể thay đổi giữa các kiểm tra.
            </small>
          </div>
          {canManage && (
            <Button
              variant="primary"
              disabled={
                busy ||
                dirty ||
                !rules.data?.rules.some((rule) => rule.enabled) ||
                running
              }
              onClick={() => start.mutate()}
            >
              <Play size={17} />
              {start.isPending
                ? "Đang gửi…"
                : running
                  ? "Đang kiểm tra…"
                  : "Chạy kiểm tra"}
            </Button>
          )}
        </div>
        {start.error && <ErrorState error={start.error} />}
      </Card>
      <div className="quality-results-layout">
        <Card
          title="Lịch sử kiểm tra"
          icon={<Clock3 size={21} />}
          actions={
            <Button
              aria-label="Làm mới lịch sử kiểm tra"
              disabled={history.isFetching}
              onClick={() => void history.refetch()}
            >
              <RefreshCw size={17} />
            </Button>
          }
        >
          <Resource resource={history}>
            {(data) => (
              <>
                <DataGrid
                  rows={data.items}
                  rowKey={(row) => row.runId}
                  selected={runId}
                  onSelect={(row) => {
                    setSelectedRunId(row.runId);
                    setSelectedCheckId("");
                  }}
                  columns={[
                    {
                      key: "runId",
                      label: "Lần chạy",
                      render: (row) => (
                        <span className="quality-run-id" title={row.runId}>
                          {row.runId}
                        </span>
                      ),
                    },
                    {
                      key: "status",
                      label: "Kết quả",
                      render: (row) => <Badge status={row.status} />,
                    },
                    {
                      key: "revision",
                      label: "Phiên bản",
                      render: (row) => row.revision,
                    },
                    {
                      key: "createdAt",
                      label: "Thời gian",
                      render: (row) => formatDate(row.createdAt),
                    },
                  ]}
                />
                {!data.items.length && (
                  <p className="muted">
                    Chạy kiểm tra để lưu kết quả đầu tiên cho dataset này.
                  </p>
                )}
                <Pagination
                  {...data}
                  onChange={(next, size) => {
                    setPage(next);
                    setPageSize(size);
                  }}
                />
              </>
            )}
          </Resource>
        </Card>
        <Card title="Chi tiết lần chạy" icon={<ClipboardCheck size={21} />}>
          {!runId ? (
            <Empty
              title="Chưa chọn lần chạy"
              description="Chọn lịch sử hoặc chạy bộ quy tắc đã lưu để xem số liệu thật."
            />
          ) : (
            <Resource resource={selected}>
              {(run) => <RunSummary run={run} />}
            </Resource>
          )}
        </Card>
      </div>
      {runId && selected.data && (
        <Card title="Kết quả từng quy tắc" icon={<ShieldCheck size={21} />}>
          {selected.error ? (
            <ErrorState
              error={selected.error}
              retry={() => void selected.refetch()}
            />
          ) : (
            <>
              <DataGrid
                rows={selected.data.checks}
                rowKey={(row) => row.ruleId}
                selected={selectedCheckId}
                onSelect={(row) =>
                  setSelectedCheckId(
                    selectedCheckId === row.ruleId ? "" : row.ruleId,
                  )
                }
                columns={[
                  {
                    key: "name",
                    label: "Quy tắc",
                    render: (row) => <strong>{row.name}</strong>,
                  },
                  {
                    key: "type",
                    label: "Kiểm tra",
                    render: (row) => qualityTypeLabel[row.type],
                  },
                  {
                    key: "table",
                    label: "Bảng / cột",
                    render: (row) => (
                      <code>
                        {tableLabel(row.table)}
                        {row.column ? `.${row.column}` : ""}
                      </code>
                    ),
                  },
                  {
                    key: "status",
                    label: "Kết quả",
                    render: (row) => <Badge status={row.status} />,
                  },
                  {
                    key: "checkedRows",
                    label: "Dòng đã kiểm",
                    render: (row) => countLabel(row.checkedRows),
                  },
                  {
                    key: "violations",
                    label: "Vi phạm",
                    render: (row) => countLabel(row.violations),
                  },
                  {
                    key: "durationMs",
                    label: "Thời gian",
                    render: (row) => formatDuration(row.durationMs),
                  },
                ]}
              />
              {selected.data.checks.find(
                (item) => item.ruleId === selectedCheckId,
              ) && (
                <CheckDetail
                  check={selected.data.checks.find(
                    (item) => item.ruleId === selectedCheckId,
                  )!}
                  rule={selected.data.rules.find(
                    (rule) => rule.ruleId === selectedCheckId,
                  )}
                  onClose={() => setSelectedCheckId("")}
                />
              )}
              <p className="muted quality-footnote">
                Không cộng số vi phạm giữa các quy tắc vì một dòng có thể vi
                phạm nhiều lần. Kiểm tra số dòng báo 0 hoặc 1 lần assertion vi
                phạm; các kiểm tra khác đếm dòng theo định nghĩa riêng.
              </p>
            </>
          )}
        </Card>
      )}
      {editing && (
        <Modal
          title={
            editing === "new"
              ? "Thêm quy tắc chất lượng"
              : "Chỉnh sửa quy tắc chất lượng"
          }
          onClose={() => setEditing(null)}
        >
          <QualityRuleEditor
            datasetId={context.datasetId}
            rule={editing === "new" ? undefined : editing}
            existingIds={currentRules
              .filter(
                (item) => editing === "new" || item.ruleId !== editing.ruleId,
              )
              .map((item) => item.ruleId)}
            onApply={(rule) => {
              setDraft(
                editing === "new"
                  ? [...currentRules, rule]
                  : currentRules.map((item) =>
                      item.ruleId === rule.ruleId ? rule : item,
                    ),
              );
              setEditing(null);
              setNotice("");
              save.reset();
            }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
function ruleSummary(rule: QualityRule) {
  if (rule.type === "RANGE" || rule.type === "ROW_COUNT")
    return `Từ ${rule.min ?? "không giới hạn"} đến ${rule.max ?? "không giới hạn"} (bao gồm biên)`;
  if (rule.type === "ACCEPTED_VALUES")
    return `${rule.values.length} giá trị cho phép · theo collation database`;
  if (rule.type === "REFERENCE")
    return `Tham chiếu ${tableLabel(rule.referenceTable)}.${rule.referenceColumn}`;
  return qualityTypeHelp[rule.type];
}
function RunSummary({ run }: { run: QualityRun }) {
  const passed = run.checks.filter((check) => check.status === "PASSED").length;
  const failed = run.checks.filter((check) => check.status === "FAILED").length;
  const errors = run.checks.filter((check) => check.status === "ERROR").length;
  const done = run.checks.length;
  return (
    <div className="quality-run-summary">
      <div className="quality-summary-heading">
        <Badge status={run.status} />
        <span>Phiên bản {run.revision}</span>
      </div>
      {run.status === "RUNNING" && (
        <Notice>
          Đang kiểm tra… Đã hoàn tất {done} kiểm tra. Kết quả tự cập nhật;
          chuyển trang không hủy tác vụ trên server.
        </Notice>
      )}
      <div className="quality-outcomes" aria-label="Phân bố kết quả kiểm tra">
        <div>
          <CheckCircle2 size={19} />
          <strong>{passed}</strong>
          <span>Đạt</span>
        </div>
        <div>
          <AlertTriangle size={19} />
          <strong>{failed}</strong>
          <span>Vi phạm</span>
        </div>
        <div>
          <X size={19} />
          <strong>{errors}</strong>
          <span>Lỗi thực thi</span>
        </div>
      </div>
      {done > 0 && (
        <div className="quality-distribution" aria-hidden="true">
          <span style={{ flex: passed }} className="passed" />
          <span style={{ flex: failed }} className="failed" />
          <span style={{ flex: errors }} className="error" />
        </div>
      )}
      <DetailList
        items={[
          ["Run ID", <CopyButton text={run.runId} label={run.runId} />],
          ["Khởi tạo", formatDate(run.createdAt)],
          [
            "Hoàn tất",
            run.completedAt ? formatDate(run.completedAt) : "Chưa hoàn tất",
          ],
          [
            "Correlation ID",
            <CopyButton text={run.correlationId} label={run.correlationId} />,
          ],
          ["Phạm vi", "Toàn bộ dữ liệu được cấp quyền"],
          ["Tính nhất quán", "Riêng từng kiểm tra (PER_CHECK)"],
        ]}
      />
      {run.error && <ErrorState error={failure(run.error)} />}
      <small className="muted">
        Mỗi kiểm tra đọc tại thời điểm riêng. Đây không phải một snapshot giao
        dịch chung cho cả lần chạy.
      </small>
    </div>
  );
}
function CheckDetail({
  check,
  rule,
  onClose,
}: {
  check: QualityCheck;
  rule?: QualityRule;
  onClose: () => void;
}) {
  return (
    <article className="quality-check-detail">
      <header>
        <h3>{check.name}</h3>
        <Button aria-label="Đóng chi tiết kiểm tra" onClick={onClose}>
          <X size={17} />
        </Button>
      </header>
      <p>{qualityTypeHelp[check.type]}</p>
      {rule && (
        <p>
          <strong>Định nghĩa lúc chạy: </strong>
          {ruleSummary(rule)}
        </p>
      )}
      {check.observedValue !== null && (
        <p>
          <strong>Giá trị quan sát: </strong>
          <code>{check.observedValue}</code>
        </p>
      )}
      {check.error && <ErrorState error={failure(check.error)} />}
    </article>
  );
}

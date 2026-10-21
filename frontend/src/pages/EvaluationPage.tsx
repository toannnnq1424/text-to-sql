import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Clock3,
  Download,
  FileCheck2,
  Play,
  ShieldCheck,
  Target,
} from "lucide-react";
import { useWarehouse } from "../app/providers";
import { useAuth } from "../app/auth";
import { evaluationApi } from "../api/evaluationApi";
import { settingsApi } from "../api/settingsApi";
import type { Mode } from "../api/schema";
import {
  downloadText,
  engineLabel,
  formatDate,
  formatDuration,
  formatRate,
  isActive,
} from "../lib/format";
import { PageHeading } from "../components/Shell";
import { RegistryFilterFields } from "../components/FilterFields";
import {
  ApiAccess,
  AsyncSelect,
  Badge,
  Button,
  Card,
  DataGrid,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Filters,
  Notice,
  Pagination,
  Resource,
  SqlBlock,
  Stat,
  useListState,
} from "../components/ui";
import { ResultTable } from "../components/ResultTable";
export function EvaluationPage() {
  const c = useWarehouse();
  return (
    <>
      <PageHeading
        title="Đánh giá mô hình Text-to-SQL"
        description="Đo chất lượng SQL trên bộ test với nhiều tiêu chí: kết quả tương đương, độ chính xác dialect, từ chối SQL không hợp lệ và thời gian phản hồi."
      />
      <ApiAccess>
        <EvaluationContent key={`${c.warehouseId}/${c.datasetId}`} />
      </ApiAccess>
    </>
  );
}
function EvaluationContent() {
  const c = useWarehouse(),
    auth = useAuth(),
    nav = useNavigate(),
    client = useQueryClient(),
    list = useListState(),
    { resultId } = useParams(),
    [suite, setSuite] = useState<
      | {
          suiteId: string;
          name: string;
          caseCount: number;
          engines: string[];
          origin?: string;
          description?: string;
        }
      | undefined
    >(),
    [mode, setMode] = useState<Mode>("AUTO");
  const runId = String(list.params.runId || "");
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => settingsApi.get(signal),
  });
  const selectedRun = useQuery({
    queryKey: ["evaluation-run", runId],
    queryFn: ({ signal }) => evaluationApi.get(runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (q) =>
      q.state.data && isActive(q.state.data.status) ? 2000 : false,
  });
  const rows = useQuery({
    queryKey: ["evaluation-results", list.params],
    queryFn: ({ signal }) => evaluationApi.results(list.params, signal),
    refetchInterval:
      selectedRun.data && isActive(selectedRun.data.status) ? 3000 : false,
  });
  const detail = useQuery({
    queryKey: ["evaluation-case", resultId],
    queryFn: ({ signal }) => evaluationApi.result(resultId!, signal),
    enabled: Boolean(resultId),
  });
  const run = useMutation({
    mutationFn: () => {
      if (!suite || !c.warehouse || !c.dataset)
        throw new Error("Chọn warehouse, dataset và bộ test trước khi chạy.");
      return evaluationApi.run({
        warehouseId: c.warehouseId,
        datasetId: c.datasetId,
        suiteId: suite.suiteId,
        mode,
      });
    },
    onSuccess: (r) => {
      client.setQueryData(["evaluation-run", r.runId], r);
      void client.invalidateQueries({ queryKey: ["evaluation-results"] });
      list.patch({ runId: r.runId });
    },
  });
  return (
    <>
      <Card>
        <div className="run-controls">
          <div>
            <small>Warehouse / Dataset</small>
            <strong>{c.warehouse?.name || "Chưa chọn warehouse"}</strong>
            <span>{c.dataset?.name || "Chưa chọn dataset"}</span>
          </div>
          <Field label="Chế độ xử lý">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              {(settings.data?.availableModes || ["AUTO"]).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <AsyncSelect
            label="Bộ test case"
            value={suite}
            onSelect={setSuite}
            cacheKey={`${c.warehouseId}/${c.datasetId}`}
            disabled={!c.datasetId}
            load={(params, signal) =>
              evaluationApi.suites(
                { ...params, datasetId: c.datasetId },
                signal,
              )
            }
            getId={(s) => s.suiteId}
            getLabel={(s) =>
              `${s.name} · ${s.caseCount} cases · ${s.origin === "CURRENT_SCHEMA" ? "Schema hiện tại" : "Bộ kiểm thử được đóng gói"}`
            }
          />
          <Button
            variant="primary"
            disabled={
              !auth.can("OPERATOR") ||
              !suite ||
              (suite.origin === "CURRENT_SCHEMA" && mode === "DETERMINISTIC") ||
              !c.warehouse ||
              !suite.engines.includes(c.warehouse.engine) ||
              c.dataset?.status !== "ACTIVE" ||
              c.warehouse.status !== "ACTIVE" ||
              run.isPending
            }
            onClick={() => run.mutate()}
          >
            <Play size={18} />
            {run.isPending ? "Đang gửi…" : "Chạy đánh giá mới"}
          </Button>
        </div>
        {suite && (
          <Notice>
            {suite.description ||
              "SQL mong đợi là oracle kiểm thử được khai báo, không phải câu trả lời AI vừa sinh."}{" "}
            Kết quả đánh giá chỉ áp dụng bộ test và dataset được chọn.
            {suite.origin === "CURRENT_SCHEMA" &&
              " Các câu đếm từ schema kiểm tra tích hợp cơ bản, không đại diện độ chính xác phân tích nghiệp vụ tổng quát."}
          </Notice>
        )}
        {selectedRun.data?.error && (
          <Notice tone="error">
            {selectedRun.data.error.message}
            <small>
              {selectedRun.data.error.code} ·{" "}
              {selectedRun.data.error.correlationId}
            </small>
          </Notice>
        )}
        {run.error && <ErrorState error={run.error} />}
        {settings.error && (
          <ErrorState
            error={settings.error}
            retry={() => void settings.refetch()}
          />
        )}
      </Card>
      <Card title="Lần đánh giá">
        <AsyncSelect
          cacheKey={`${c.warehouseId}/${c.datasetId}`}
          label="Chọn evaluation run"
          value={selectedRun.data}
          onSelect={(r) => list.patch({ runId: r.runId })}
          load={(p, s) =>
            evaluationApi.runs(
              {
                ...p,
                warehouseId: c.warehouseId || undefined,
                datasetId: c.datasetId || undefined,
              },
              s,
            )
          }
          getId={(r) => r.runId}
          getLabel={(r) =>
            `${r.runId} · ${engineLabel[r.engine]} · ${r.status}`
          }
        />
        {runId ? (
          <Resource resource={selectedRun}>
            {(r) => (
              <>
                <div className="inline-actions">
                  <Badge status={r.status} />
                  <small>
                    {r.model || "—"} · {formatDate(r.createdAt)}
                  </small>
                </div>
                <div className="stats-grid six">
                  <Stat
                    label="Tổng test case"
                    value={r.metrics.totalCases}
                    icon={<FileCheck2 />}
                  />
                  <Stat
                    label="Thực thi thành công"
                    value={formatRate(r.metrics.executionSuccessRate)}
                    icon={<ShieldCheck />}
                    tone="green"
                  />
                  <Stat
                    label="Tương đương kết quả"
                    value={formatRate(r.metrics.resultEquivalenceRate)}
                    icon={<Target />}
                    tone="purple"
                  />
                  <Stat
                    label="Đúng SQL dialect"
                    value={formatRate(r.metrics.dialectAccuracy)}
                    icon={<BarChart3 />}
                  />
                  <Stat
                    label="Từ chối SQL không hợp lệ"
                    value={formatRate(r.metrics.invalidSqlRejectionRate)}
                    icon={<ShieldCheck />}
                    tone="orange"
                  />
                  <Stat
                    label="Phản hồi trung bình"
                    value={formatDuration(r.metrics.avgLatencyMs)}
                    icon={<Clock3 />}
                  />
                </div>
                <details>
                  <summary>Mẫu số và thông tin đo lường</summary>
                  <DetailList
                    items={[
                      [
                        "Đã chạy",
                        `${r.metrics.completedCases}/${r.metrics.totalCases}`,
                      ],
                      ["P95", formatDuration(r.metrics.p95LatencyMs)],
                      ...Object.entries(r.metrics.denominators).map(
                        ([k, v]) => [k, v] as [string, number],
                      ),
                    ]}
                  />
                </details>
              </>
            )}
          </Resource>
        ) : (
          <p className="muted">
            Chọn một lần đánh giá để xem thống kê. Không có số liệu tổng hợp giả
            định.
          </p>
        )}
      </Card>
      <Filters
        key={JSON.stringify(list.params)}
        onApply={list.patch}
        onReset={list.reset}
      >
        <Field label="Tìm câu hỏi">
          <input
            name="search"
            defaultValue={String(list.params.search || "")}
            placeholder="Câu hỏi hoặc test case…"
          />
        </Field>
        <RegistryFilterFields params={list.params} />
        <Field label="Model">
          <input name="model" defaultValue={String(list.params.model || "")} />
        </Field>
        <Field label="Trạng thái">
          <select name="status" defaultValue={String(list.params.status || "")}>
            <option value="">Tất cả</option>
            {["PASSED", "FAILED", "REJECTED", "ERROR"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Độ khó">
          <select
            name="difficulty"
            defaultValue={String(list.params.difficulty || "")}
          >
            <option value="">Tất cả</option>
            {["EASY", "MEDIUM", "HARD"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </Filters>
      <Card
        title="Kết quả đánh giá"
        icon={<BarChart3 size={23} />}
        actions={
          <Button
            disabled={!rows.data?.items.length}
            onClick={() =>
              downloadText(
                `evaluation-${runId || "results"}-page-${list.page}.json`,
                JSON.stringify(rows.data, null, 2),
                "application/json;charset=utf-8",
              )
            }
          >
            <Download size={16} />
            Xuất trang hiện tại
          </Button>
        }
      >
        <Resource resource={rows}>
          {(data) => (
            <>
              <DataGrid
                rows={data.items}
                rowKey={(r) => r.resultId}
                selected={resultId}
                onSelect={(r) =>
                  nav(
                    `/evaluation/results/${encodeURIComponent(r.resultId)}?${new URLSearchParams(
                      Object.entries(list.params)
                        .filter(([, v]) => v != null)
                        .map(([k, v]) => [k, String(v)]),
                    ).toString()}`,
                  )
                }
                columns={[
                  { key: "caseId", label: "ID", render: (r) => r.caseId },
                  {
                    key: "question",
                    label: "Câu hỏi",
                    render: (r) => (
                      <span className="question-cell">{r.question}</span>
                    ),
                  },
                  {
                    key: "difficulty",
                    label: "Độ khó",
                    render: (r) => r.difficulty,
                  },
                  {
                    key: "sqlDialect",
                    label: "Dialect",
                    render: (r) => engineLabel[r.sqlDialect],
                  },
                  {
                    key: "status",
                    label: "Trạng thái",
                    render: (r) => <Badge status={r.status} />,
                  },
                  {
                    key: "equivalent",
                    label: "Tương đương",
                    render: (r) =>
                      r.resultEquivalent === null
                        ? "—"
                        : r.resultEquivalent
                          ? "Có"
                          : "Không",
                  },
                  {
                    key: "chart",
                    label: "Khớp biểu đồ",
                    render: (r) =>
                      r.chartMatch === null
                        ? "—"
                        : r.chartMatch
                          ? "Có"
                          : "Không",
                  },
                  {
                    key: "latency",
                    label: "Độ trễ",
                    render: (r) => formatDuration(r.latencyMs),
                  },
                ]}
              />
              <Pagination {...data} onChange={list.paginate} />
            </>
          )}
        </Resource>
      </Card>
      {resultId && (
        <Card
          title="Chi tiết test case"
          actions={
            <Button
              onClick={() =>
                nav(
                  `/evaluation?${new URLSearchParams(
                    Object.entries(list.params)
                      .filter(([, v]) => v != null)
                      .map(([k, v]) => [k, String(v)]),
                  ).toString()}`,
                )
              }
            >
              Đóng
            </Button>
          }
        >
          <Resource resource={detail}>
            {(d) => (
              <>
                <div className="inline-actions">
                  <h3>
                    {d.caseId} · {d.question}
                  </h3>
                  <Badge status={d.status} />
                </div>
                <div className="three-columns">
                  <DetailList
                    items={[
                      ["Dialect", engineLabel[d.sqlDialect]],
                      ["Độ khó", d.difficulty],
                      ["Validation", d.validationResult],
                      ["Thời gian", formatDuration(d.latencyMs)],
                      [
                        "Tương đương",
                        d.resultEquivalent === null
                          ? "—"
                          : String(d.resultEquivalent),
                      ],
                      [
                        "Khớp biểu đồ",
                        d.chartMatch === null ? "—" : String(d.chartMatch),
                      ],
                    ]}
                  />
                  <SqlBlock sql={d.expectedSql} label="Expected SQL" />
                  <SqlBlock sql={d.generatedSql} label="Generated SQL" />
                </div>
                {d.failureReason && (
                  <Notice tone="error">{d.failureReason}</Notice>
                )}
                {d.actualResult && (
                  <>
                    <h3>Kết quả thực tế (snapshot)</h3>
                    <ResultTable
                      key={d.resultId}
                      initial={d.actualResult}
                      readonly
                    />
                  </>
                )}
                {d.expectedResult && (
                  <>
                    <h3>Kết quả mong đợi</h3>
                    <ResultTable
                      key={`expected-${d.resultId}`}
                      initial={d.expectedResult}
                      readonly
                    />
                  </>
                )}
              </>
            )}
          </Resource>
        </Card>
      )}
    </>
  );
}

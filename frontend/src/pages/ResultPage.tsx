import { useState, type ComponentProps } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Braces,
  Clock3,
  Code2,
  Database,
  Download,
  HelpCircle,
  RefreshCw,
  Save,
  Table2,
} from "lucide-react";
import { executionLabel, providerSourceLabel } from "../lib/modelProvider";
import { queryApi } from "../api/queryApi";
import { datasetApi } from "../api/datasetApi";
import { warehouseApi } from "../api/warehouseApi";
import { useWarehouse } from "../app/providers";
import { useAuth } from "../app/auth";
import { formatDate, formatDuration, engineLabel } from "../lib/format";
import {
  Card,
  Button,
  Badge,
  CopyButton,
  DetailList,
  ErrorState,
  Field,
  Modal,
  Notice,
  Resource,
  Stat,
  Tabs,
  ApiAccess,
  Empty,
} from "../components/ui";
import { SqlBlock } from "../components/ui";
import { ResultTable } from "../components/ResultTable";
import { Visualization, scalarColumn } from "../components/Visualization";
import { loadChartSnapshot } from "../lib/chartSnapshot";
import { PageHeading } from "../components/Shell";
export function ResultPage({ history = false }: { history?: boolean }) {
  const { id = "", tab = "overview" } = useParams(),
    c = useWarehouse(),
    auth = useAuth(),
    navigate = useNavigate(),
    [saving, setSaving] = useState(false),
    [name, setName] = useState(""),
    [downloadError, setDownloadError] = useState<unknown>(null),
    [exporting, setExporting] = useState(false);
  const query = useQuery({
    queryKey: ["query", id],
    queryFn: ({ signal }) => queryApi.get(id, signal),
    enabled: c.enabled && Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 2000 : false),
  });
  const sourceWarehouse = useQuery({
    queryKey: ["query-source-warehouse", query.data?.warehouseId],
    queryFn: ({ signal }) => warehouseApi.get(query.data!.warehouseId, signal),
    enabled: c.enabled && Boolean(query.data?.warehouseId),
  });
  const sourceDataset = useQuery({
    queryKey: ["query-source-dataset", query.data?.datasetId],
    queryFn: ({ signal }) => datasetApi.get(query.data!.datasetId, signal),
    enabled: c.enabled && Boolean(query.data?.datasetId),
  });
  const save = useMutation({
    mutationFn: () => queryApi.save(id, name),
    onSuccess: () => setSaving(false),
  });
  const rerun = useMutation({
    mutationFn: () => {
      const q = query.data!;
      if (q.executionMode === "SEMANTIC") {
        throw new Error(
          "Mở Ngữ nghĩa nghiệp vụ để chọn lại chỉ số và bộ lọc theo định nghĩa hiện tại.",
        );
      }
      return queryApi.run({
        warehouseId: q.warehouseId,
        datasetId: q.datasetId,
        question: q.question,
        mode: q.executionMode,
        ...(q.executionMode === "API" && q.provider
          ? { providerId: q.provider.providerId }
          : {}),
      });
    },
    onSuccess: (q) =>
      navigate(`/query/${encodeURIComponent(q.queryId)}/overview`),
  });
  const tabs = [
    ["overview", "Tổng quan", BarChart3],
    ["data", "Dữ liệu", Table2],
    ["visualization", "Biểu đồ", BarChart3],
    ["sql", "SQL", Code2],
    ["explanation", "Giải thích", HelpCircle],
    ["technical", "Thông tin kỹ thuật", Braces],
  ] as const;
  const active = tabs.some((t) => t[0] === tab) ? tab : "overview";
  return (
    <ApiAccess>
      {!query.data && (
        <PageHeading
          title={query.error ? "Không tải được truy vấn" : "Kết quả truy vấn"}
          description="Dữ liệu và trạng thái được đọc từ truy vấn đã lưu."
        />
      )}
      <Resource resource={query}>
        {(q) => (
          <div className="result-page">
            <div className="result-topline">
              <Link className="text-link" to={history ? "/history" : "/query"}>
                <ArrowLeft size={17} />
                {history ? "Quay lại lịch sử truy vấn" : "Quay lại truy vấn"}
              </Link>
              <div className="inline-actions">
                <Button
                  disabled={
                    !auth.can("ANALYST") ||
                    rerun.isPending ||
                    q.status === "RUNNING"
                  }
                  onClick={() =>
                    q.executionMode === "SEMANTIC"
                      ? navigate("/semantic")
                      : rerun.mutate()
                  }
                >
                  <RefreshCw size={17} />
                  {q.executionMode === "SEMANTIC"
                    ? "Mở phân tích nghiệp vụ"
                    : "Chạy lại truy vấn"}
                </Button>
                <Button
                  disabled={!auth.can("ANALYST") || !q.result}
                  onClick={() => setSaving(true)}
                >
                  <Save size={17} />
                  Lưu kết quả
                </Button>
                <Button
                  variant="primary"
                  disabled={!q.result || exporting}
                  onClick={async () => {
                    setExporting(true);
                    setDownloadError(null);
                    try {
                      await queryApi.exportCsv(id);
                    } catch (e) {
                      setDownloadError(e);
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  <Download size={17} />
                  {exporting ? "Đang xuất…" : "Xuất CSV"}
                </Button>
              </div>
            </div>
            <div className="result-heading">
              <h1>{q.question}</h1>
              <Badge status={q.status} />
            </div>
            <div className="metadata-strip">
              <div
                className="query-source-metadata"
                aria-label="Nguồn truy vấn"
              >
                <span>Nguồn dữ liệu truy vấn</span>
                <strong>{sourceDataset.data?.name ?? q.datasetId}</strong>
                <small>
                  {sourceWarehouse.data?.name ?? q.warehouseId} ·{" "}
                  {engineLabel[q.sqlDialect]}
                </small>
              </div>
              <div>
                <span>Cơ chế xử lý / model</span>
                <strong>{executionLabel(q)}</strong>
              </div>
              <div>
                <span>Phiên bản ngữ nghĩa</span>
                <strong>{q.semanticVersion}</strong>
              </div>
              <div>
                <span>Phiên bản schema</span>
                <strong>{q.schemaVersion}</strong>
              </div>
              <div>
                <span>Thời gian xử lý</span>
                <strong>{formatDuration(q.latencyMs)}</strong>
              </div>
              <div>
                <span>Thời gian tạo</span>
                <strong>{formatDate(q.createdAt)}</strong>
              </div>
            </div>
            {q.error && (
              <ErrorState
                error={Object.assign(new Error(q.error.message), {
                  code: q.error.code,
                })}
              />
            )}
            {q.status === "RUNNING" && (
              <Notice>
                Truy vấn đang được xử lý. Trạng thái tự cập nhật; không cần gửi
                lại câu hỏi.
              </Notice>
            )}
            {rerun.error && <ErrorState error={rerun.error} />}
            {downloadError != null && <ErrorState error={downloadError} />}
            {save.isSuccess && (
              <Notice tone="success">Đã lưu kết quả: {save.data.name}</Notice>
            )}
            <Tabs
              items={tabs.map(([key, label, Icon]) => ({
                to: `${history ? "/history" : "/query"}/${encodeURIComponent(id)}/${key}`,
                label,
                icon: <Icon size={19} />,
                active: active === key,
              }))}
            />
            {active === "overview" && (
              <>
                {q.result ? (
                  <>
                    <div className="result-overview">
                      <Card
                        title="Trực quan hóa kết quả"
                        icon={<BarChart3 size={24} />}
                      >
                        <SnapshotVisualization
                          key={id}
                          spec={q.chart}
                          result={q.result}
                          queryId={id}
                          compact
                        />
                      </Card>
                      <Card
                        title="Tóm tắt kết quả"
                        icon={<Database size={23} />}
                      >
                        <div className="summary-cards">
                          <Stat
                            label="Số dòng snapshot"
                            value={q.result.returnedRowCount}
                            icon={<Table2 />}
                          />
                          <Stat
                            label="Số cột"
                            value={q.result.columns.length}
                            icon={<Database />}
                            tone="purple"
                          />
                          <Stat
                            label="Thời gian xử lý"
                            value={formatDuration(q.latencyMs)}
                            icon={<Clock3 />}
                            tone="green"
                          />
                          <Stat
                            label="SQL dialect"
                            value={engineLabel[q.sqlDialect]}
                            icon={<Code2 />}
                          />
                        </div>
                        <DetailList
                          items={[
                            [
                              "Bảng nguồn",
                              q.sourceTables
                                .map((table) => `${table.schema}.${table.name}`)
                                .join(", ") || "—",
                            ],
                            [
                              "Kết quả bị giới hạn",
                              q.result.truncated ? "Có" : "Không",
                            ],
                          ]}
                        />
                      </Card>
                    </div>
                    {!scalarColumn(q.result) && (
                      <Card
                        title="Xem trước dữ liệu kết quả"
                        icon={<Database size={21} />}
                        actions={
                          <Link
                            className="text-link"
                            to={`${history ? "/history" : "/query"}/${encodeURIComponent(id)}/data`}
                          >
                            Xem toàn bộ snapshot
                          </Link>
                        }
                      >
                        <ResultTable
                          key={id}
                          initial={{
                            ...q.result,
                            rows: q.result.rows.slice(0, 10),
                          }}
                          readonly
                        />
                      </Card>
                    )}
                    <Card title="Tóm tắt truy vấn">
                      <div className="three-columns">
                        <div>
                          <h3>Metrics</h3>
                          <div className="chips">
                            {q.selectedMetrics.map((s) => (
                              <span className="chip" key={s}>
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3>Dimensions</h3>
                          <div className="chips">
                            {q.selectedDimensions.map((s) => (
                              <span className="chip" key={s}>
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3>Bảng nguồn</h3>
                          {q.sourceTables.map((s) => (
                            <p key={`${s.schema}.${s.name}`}>
                              {s.schema}.{s.name}
                            </p>
                          ))}
                        </div>
                      </div>
                    </Card>
                  </>
                ) : (
                  <Card>
                    <Empty
                      title="Chưa có kết quả dữ liệu"
                      description={
                        q.error?.message ||
                        "Kết quả sẽ hiển thị khi truy vấn hoàn tất."
                      }
                    />
                  </Card>
                )}
              </>
            )}
            {active === "data" && (
              <Card
                title="Dữ liệu kết quả"
                icon={<Table2 size={23} />}
                className={
                  q.result && scalarColumn(q.result) ? "scalar-result-card" : ""
                }
              >
                {q.result ? (
                  <ResultTable key={id} queryId={id} initial={q.result} />
                ) : (
                  <Empty
                    title="Không có snapshot dữ liệu"
                    description="Kiểm tra trạng thái truy vấn hoặc thời hạn lưu kết quả."
                  />
                )}
              </Card>
            )}
            {active === "visualization" && (
              <Card
                className={
                  q.result && scalarColumn(q.result) ? "scalar-result-card" : ""
                }
              >
                {q.result ? (
                  <SnapshotVisualization
                    key={id}
                    spec={q.chart}
                    result={q.result}
                    queryId={id}
                  />
                ) : (
                  <Empty />
                )}
              </Card>
            )}
            {active === "sql" && (
              <div className="content-grid">
                <Card title="Truy vấn SQL" icon={<Code2 size={23} />}>
                  <p className="muted">
                    {q.status === "SUCCESS"
                      ? "Đây là SQL logic đã được Java chuẩn hóa, kiểm tra và chuyển tới bộ thực thi thành công. Sao chép giữ nguyên chuỗi này."
                      : "Lần truy vấn chưa thành công. SQL hiển thị có thể là kế hoạch trước khi kiểm tra đạt; không xác nhận statement đã thực thi thành công. Xem trạng thái và lỗi của truy vấn."}
                  </p>
                  <SqlBlock
                    sql={q.generatedSql}
                    label={
                      q.status === "SUCCESS"
                        ? "SQL đã thực thi"
                        : "SQL của lần truy vấn chưa thành công"
                    }
                  />
                  {q.candidateSql && q.candidateSql !== q.generatedSql && (
                    <details className="candidate-sql">
                      <summary>
                        SQL do model / compiler đề xuất trước khi lập kế hoạch
                      </summary>
                      <SqlBlock
                        sql={q.candidateSql}
                        label="SQL đề xuất (chưa phải câu lệnh thực thi)"
                      />
                    </details>
                  )}
                  <DetailList
                    items={[
                      ["SQL dialect", engineLabel[q.sqlDialect]],
                      ["Warehouse", q.warehouseId],
                      ["Dataset", q.datasetId],
                    ]}
                  />
                </Card>
                <div className="stack">
                  <Card title="Giải thích">
                    <p className="prose">
                      {q.explanation || "Không có giải thích từ dịch vụ."}
                    </p>
                  </Card>
                  <Card title="Bảng nguồn">
                    {q.sourceTables.map((t) => (
                      <div
                        className="source-table"
                        key={`${t.schema}.${t.name}`}
                      >
                        <Database size={22} />
                        <code>
                          {t.schema}.{t.name}
                        </code>
                      </div>
                    ))}
                  </Card>
                  <Card title="Metrics và Dimensions">
                    <h3>Metrics</h3>
                    <p>{q.selectedMetrics.join(", ") || "—"}</p>
                    <h3>Dimensions</h3>
                    <p>{q.selectedDimensions.join(", ") || "—"}</p>
                  </Card>
                </div>
              </div>
            )}
            {active === "explanation" && (
              <div className="content-grid">
                <Card title="Giải thích truy vấn">
                  <p className="prose">
                    {q.explanation || "Không có giải thích."}
                  </p>
                </Card>
                <Card title="Giả định">
                  {q.assumptions.length ? (
                    <ul className="assumptions">
                      {q.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Không có giả định được ghi nhận.</p>
                  )}
                </Card>
              </div>
            )}
            {active === "technical" && (
              <Card title="Thông tin kỹ thuật" icon={<Braces size={22} />}>
                <p className="muted">
                  SQL hiển thị là câu truy vấn logic đã kiểm tra. Adapter có thể
                  bọc SELECT / LIMIT cố định cho PostgreSQL, MySQL hoặc giới hạn
                  cursor cho SQL Server để đọc kết quả trong hạn mức.
                </p>
                <DetailList
                  items={[
                    [
                      "Query ID",
                      <CopyButton text={q.queryId} label={q.queryId} />,
                    ],
                    [
                      "Correlation ID",
                      <CopyButton
                        text={q.correlationId}
                        label={q.correlationId}
                      />,
                    ],
                    ["Warehouse ID", q.warehouseId],
                    ["Dataset ID", q.datasetId],
                    ["Engine", engineLabel[q.engine]],
                    [
                      "Model đã gọi",
                      q.executionMode === "API" ? q.model : "Không gọi AI",
                    ],
                    ["Cơ chế xử lý", executionLabel(q)],
                    [
                      "Provider snapshot",
                      q.provider?.name ||
                        "Snapshot không có thông tin provider",
                    ],
                    ["Loại provider", q.provider?.kind || "—"],
                    [
                      "Nguồn cấu hình",
                      q.provider ? providerSourceLabel(q.provider.source) : "—",
                    ],
                    ["Provider revision", q.provider?.revision || "—"],
                    ["Model cấu hình yêu cầu", q.provider?.model || "—"],
                    ["Semantic version", q.semanticVersion],
                    ["Schema version", q.schemaVersion],
                    ["Latency", formatDuration(q.latencyMs)],
                    ["Số dòng snapshot", q.result?.returnedRowCount],
                    ["Truncated", q.result ? String(q.result.truncated) : "—"],
                    ["Status", <Badge status={q.status} />],
                    ["Created at", q.createdAt],
                    ["Completed at", q.completedAt],
                    ["Error code", q.error?.code],
                  ]}
                />
              </Card>
            )}
            {saving && (
              <Modal
                title="Lưu kết quả truy vấn"
                onClose={() => setSaving(false)}
              >
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (name.trim()) save.mutate();
                  }}
                >
                  <Field label="Tên kết quả">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                      required
                    />
                  </Field>
                  <p className="muted">
                    Lưu bookmark và snapshot theo chính sách lưu trữ của Java
                    API.
                  </p>
                  {save.error && <ErrorState error={save.error} />}
                  <div className="inline-actions">
                    <Button onClick={() => setSaving(false)}>Hủy</Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={save.isPending || !name.trim()}
                    >
                      Lưu kết quả
                    </Button>
                  </div>
                </form>
              </Modal>
            )}
          </div>
        )}
      </Resource>
    </ApiAccess>
  );
}

function SnapshotVisualization({
  queryId,
  ...props
}: ComponentProps<typeof Visualization> & { queryId: string }) {
  const needsPages =
    props.result.rows.length < Math.min(props.result.returnedRowCount, 1000);
  const snapshot = useQuery({
    queryKey: ["chart-snapshot", queryId],
    queryFn: ({ signal }) => loadChartSnapshot(queryId, props.result, signal),
    enabled: needsPages,
    staleTime: Infinity,
    retry: false,
  });
  if (!needsPages) return <Visualization {...props} />;
  return (
    <>
      {props.result.returnedRowCount > 1000 && (
        <Notice tone="warning">
          Biểu đồ hiển thị tối đa 1.000 dòng snapshot. Xem bảng hoặc xuất CSV để
          đọc các dòng còn lại; không chạy lại model hoặc SQL khi đổi tab.
        </Notice>
      )}
      <Resource resource={snapshot}>
        {(complete) => <Visualization {...props} result={complete} />}
      </Resource>
    </>
  );
}

import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CloudUpload,
  Database,
  FileText,
  Play,
  Rows3,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useWarehouse } from "../app/providers";
import { useAuth } from "../app/auth";
import { ingestionApi } from "../api/ingestionApi";
import {
  formatDate,
  formatDuration,
  isActive,
  engineLabel,
  utcDateRange,
} from "../lib/format";
import { PageHeading } from "../components/Shell";
import { Artwork } from "../components/Artwork";
import { IngestionSourceRegistry } from "./IngestionSourceRegistry";
import {
  DateFilterFields,
  RegistryFilterFields,
} from "../components/FilterFields";
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
  Modal,
  Notice,
  Pagination,
  Resource,
  Stat,
  useListState,
} from "../components/ui";
export function IngestionPage() {
  const c = useWarehouse();
  return (
    <>
      <PageHeading
        title="Nạp dữ liệu vào Warehouse"
        description="Nạp dữ liệu từ những nguồn đã đăng ký thông qua pipeline có kiểm soát. Theo dõi từng bước xử lý, số dòng nạp và lịch sử thực thi."
        art={<Artwork kind="ingestion" />}
      />
      <ApiAccess>
        <IngestionContent key={`${c.warehouseId}/${c.datasetId}`} />
      </ApiAccess>
    </>
  );
}
function IngestionContent() {
  const c = useWarehouse(),
    auth = useAuth(),
    client = useQueryClient(),
    nav = useNavigate(),
    { runId } = useParams(),
    list = useListState(),
    [source, setSource] = useState<
      { sourceId: string; name: string; status: string } | undefined
    >();
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const rows = useQuery({
    queryKey: ["ingestion-runs", list.params],
    queryFn: ({ signal }) => ingestionApi.runs(list.params, signal),
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => isActive(r.status)) ? 5000 : false,
  });
  const selected = useQuery({
    queryKey: ["ingestion", runId],
    queryFn: ({ signal }) => ingestionApi.get(runId!, signal),
    enabled: Boolean(runId),
    refetchInterval: (q) =>
      q.state.data && isActive(q.state.data.status) ? 2000 : false,
  });
  const run = useMutation({
    mutationFn: () => {
      if (!source || !c.dataset || !c.warehouse)
        throw new Error("Chọn warehouse, dataset và nguồn dữ liệu.");
      const signature = `${c.warehouseId}/${c.datasetId}/${source.sourceId}`;
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      return ingestionApi.run({
        warehouseId: c.warehouseId,
        datasetId: c.datasetId,
        sourceId: source.sourceId,
        idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: (data) => {
      attempt.current = null;
      void client.invalidateQueries({ queryKey: ["ingestion-runs"] });
      nav(`/ingestion/${encodeURIComponent(data.runId)}`);
    },
  });
  return (
    <>
      <Card>
        <div className="run-controls">
          <div>
            <small>Warehouse</small>
            <strong>{c.warehouse?.name || "Chưa chọn warehouse"}</strong>
          </div>
          <div>
            <small>Dataset</small>
            <strong>{c.dataset?.name || "Chưa chọn dataset"}</strong>
          </div>
          <AsyncSelect
            cacheKey={`${c.warehouseId}/${c.datasetId}`}
            label="Nguồn dữ liệu"
            value={source}
            disabled={!c.datasetId || !c.warehouseId}
            onSelect={setSource}
            load={(p, s) =>
              ingestionApi.sources(
                { ...p, warehouseId: c.warehouseId, datasetId: c.datasetId },
                s,
              )
            }
            getId={(s) => s.sourceId}
            getLabel={(s) => `${s.name} · ${s.status}`}
          />
          <Button
            variant="primary"
            disabled={
              !auth.can("OPERATOR") ||
              !source ||
              source.status !== "ACTIVE" ||
              c.dataset?.status !== "ACTIVE" ||
              c.warehouse?.status !== "ACTIVE" ||
              run.isPending
            }
            onClick={() => run.mutate()}
          >
            <Play size={18} />
            {run.isPending ? "Đang gửi…" : "Chạy pipeline mới"}
          </Button>
        </div>
        {run.error && <ErrorState error={run.error} />}
      </Card>
      <IngestionSourceRegistry />
      <Filters
        key={JSON.stringify(list.params)}
        onApply={(v) => {
          const { fromDate, toDate, ...rest } = v;
          list.patch({ ...rest, ...utcDateRange(fromDate, toDate) });
        }}
        onReset={list.reset}
      >
        <RegistryFilterFields params={list.params} />
        <Field label="Trạng thái">
          <select name="status" defaultValue={String(list.params.status || "")}>
            <option value="">Tất cả</option>
            {["PENDING", "RUNNING", "SUCCESS", "PARTIAL", "FAILED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Tìm Run ID / Batch ID">
          <input
            name="search"
            defaultValue={String(list.params.search || "")}
          />
        </Field>
        <DateFilterFields params={list.params} />
      </Filters>
      <div className={runId ? "catalog-grid" : "catalog-single"}>
        <Card title="Lịch sử nạp dữ liệu" icon={<CloudUpload size={23} />}>
          <Resource resource={rows}>
            {(data) => (
              <>
                <DataGrid
                  rows={data.items}
                  rowKey={(r) => r.runId}
                  selected={runId}
                  onSelect={(r) =>
                    nav(`/ingestion/${encodeURIComponent(r.runId)}`)
                  }
                  onSort={list.sort}
                  sort={String(list.params.sort)}
                  direction={String(list.params.direction)}
                  columns={[
                    { key: "runId", label: "Run ID", render: (r) => r.runId },
                    {
                      key: "batchId",
                      label: "Batch ID",
                      render: (r) => r.batchId,
                    },
                    {
                      key: "dataset",
                      label: "Dataset / Warehouse",
                      render: (r) => (
                        <>
                          <span>{r.datasetId}</span>
                          <small>
                            {r.warehouseId} · {engineLabel[r.engine]}
                          </small>
                        </>
                      ),
                    },
                    {
                      key: "status",
                      label: "Trạng thái",
                      render: (r) => <Badge status={r.status} />,
                    },
                    {
                      key: "rowsWritten",
                      label: "Dòng đã nạp",
                      render: (r) => r.rowsWritten.toLocaleString("vi-VN"),
                    },
                    {
                      key: "rejectedCount",
                      label: "Bị từ chối",
                      render: (r) => r.rejectedCount.toLocaleString("vi-VN"),
                    },
                    {
                      key: "startedAt",
                      label: "Bắt đầu",
                      render: (r) => formatDate(r.startedAt),
                      sortable: true,
                    },
                    {
                      key: "completedAt",
                      label: "Hoàn tất",
                      render: (r) => formatDate(r.completedAt),
                    },
                    {
                      key: "durationMs",
                      label: "Thời gian",
                      render: (r) => formatDuration(r.durationMs),
                    },
                    {
                      key: "error",
                      label: "Lỗi",
                      render: (r) => r.error?.message || "—",
                    },
                  ]}
                />
                <Pagination {...data} onChange={list.paginate} />
              </>
            )}
          </Resource>
        </Card>
        {runId && (
          <aside>
            <Card
              title="Chi tiết lần nạp dữ liệu"
              actions={
                <Link to="/ingestion" className="text-link">
                  Đóng
                </Link>
              }
            >
              <Resource resource={selected}>
                {(r) => (
                  <>
                    <Badge status={r.status} />
                    <DetailList
                      items={[
                        ["Run ID", r.runId],
                        ["Batch ID", r.batchId],
                        ["Warehouse", r.warehouseId],
                        ["Dataset", r.datasetId],
                        ["Engine", engineLabel[r.engine]],
                        ["Nguồn dữ liệu", r.sourceId],
                        ["Dòng đã nạp", r.rowsWritten],
                        ["Bị từ chối", r.rejectedCount],
                        ["Idempotent", r.idempotent ? "Có" : "Không"],
                        ["Bắt đầu", formatDate(r.startedAt)],
                        ["Hoàn tất", formatDate(r.completedAt)],
                        ["Thời gian", formatDuration(r.durationMs)],
                      ]}
                    />
                    <h3>Các bước pipeline</h3>
                    <div className="pipeline-steps">
                      {r.steps.map((step, i) => (
                        <div key={step.stage}>
                          <span
                            className={`icon-tile ${i === 1 ? "purple" : i === 3 ? "pink" : "blue"}`}
                          >
                            <Database size={23} />
                          </span>
                          <div>
                            <strong>{step.stage}</strong>
                            <small>{formatDuration(step.durationMs)}</small>
                          </div>
                          <Badge status={step.status} />
                          {step.error && (
                            <Notice tone="error">{step.error.message}</Notice>
                          )}
                        </div>
                      ))}
                    </div>
                    {r.error && (
                      <Notice tone="error">
                        <strong>{r.error.code}</strong>
                        <p>{r.error.message}</p>
                        <small>{r.error.correlationId}</small>
                      </Notice>
                    )}
                  </>
                )}
              </Resource>
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}

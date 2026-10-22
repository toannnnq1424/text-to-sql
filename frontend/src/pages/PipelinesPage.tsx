import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  GitBranch,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { catalogApi } from "../api/catalogApi";
import { datasetApi } from "../api/datasetApi";
import { ingestionApi } from "../api/ingestionApi";
import { warehouseApi } from "../api/warehouseApi";
import { pipelineApi } from "../api/workbenchApi";
import {
  PipelineInputSchema,
  type Pipeline,
  type PipelineInput,
  type PipelinePreview,
  type PipelineRun,
  type Transform,
} from "../api/workbenchSchema";
import type { Dataset, Engine, TableMetadata, Warehouse } from "../api/schema";
import { passThroughTransform } from "../lib/pipelineDraft";
import { formatDate } from "../lib/format";
import { PageHeading } from "../components/Shell";
import {
  ApiAccess,
  AsyncSelect,
  Badge,
  Button,
  Card,
  DataGrid,
  Empty,
  ErrorState,
  Field,
  Notice,
  Pagination,
  Resource,
  SqlBlock,
  useListState,
} from "../components/ui";

const stageNames = ["staging", "warehouse", "mart"] as const;
const stageLabels = {
  staging: "Staging · Chuẩn hóa",
  warehouse: "Warehouse · Tích hợp",
  mart: "Mart · Phân tích",
};
const emptyTransform = (): Transform => ({
  columns: [],
  filter: "",
  groupBy: [],
});
const emptyStages = () => ({
  staging: emptyTransform(),
  warehouse: emptyTransform(),
  mart: emptyTransform(),
});

export function PipelinesPage() {
  const context = useWarehouse();
  const auth = useAuth();
  const client = useQueryClient();
  const list = useListState("name");
  const [editing, setEditing] = useState<Pipeline | "new">();
  const [runId, setRunId] = useState("");
  const [runPage, setRunPage] = useState(1);
  const [runPageSize, setRunPageSize] = useState(20);
  const keys = useRef(new Map<string, string>());
  const pipelines = useQuery({
    queryKey: ["pipelines", list.params],
    queryFn: ({ signal }) => pipelineApi.list(list.params, signal),
    enabled: context.enabled,
  });
  const runs = useQuery({
    queryKey: ["pipeline-runs", runPage, runPageSize],
    queryFn: ({ signal }) =>
      pipelineApi.runs(
        {
          page: runPage,
          pageSize: runPageSize,
          sort: "startedAt",
          direction: "DESC",
        },
        signal,
      ),
    enabled: context.enabled,
    refetchInterval: (q) =>
      q.state.data?.items.some((run) => run.status === "RUNNING")
        ? 2000
        : false,
  });
  const run = useMutation({
    mutationFn: (pipeline: Pipeline) => {
      let key = keys.current.get(pipeline.pipelineId);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(pipeline.pipelineId, key);
      }
      return pipelineApi.run(pipeline.pipelineId, key);
    },
    onSuccess: async (data) => {
      setRunId(data.runId);
      await client.invalidateQueries({ queryKey: ["pipeline-runs"] });
    },
  });
  const toggle = useMutation({
    mutationFn: (pipeline: Pipeline) =>
      pipelineApi.update(pipeline.pipelineId, {
        status: pipeline.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["pipelines"] }),
  });
  return (
    <ApiAccess>
      <PageHeading
        title="Pipelines dữ liệu"
        description="Đọc bảng từ nguồn đã đăng ký, chuyển đổi độc lập qua bốn lớp và tạo dataset phân tích. Xem trước cấu trúc, dữ liệu và các bảng đích trước khi nạp."
        actions={
          auth.can("ADMIN") ? (
            <Button
              variant="primary"
              disabled={
                Boolean(editing) ||
                context.warehouseLoading ||
                context.datasetLoading
              }
              onClick={() => setEditing("new")}
            >
              <Plus size={18} />
              Tạo pipeline
            </Button>
          ) : undefined
        }
      />
      <div className="workbench-stack">
        {editing && (
          <PipelineEditor
            key={typeof editing === "string" ? "new" : editing.pipelineId}
            initial={typeof editing === "string" ? undefined : editing}
            onClose={() => setEditing(undefined)}
            onSaved={async () => {
              setEditing(undefined);
              keys.current.clear();
              await client.invalidateQueries({ queryKey: ["pipelines"] });
            }}
          />
        )}
        {run.error && <ErrorState error={run.error} />}{" "}
        {toggle.error && <ErrorState error={toggle.error} />}
        <Card title="Pipelines đã lưu" icon={<GitBranch size={20} />}>
          <Field label="Tìm pipeline">
            <input
              type="search"
              value={String(list.params.search || "")}
              onChange={(event) => list.patch({ search: event.target.value })}
              placeholder="Tìm theo tên hoặc ID pipeline…"
            />
          </Field>
          <Resource resource={pipelines}>
            {(data) => (
              <>
                {data.items.length ? (
                  <DataGrid
                    rows={data.items}
                    rowKey={(pipeline) => pipeline.pipelineId}
                    columns={[
                      {
                        key: "name",
                        label: "Tên pipeline",
                        render: (pipeline) => <strong>{pipeline.name}</strong>,
                      },
                      {
                        key: "source",
                        label: "Bảng nguồn",
                        render: (pipeline) =>
                          `${pipeline.sourceTable.schema}.${pipeline.sourceTable.name}`,
                      },
                      {
                        key: "target",
                        label: "Tiền tố bảng đích",
                        render: (pipeline) =>
                          `${pipeline.targetSchema}.${pipeline.targetTable}`,
                      },
                      {
                        key: "status",
                        label: "Trạng thái",
                        render: (pipeline) => (
                          <Badge status={pipeline.status} />
                        ),
                      },
                      {
                        key: "actions",
                        label: "Thao tác",
                        render: (pipeline) => (
                          <div className="inline-actions">
                            {auth.can("ADMIN") && (
                              <>
                                <Button
                                  aria-label={`Sửa ${pipeline.name}`}
                                  disabled={
                                    Boolean(editing) ||
                                    run.isPending ||
                                    toggle.isPending
                                  }
                                  onClick={() => setEditing(pipeline)}
                                >
                                  <Pencil size={16} />
                                </Button>
                                <Button
                                  disabled={
                                    Boolean(editing) ||
                                    toggle.isPending ||
                                    run.isPending
                                  }
                                  onClick={() => toggle.mutate(pipeline)}
                                >
                                  {pipeline.status === "ACTIVE"
                                    ? "Vô hiệu hóa"
                                    : "Kích hoạt"}
                                </Button>
                              </>
                            )}
                            {auth.can("OPERATOR") && (
                              <Button
                                disabled={
                                  pipeline.status !== "ACTIVE" ||
                                  run.isPending ||
                                  toggle.isPending
                                }
                                onClick={() => run.mutate(pipeline)}
                              >
                                <Play size={16} />
                                Chạy
                              </Button>
                            )}
                          </div>
                        ),
                      },
                    ]}
                  />
                ) : (
                  <Empty
                    title="Chưa có pipeline"
                    description="ADMIN có thể tạo pipeline từ bảng trong dataset đã đăng ký. Mỗi lớp có mapping và phép chuyển đổi riêng."
                  />
                )}
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  totalItems={data.totalItems}
                  totalPages={data.totalPages}
                  onChange={list.paginate}
                />
              </>
            )}
          </Resource>
        </Card>
        {runId && (
          <PipelineRunDetail
            key={runId}
            id={runId}
            onClose={() => setRunId("")}
          />
        )}
        <Card title="Lịch sử chạy" icon={<Play size={20} />}>
          <Resource resource={runs}>
            {(data) =>
              data.items.length ? (
                <>
                  <DataGrid
                    rows={data.items}
                    rowKey={(item) => item.runId}
                    onSelect={(item) => setRunId(item.runId)}
                    selected={runId}
                    columns={[
                      {
                        key: "runId",
                        label: "Lần chạy",
                        render: (item) => item.runId,
                      },
                      {
                        key: "pipelineId",
                        label: "Pipeline",
                        render: (item) =>
                          pipelines.data?.items.find(
                            (pipeline) =>
                              pipeline.pipelineId === item.pipelineId,
                          )?.name || item.pipelineId,
                      },
                      {
                        key: "status",
                        label: "Trạng thái",
                        render: (item) => <Badge status={item.status} />,
                      },
                      {
                        key: "time",
                        label: "Bắt đầu",
                        render: (item) => formatDate(item.startedAt),
                      },
                      {
                        key: "rows",
                        label: "Dòng tại Mart",
                        render: (item) =>
                          item.stages
                            .find((stage) => stage.name === "MART")
                            ?.rowsWritten.toLocaleString("vi-VN") || "0",
                      },
                      {
                        key: "partial",
                        label: "Kết quả một phần",
                        render: (item) =>
                          item.partialFailure ? "Có — xem chi tiết" : "Không",
                      },
                    ]}
                  />
                  <Pagination
                    page={data.page}
                    pageSize={data.pageSize}
                    totalItems={data.totalItems}
                    totalPages={data.totalPages}
                    onChange={(page, size) => {
                      setRunPage(page);
                      setRunPageSize(size);
                    }}
                  />
                </>
              ) : (
                <Empty
                  title="Chưa có lần chạy"
                  description="Lần chạy và số dòng từng lớp được lưu lại khi thực thi pipeline."
                />
              )
            }
          </Resource>
        </Card>
      </div>
    </ApiAccess>
  );
}

function PipelineEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Pipeline;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const context = useWarehouse();
  const [name, setName] = useState(initial?.name || "");
  const [sourceWarehouse, setSourceWarehouse] = useState<Warehouse | undefined>(
    initial ? undefined : context.warehouse,
  );
  const [sourceDataset, setSourceDataset] = useState<Dataset | undefined>(
    initial ? undefined : context.dataset,
  );
  const [sourceTable, setSourceTable] = useState<TableMetadata>();
  const [datasetCleared, setDatasetCleared] = useState(false);
  const [tableCleared, setTableCleared] = useState(false);
  const [targetWarehouse, setTargetWarehouse] = useState<Warehouse | undefined>(
    initial ? undefined : context.warehouse,
  );
  const [targetSchema, setTargetSchema] = useState(initial?.targetSchema || "");
  const [targetTable, setTargetTable] = useState(initial?.targetTable || "");
  const [datasetName, setDatasetName] = useState(initial?.datasetName || "");
  const [stages, setStages] = useState(initial?.stages || emptyStages);
  const [limits, setLimits] = useState({
    maxRows: initial?.maxRows || 1000,
    maxBytes: initial?.maxBytes || 5242880,
    timeoutSeconds: initial?.timeoutSeconds || 30,
  });
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<PipelinePreview>();
  const [checked, setChecked] = useState("");
  const [validation, setValidation] = useState("");
  const revision = useRef(0);
  const editContext = useQuery({
    queryKey: ["pipeline-context", initial?.pipelineId],
    enabled: Boolean(initial),
    queryFn: async () => {
      const [sourceWarehouse, sourceDataset, targetWarehouse, tables] =
        await Promise.all([
          warehouseApi.get(initial!.sourceWarehouseId),
          datasetApi.get(initial!.sourceDatasetId),
          warehouseApi.get(initial!.targetWarehouseId),
          catalogApi.tables(initial!.sourceDatasetId, {
            search: initial!.sourceTable.name,
            page: 1,
            pageSize: 100,
          }),
        ]);
      const table = tables.items.find(
        (table) =>
          table.schema === initial!.sourceTable.schema &&
          table.name === initial!.sourceTable.name,
      );
      if (!table)
        throw new Error("Bảng nguồn đã thay đổi hoặc không còn trong dataset.");
      return { sourceWarehouse, sourceDataset, targetWarehouse, table };
    },
  });
  const currentSourceWarehouse =
    sourceWarehouse || editContext.data?.sourceWarehouse;
  const currentSourceDataset =
    sourceDataset ||
    (!datasetCleared ? editContext.data?.sourceDataset : undefined);
  const currentSourceTable =
    sourceTable || (!tableCleared ? editContext.data?.table : undefined);
  const currentTargetWarehouse =
    targetWarehouse || editContext.data?.targetWarehouse;
  const targets = useQuery({
    queryKey: ["pipeline-targets", currentTargetWarehouse?.warehouseId],
    queryFn: ({ signal }) =>
      ingestionApi.fileTargets(currentTargetWarehouse!.warehouseId, signal),
    enabled: Boolean(currentTargetWarehouse),
  });
  const invalidate = () => {
    revision.current += 1;
    setChecked("");
    setPreview(undefined);
    setValidation("");
  };
  const build = () =>
    PipelineInputSchema.parse({
      ...(initial ? { pipelineId: initial.pipelineId } : {}),
      name,
      sourceWarehouseId: currentSourceWarehouse?.warehouseId || "",
      sourceDatasetId: currentSourceDataset?.datasetId || "",
      sourceTable: currentSourceTable
        ? { schema: currentSourceTable.schema, name: currentSourceTable.name }
        : { schema: "", name: "" },
      targetWarehouseId: currentTargetWarehouse?.warehouseId || "",
      targetSchema,
      targetTable,
      datasetName,
      stages,
      ...limits,
      status: initial?.status || "ACTIVE",
    });
  const inspect = useMutation({
    mutationFn: async () => {
      setValidation("");
      let input: PipelineInput;
      try {
        input = build();
      } catch {
        throw new Error(
          "Điền tên, nguồn, đích và mapping của cả ba lớp. Tên bảng/cột cần là identifier hợp lệ, giới hạn chạy trong phạm vi cho phép.",
        );
      }
      const version = revision.current;
      return {
        data: await pipelineApi.preview(input),
        signature: JSON.stringify(input),
        version,
      };
    },
    onSuccess: ({ data, signature, version }) => {
      if (version !== revision.current) return;
      setPreview(data);
      setChecked(signature);
      setStep(2);
    },
  });
  const save = useMutation({
    mutationFn: () => {
      const input = build();
      if (JSON.stringify(input) !== checked)
        throw new Error("Cấu hình đã thay đổi. Kiểm tra lại trước khi lưu.");
      return initial
        ? pipelineApi.update(initial.pipelineId, input)
        : pipelineApi.create(input);
    },
    onSuccess: () => onSaved(),
  });
  const busy = inspect.isPending || save.isPending;
  const selectSourceTable = (table: TableMetadata) => {
    invalidate();
    setSourceTable(table);
    const engine = currentTargetWarehouse?.engine;
    if (!engine) {
      setStages(emptyStages());
      return;
    }
    const staging = passThroughTransform(
      table.columns.map((column) => column.name),
      engine,
    );
    const warehouse = passThroughTransform(
      staging.columns.map((column) => column.name),
      engine,
    );
    const mart = passThroughTransform(
      warehouse.columns.map((column) => column.name),
      engine,
    );
    setStages({
      staging,
      warehouse,
      mart,
    });
  };
  return (
    <Card
      title={
        initial ? `Chỉnh pipeline · ${initial.name}` : "Tạo pipeline chuyển đổi"
      }
      icon={<GitBranch size={20} />}
      actions={
        <Button
          aria-label="Đóng trình tạo pipeline"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      }
    >
      <div className="pipeline-wizard-steps">
        {[
          "1. Chọn nguồn và đích",
          "2. Chuyển đổi từng lớp",
          "3. Xem trước và lưu",
        ].map((label, index) => (
          <button
            key={label}
            type="button"
            className={step === index ? "active" : ""}
            disabled={busy}
            onClick={() => setStep(index)}
          >
            {label}
          </button>
        ))}
      </div>
      {editContext.error && <ErrorState error={editContext.error} />}
      <fieldset
        disabled={busy || editContext.isLoading}
        className="workbench-fieldset"
      >
        <div hidden={step !== 0} className="workbench-stack">
          <div className="workbench-fields">
            <Field label="Tên pipeline">
              <input
                value={name}
                maxLength={120}
                onChange={(e) => {
                  invalidate();
                  setName(e.target.value);
                }}
              />
            </Field>
            <Field label="Tên dataset kết quả">
              <input
                value={datasetName}
                maxLength={120}
                onChange={(e) => {
                  invalidate();
                  setDatasetName(e.target.value);
                }}
              />
            </Field>
          </div>
          <div className="pipeline-context-panels">
            <div className="definition-card">
              <h3>Nguồn dữ liệu</h3>
              <AsyncSelect
                label="Warehouse nguồn"
                value={currentSourceWarehouse}
                load={warehouseApi.list}
                getId={(item) => item.warehouseId}
                getLabel={(item) => `${item.name} · ${item.engine}`}
                onSelect={(item) => {
                  invalidate();
                  setSourceWarehouse(item);
                  setSourceDataset(undefined);
                  setSourceTable(undefined);
                  setDatasetCleared(true);
                  setTableCleared(true);
                  setStages(emptyStages());
                }}
              />
              <AsyncSelect
                label="Dataset nguồn"
                value={
                  currentSourceDataset?.warehouseId ===
                  currentSourceWarehouse?.warehouseId
                    ? currentSourceDataset
                    : undefined
                }
                disabled={!currentSourceWarehouse}
                cacheKey={currentSourceWarehouse?.warehouseId}
                load={(params, signal) =>
                  datasetApi.list(
                    {
                      ...params,
                      warehouseId: currentSourceWarehouse!.warehouseId,
                      status: "ACTIVE",
                    },
                    signal,
                  )
                }
                getId={(item) => item.datasetId}
                getLabel={(item) => item.name}
                onSelect={(item) => {
                  invalidate();
                  setSourceDataset(item);
                  setSourceTable(undefined);
                  setTableCleared(true);
                  setStages(emptyStages());
                }}
              />
              <AsyncSelect
                label="Bảng nguồn"
                value={currentSourceTable}
                disabled={
                  !currentSourceDataset ||
                  currentSourceDataset.warehouseId !==
                    currentSourceWarehouse?.warehouseId
                }
                cacheKey={currentSourceDataset?.datasetId}
                load={(params, signal) =>
                  catalogApi.tables(
                    currentSourceDataset!.datasetId,
                    { ...params, queryable: true },
                    signal,
                  )
                }
                getId={(item) => item.tableId}
                getLabel={(item) => `${item.schema}.${item.name}`}
                onSelect={selectSourceTable}
              />
            </div>
            <ArrowRight className="pipeline-direction" />
            <div className="definition-card">
              <h3>Đích dữ liệu</h3>
              <AsyncSelect
                label="Warehouse đích"
                value={currentTargetWarehouse}
                load={warehouseApi.list}
                getId={(item) => item.warehouseId}
                getLabel={(item) => `${item.name} · ${item.engine}`}
                onSelect={(item) => {
                  invalidate();
                  if (currentTargetWarehouse?.engine !== item.engine)
                    setStages(emptyStages());
                  setTargetWarehouse(item);
                  setTargetSchema("");
                }}
              />
              <Field label="Namespace có quyền tạo bảng">
                <select
                  value={targetSchema}
                  onChange={(e) => {
                    invalidate();
                    setTargetSchema(e.target.value);
                  }}
                >
                  <option value="">Chọn namespace đích</option>
                  {targets.data?.namespaces.map((namespace) => (
                    <option key={namespace}>{namespace}</option>
                  ))}
                </select>
              </Field>
              {targets.error && <ErrorState error={targets.error} />}{" "}
              {targets.data && !targets.data.namespaces.length && (
                <Notice tone="warning">
                  Warehouse chưa có namespace được cấp quyền CREATE cho tài
                  khoản import. Cấu hình writer trong Warehouses.
                </Notice>
              )}
              <Field
                label="Tiền tố tên bảng mới"
                hint="Tối đa 45 ký tự: chữ, số, dấu gạch dưới; bắt đầu bằng chữ hoặc gạch dưới."
              >
                <input
                  value={targetTable}
                  maxLength={45}
                  onChange={(e) => {
                    invalidate();
                    setTargetTable(e.target.value);
                  }}
                />
              </Field>
            </div>
          </div>
          <Notice>
            Pipeline tạo bốn bảng mới với hậu tố _raw, _staging, _warehouse,
            _mart. Bảng đã tồn tại sẽ bị từ chối để bảo vệ dữ liệu. Nguồn và
            đích có thể dùng engine khác nhau.
          </Notice>
          <div className="workbench-fields">
            <Field label="Số dòng tối đa (1–10.000)">
              <input
                type="number"
                min={1}
                max={10000}
                value={limits.maxRows}
                onChange={(e) => {
                  invalidate();
                  setLimits({ ...limits, maxRows: Number(e.target.value) });
                }}
              />
            </Field>
            <Field label="Giới hạn dữ liệu (byte)">
              <input
                type="number"
                min={1024}
                max={52428800}
                value={limits.maxBytes}
                onChange={(e) => {
                  invalidate();
                  setLimits({ ...limits, maxBytes: Number(e.target.value) });
                }}
              />
            </Field>
            <Field label="Thời gian mỗi bước (giây)">
              <input
                type="number"
                min={1}
                max={60}
                value={limits.timeoutSeconds}
                onChange={(e) => {
                  invalidate();
                  setLimits({
                    ...limits,
                    timeoutSeconds: Number(e.target.value),
                  });
                }}
              />
            </Field>
          </div>
          <div className="workbench-footer">
            <Button
              variant="primary"
              disabled={
                !currentSourceTable || !currentTargetWarehouse || !targetSchema
              }
              onClick={() => setStep(1)}
            >
              Thiết lập chuyển đổi
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
        <div hidden={step !== 1} className="workbench-stack">
          <Notice>
            Raw giữ dữ liệu nguồn. Mỗi lớp sau đọc cột của lớp trước; chọn, đổi
            tên, chuyển kiểu, lọc hoặc tổng hợp bằng biểu thức. Chỉ SELECT được
            compiler cho phép, không dùng câu lệnh ghi trong mapping.
          </Notice>
          {stageNames.map((stage, index) => (
            <TransformEditor
              key={stage}
              label={stageLabels[stage]}
              engine={currentTargetWarehouse?.engine}
              transform={stages[stage]}
              inputNames={
                index === 0
                  ? currentSourceTable?.columns.map((column) => column.name) ||
                    []
                  : stages[stageNames[index - 1]].columns.map(
                      (column) => column.name,
                    )
              }
              onChange={(transform) => {
                invalidate();
                setStages({ ...stages, [stage]: transform });
              }}
            />
          ))}
          <div className="workbench-footer">
            <Button onClick={() => setStep(0)}>Quay lại nguồn/đích</Button>
            <Button variant="primary" onClick={() => inspect.mutate()}>
              <Eye size={17} />
              {inspect.isPending ? "Đang xem trước…" : "Kiểm tra và xem trước"}
            </Button>
          </div>
        </div>
        <div hidden={step !== 2} className="workbench-stack">
          {preview ? (
            <>
              <Notice tone="success">
                Kế hoạch hợp lệ. Kiểm tra từng lớp và các bảng sẽ tạo trước khi
                lưu.
              </Notice>
              {preview.warnings.map((warning, index) => (
                <Notice tone="warning" key={index}>
                  {warning}
                </Notice>
              ))}
              <div className="pipeline-stages">
                {preview.targetTables.map((table) => (
                  <div className="definition-card" key={table.stage}>
                    <strong>{table.stage}</strong>
                    <code>
                      {table.schema}.{table.name}
                    </code>
                  </div>
                ))}
              </div>
              {preview.stages.map((stage) => (
                <details className="definition-card" key={stage.name} open>
                  <summary>
                    {stage.name} · {stage.columns.length} cột · {stage.rowCount}{" "}
                    dòng trong bản xem trước
                  </summary>
                  <div
                    className="table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label={`Dữ liệu xem trước lớp ${stage.name}`}
                  >
                    <table>
                      <thead>
                        <tr>
                          {stage.columns.map((column) => (
                            <th key={column.name}>
                              {column.name}
                              <small>{column.dataType}</small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stage.rows.map((row, index) => (
                          <tr key={index}>
                            {stage.columns.map((column) => (
                              <td key={column.name}>
                                {row[column.name] === null ? (
                                  <span className="muted">NULL</span>
                                ) : (
                                  String(row[column.name] ?? "")
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!stage.rows.length && (
                    <p className="muted">
                      Lớp này không có dòng phù hợp bộ lọc.
                    </p>
                  )}
                  <SqlBlock sql={stage.sql} label={`SQL ${stage.name}`} />
                </details>
              ))}
            </>
          ) : (
            <Empty
              title="Chưa có bản xem trước hợp lệ"
              description="Chọn nguồn, đích và mapping, sau đó kiểm tra cấu hình để xem dữ liệu thực của từng lớp."
            />
          )}
          <div className="workbench-footer">
            <Button onClick={() => setStep(1)}>Chỉnh chuyển đổi</Button>
            <Button
              disabled={!currentSourceTable}
              onClick={() => inspect.mutate()}
            >
              <Eye size={17} />
              Kiểm tra lại
            </Button>
            <Button
              variant="primary"
              disabled={!preview || !checked}
              onClick={() => save.mutate()}
            >
              <Save size={17} />
              {save.isPending ? "Đang lưu…" : "Lưu pipeline"}
            </Button>
          </div>
        </div>
      </fieldset>
      {validation && <Notice tone="error">{validation}</Notice>}
      {inspect.error && <ErrorState error={inspect.error} />}{" "}
      {save.error && <ErrorState error={save.error} />}
    </Card>
  );
}

function TransformEditor({
  engine,
  label,
  transform,
  inputNames,
  onChange,
}: {
  engine?: Engine;
  label: string;
  transform: Transform;
  inputNames: string[];
  onChange: (transform: Transform) => void;
}) {
  return (
    <section className="definition-card">
      <div className="definition-header">
        <h3>{label}</h3>
        <Button
          disabled={!inputNames.length || !engine}
          onClick={() =>
            engine && onChange(passThroughTransform(inputNames, engine))
          }
        >
          Dùng cột lớp trước
        </Button>
      </div>
      <p className="muted">
        Cột đầu vào:{" "}
        {inputNames.length
          ? inputNames.join(", ")
          : "Chọn bảng nguồn hoặc định nghĩa lớp trước."}
      </p>
      <div className="transform-columns">
        {transform.columns.map((column, index) => (
          <div className="transform-column" key={index}>
            <Field label={`Tên cột ${index + 1}`}>
              <input
                value={column.name}
                maxLength={63}
                onChange={(e) =>
                  onChange({
                    ...transform,
                    columns: transform.columns.map((item, i) =>
                      i === index ? { ...item, name: e.target.value } : item,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Biểu thức cột ${index + 1}`}>
              <input
                className="code-input"
                value={column.expression}
                onChange={(e) =>
                  onChange({
                    ...transform,
                    columns: transform.columns.map((item, i) =>
                      i === index
                        ? { ...item, expression: e.target.value }
                        : item,
                    ),
                  })
                }
              />
            </Field>
            <Button
              aria-label={`Xóa cột ${index + 1} của ${label}`}
              onClick={() =>
                onChange({
                  ...transform,
                  columns: transform.columns.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </div>
      <Button
        disabled={transform.columns.length >= 200}
        onClick={() =>
          onChange({
            ...transform,
            columns: [...transform.columns, { name: "", expression: "" }],
          })
        }
      >
        <Plus size={16} />
        Thêm cột
      </Button>
      <div className="workbench-fields">
        <Field label="Điều kiện lọc (WHERE)" hint="Để trống nếu giữ mọi dòng.">
          <textarea
            rows={2}
            className="code-input"
            value={transform.filter}
            onChange={(e) => onChange({ ...transform, filter: e.target.value })}
          />
        </Field>
        <Field
          label="Nhóm theo biểu thức (GROUP BY)"
          hint="Mỗi dòng một biểu thức; cần thiết khi trộn phép tổng hợp với cột chiều."
        >
          <textarea
            rows={2}
            className="code-input"
            value={transform.groupBy.join("\n")}
            onChange={(e) =>
              onChange({
                ...transform,
                groupBy: e.target.value
                  .split("\n")
                  .filter((line) => line.trim()),
              })
            }
          />
        </Field>
      </div>
    </section>
  );
}

function PipelineRunDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const run = useQuery({
    queryKey: ["pipeline-run", id],
    queryFn: ({ signal }) => pipelineApi.runStatus(id, signal),
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 1500 : false),
  });
  return (
    <Card
      title="Chi tiết lần chạy"
      icon={<GitBranch size={20} />}
      actions={
        <Button
          onClick={() => {
            void client.invalidateQueries({ queryKey: ["pipeline-runs"] });
            onClose();
          }}
        >
          Đóng
        </Button>
      }
    >
      <Resource resource={run}>{(data) => <RunContent run={data} />}</Resource>
    </Card>
  );
}
function RunContent({ run }: { run: PipelineRun }) {
  const context = useWarehouse();
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const dataset = useQuery({
    queryKey: ["pipeline-dataset", run.datasetId],
    queryFn: ({ signal }) => datasetApi.get(run.datasetId!, signal),
    enabled: run.status === "SUCCESS" && Boolean(run.datasetId),
  });
  const warehouse = useQuery({
    queryKey: ["pipeline-warehouse", dataset.data?.warehouseId],
    queryFn: ({ signal }) =>
      warehouseApi.get(dataset.data!.warehouseId, signal),
    enabled: Boolean(dataset.data),
  });
  useEffect(() => {
    if (
      !opening ||
      !dataset.data ||
      !warehouse.data ||
      context.warehouseId !== warehouse.data.warehouseId
    )
      return;
    context.selectDataset(dataset.data);
    navigate("/catalog/overview");
  }, [
    opening,
    dataset.data,
    warehouse.data,
    context.warehouseId,
    context.selectDataset,
    navigate,
  ]);
  return (
    <div className="workbench-stack">
      <div className="definition-header">
        <strong>{run.runId}</strong>
        <Badge status={run.status} />
      </div>
      <p className="muted">
        Bắt đầu: {formatDate(run.startedAt)}
        {run.completedAt && ` · Kết thúc: ${formatDate(run.completedAt)}`}
      </p>
      <div className="pipeline-stages">
        {run.stages.map((stage) => (
          <article className="definition-card" key={stage.name}>
            <h3>{stage.name}</h3>
            <Badge status={stage.status} />
            <strong>{stage.rowsWritten.toLocaleString("vi-VN")} dòng</strong>
          </article>
        ))}
      </div>
      {run.partialFailure && (
        <Notice tone="warning">
          Lần chạy còn các bảng đã được tạo hoặc dữ liệu đã ghi một phần. Kiểm
          tra danh sách dưới đây trước khi chạy kế hoạch mới; ứng dụng không tự
          xóa các bảng này.
        </Notice>
      )}
      {run.error?.details.outcomeUnknown === true && (
        <Notice tone="warning">
          Chưa xác định được kết quả commit do mất kết nối. Kiểm tra các bảng
          đích trước khi quyết định chạy lại; không coi lần chạy này đã
          rollback.
        </Notice>
      )}
      {run.error && (
        <Notice tone="error">
          <strong>{run.error.message}</strong>
          <small>
            {run.error.code} · {run.error.correlationId}
          </small>
        </Notice>
      )}
      {run.createdTables.length > 0 && (
        <div>
          <h3>Bảng đã tạo</h3>
          <div className="pill-list">
            {run.createdTables.map((table) => (
              <code key={`${table.schema}.${table.name}`}>
                {table.schema}.{table.name}
              </code>
            ))}
          </div>
        </div>
      )}
      {run.status === "SUCCESS" && run.datasetId && (
        <Notice tone="success">
          Mart đã được đăng ký thành dataset.{" "}
          {dataset.data && warehouse.data ? (
            <Button
              onClick={() => {
                context.selectWarehouse(warehouse.data!);
                setOpening(true);
              }}
            >
              Mở {dataset.data.name} trong Catalog
              <ArrowRight size={16} />
            </Button>
          ) : dataset.isError ? (
            <span>
              Dataset đã tạo nhưng chưa tải được thông tin. Chọn lại từ bộ chọn
              dataset phía trên.
            </span>
          ) : (
            <span>Đang tải dataset…</span>
          )}
        </Notice>
      )}
    </div>
  );
}

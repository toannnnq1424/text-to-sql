import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Pencil, Plus, Power, RefreshCw } from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { datasetApi } from "../api/datasetApi";
import { ingestionApi } from "../api/ingestionApi";
import { warehouseApi } from "../api/warehouseApi";
import type {
  Dataset,
  IngestionSource,
  IngestionSourceInput,
  Source,
  SourceTest,
  Warehouse,
} from "../api/schema";
import {
  AsyncSelect,
  Badge,
  Button,
  Card,
  DataGrid,
  Empty,
  ErrorState,
  Field,
  Modal,
  Notice,
  Pagination,
  Resource,
  useListState,
} from "../components/ui";

type ColumnDraft = {
  name: string;
  type: IngestionSourceInput["columnTypes"][string];
  required: boolean;
  maxLength: string;
};

type SourceDraft = {
  name: string;
  targetWarehouse?: Warehouse;
  targetDataset?: Dataset;
  sourceWarehouse?: Warehouse;
  sourceDataset?: Dataset;
  readSql: string;
  rawSchema: string;
  rawName: string;
  stageSchema: string;
  stageName: string;
  warehouseSchema: string;
  warehouseName: string;
  martSchema: string;
  martName: string;
  columns: ColumnDraft[];
  maxRows: string;
  maxBytes: string;
  timeoutSeconds: string;
};

const canonicalTypes: ColumnDraft["type"][] = [
  "STRING",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
];

const emptyDraft = (): SourceDraft => ({
  name: "",
  readSql: "",
  rawSchema: "",
  rawName: "",
  stageSchema: "",
  stageName: "",
  warehouseSchema: "",
  warehouseName: "",
  martSchema: "",
  martName: "",
  columns: [{ name: "", type: "STRING", required: false, maxLength: "" }],
  maxRows: "10000",
  maxBytes: "52428800",
  timeoutSeconds: "60",
});

export function IngestionSourceRegistry() {
  const context = useWarehouse();
  const auth = useAuth();
  const client = useQueryClient();
  const [editingId, setEditingId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [testResult, setTestResult] = useState<SourceTest>();
  const sourceList = useListState("name");
  const query = useQuery({
    queryKey: [
      "ingestion-sources",
      context.warehouseId,
      context.datasetId,
      sourceList.params,
    ],
    queryFn: ({ signal }) =>
      ingestionApi.sources(
        {
          warehouseId: context.warehouseId,
          datasetId: context.datasetId,
          ...sourceList.params,
        },
        signal,
      ),
    enabled: Boolean(context.warehouseId && context.datasetId),
  });
  const detail = useQuery({
    queryKey: ["ingestion-source", editingId],
    queryFn: ({ signal }) => ingestionApi.source(editingId!, signal),
    enabled: Boolean(editingId),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["ingestion-sources"] });
    void client.invalidateQueries({ queryKey: ["ingestion-source"] });
    void client.invalidateQueries({ queryKey: ["selector"] });
  };
  const save = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: IngestionSourceInput;
    }) => {
      if (!id) return ingestionApi.createSource(input);
      const original = detail.data;
      if (!original) throw new Error("Cấu hình nguồn chưa tải xong.");
      const patch = Object.fromEntries(
        Object.entries(input).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(original[key as keyof IngestionSource]),
        ),
      ) as Partial<IngestionSourceInput>;
      return Object.keys(patch).length
        ? ingestionApi.updateSource(id, patch)
        : Promise.resolve(original);
    },
    onSuccess: (saved) => {
      setCreating(false);
      setEditingId(undefined);
      setTestResult(undefined);
      refresh();
      if (saved.sourceId)
        void client.invalidateQueries({ queryKey: ["ingestion"] });
    },
  });
  const toggle = useMutation({
    mutationFn: (source: Source) =>
      ingestionApi.updateSource(source.sourceId, {
        status: source.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
      }),
    onSuccess: refresh,
  });
  const test = useMutation({
    mutationFn: (id: string) => ingestionApi.testSource(id),
    onSuccess: (result) => setTestResult(result),
  });
  const canManage = auth.can("ADMIN");
  const sourcePage = query.data;

  return (
    <>
      <Card
        title="Nguồn pipeline đã đăng ký"
        icon={<RefreshCw size={21} />}
        actions={
          canManage && (
            <Button
              variant="primary"
              onClick={() => {
                setTestResult(undefined);
                setCreating(true);
              }}
            >
              <Plus size={17} /> Đăng ký nguồn
            </Button>
          )
        }
      >
        {!canManage && (
          <Notice>
            Chỉ quản trị viên mới được đăng ký, sửa hoặc kiểm tra nguồn.
          </Notice>
        )}
        {query.error && (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        )}
        {query.isPending && <p role="status">Đang tải nguồn đã đăng ký…</p>}
        {sourcePage && sourcePage.items.length === 0 && (
          <Empty
            title="Chưa có nguồn pipeline"
            description="Đăng ký truy vấn đọc từ warehouse nguồn và cấu hình đích raw, staging, warehouse, mart."
            action={
              canManage ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} /> Đăng ký nguồn
                </Button>
              ) : undefined
            }
          />
        )}
        {sourcePage && sourcePage.items.length > 0 && (
          <>
            <DataGrid
              rows={sourcePage.items}
              rowKey={(source) => source.sourceId}
              columns={[
                {
                  key: "name",
                  label: "Nguồn",
                  render: (source) => (
                    <>
                      <strong>{source.name}</strong>
                      <small>{source.sourceId}</small>
                    </>
                  ),
                },
                {
                  key: "origin",
                  label: "Warehouse nguồn",
                  render: (source) => (
                    <>
                      {source.sourceWarehouseId}
                      <small>{source.sourceDatasetId}</small>
                    </>
                  ),
                },
                {
                  key: "status",
                  label: "Trạng thái",
                  render: (source) => <Badge status={source.status} />,
                },
                {
                  key: "actions",
                  label: "Thao tác",
                  render: (source) => (
                    <div className="inline-actions">
                      {canManage && (
                        <>
                          <Button
                            aria-label={`Kiểm tra ${source.name}`}
                            disabled={test.isPending}
                            onClick={() => {
                              setTestResult(undefined);
                              test.mutate(source.sourceId);
                            }}
                          >
                            <FlaskConical size={16} /> Kiểm tra
                          </Button>
                          <Button
                            aria-label={`Sửa ${source.name}`}
                            onClick={() => {
                              setTestResult(undefined);
                              setEditingId(source.sourceId);
                            }}
                          >
                            <Pencil size={16} /> Sửa
                          </Button>
                          <Button
                            aria-label={`${source.status === "ACTIVE" ? "Tắt" : "Bật"} ${source.name}`}
                            disabled={toggle.isPending}
                            onClick={() => toggle.mutate(source)}
                          >
                            <Power size={16} />{" "}
                            {source.status === "ACTIVE" ? "Tắt" : "Bật"}
                          </Button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination {...sourcePage} onChange={sourceList.paginate} />
          </>
        )}
        {toggle.error && <ErrorState error={toggle.error} />}
        {test.error && !creating && !editingId && (
          <ErrorState
            error={test.error}
            retry={() => test.mutate(test.variables!)}
          />
        )}
        {testResult && !creating && !editingId && (
          <SourceTestResult result={testResult} />
        )}
        {(creating || editingId) && (
          <Modal
            title={creating ? "Đăng ký nguồn pipeline" : "Sửa nguồn pipeline"}
            onClose={() => {
              setCreating(false);
              setEditingId(undefined);
              setTestResult(undefined);
              save.reset();
            }}
          >
            {editingId && detail.isPending && (
              <p role="status">Đang tải cấu hình nguồn…</p>
            )}
            {editingId && detail.error && (
              <ErrorState
                error={detail.error}
                retry={() => void detail.refetch()}
              />
            )}
            {(!editingId || detail.data) && (
              <SourceForm
                key={detail.data?.sourceId || "new-source"}
                initial={detail.data}
                currentWarehouse={context.warehouse}
                currentDataset={context.dataset}
                busy={save.isPending}
                error={save.error}
                onSubmit={(input) => save.mutate({ id: editingId, input })}
                onTest={(id) => test.mutate(id)}
                testPending={test.isPending}
                testError={test.error}
                testResult={testResult}
              />
            )}
          </Modal>
        )}
      </Card>
    </>
  );
}

function SourceForm({
  initial,
  currentWarehouse,
  currentDataset,
  busy,
  error,
  onSubmit,
  onTest,
  testPending,
  testError,
  testResult,
}: {
  initial?: IngestionSource;
  currentWarehouse?: Warehouse;
  currentDataset?: Dataset;
  busy: boolean;
  error: unknown;
  onSubmit: (input: IngestionSourceInput) => void;
  onTest: (id: string) => void;
  testPending: boolean;
  testError: unknown;
  testResult?: SourceTest;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<SourceDraft>(() =>
    initial
      ? {
          name: initial.name,
          targetWarehouse: undefined,
          targetDataset: undefined,
          sourceWarehouse: undefined,
          sourceDataset: undefined,
          readSql: initial.readSql,
          rawSchema: initial.raw.schema,
          rawName: initial.raw.name,
          stageSchema: initial.stage.schema,
          stageName: initial.stage.name,
          warehouseSchema: initial.warehouse.schema,
          warehouseName: initial.warehouse.name,
          martSchema: initial.mart.schema,
          martName: initial.mart.name,
          columns: initial.columns.map((name) => ({
            name,
            type: initial.columnTypes[name],
            required: initial.requiredColumns.includes(name),
            maxLength: initial.maxStringLengths[name]?.toString() || "",
          })),
          maxRows: initial.maxRows.toString(),
          maxBytes: initial.maxBytes.toString(),
          timeoutSeconds: initial.timeoutSeconds.toString(),
        }
      : {
          ...emptyDraft(),
          targetWarehouse: currentWarehouse,
          targetDataset: currentDataset,
        },
  );
  const [validation, setValidation] = useState("");
  const targetWarehouseQuery = useQuery({
    queryKey: ["ingestion-form-warehouse", initial?.warehouseId],
    queryFn: () => warehouseApi.get(initial!.warehouseId),
    enabled: Boolean(initial),
  });
  const targetDatasetQuery = useQuery({
    queryKey: ["ingestion-form-dataset", initial?.datasetId],
    queryFn: () => datasetApi.get(initial!.datasetId),
    enabled: Boolean(initial),
  });
  const sourceWarehouseQuery = useQuery({
    queryKey: ["ingestion-form-source-warehouse", initial?.sourceWarehouseId],
    queryFn: () => warehouseApi.get(initial!.sourceWarehouseId),
    enabled: Boolean(initial),
  });
  const sourceDatasetQuery = useQuery({
    queryKey: ["ingestion-form-source-dataset", initial?.sourceDatasetId],
    queryFn: () => datasetApi.get(initial!.sourceDatasetId),
    enabled: Boolean(initial),
  });
  useEffect(() => {
    setDraft((current) => ({
      ...current,
      targetWarehouse: targetWarehouseQuery.data || current.targetWarehouse,
      targetDataset: targetDatasetQuery.data || current.targetDataset,
      sourceWarehouse: sourceWarehouseQuery.data || current.sourceWarehouse,
      sourceDataset: sourceDatasetQuery.data || current.sourceDataset,
    }));
  }, [
    targetWarehouseQuery.data,
    targetDatasetQuery.data,
    sourceWarehouseQuery.data,
    sourceDatasetQuery.data,
  ]);
  const allowedTargetSchemas =
    (draft.targetDataset || targetDatasetQuery.data || currentDataset)
      ?.allowedSchemas || [];
  const allowedSourceSchemas =
    (draft.sourceDataset || sourceDatasetQuery.data || currentDataset)
      ?.allowedSchemas || [];
  const sourceIdReady = Boolean(initial?.sourceId);
  const set = <K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateColumn = (index: number, patch: Partial<ColumnDraft>) =>
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column, i) =>
        i === index ? { ...column, ...patch } : column,
      ),
    }));
  const loadWarehouses = (
    params: Record<string, string | number | boolean | null | undefined>,
    signal: AbortSignal,
  ) => warehouseApi.list(params, signal);
  const loadDatasets =
    (warehouse?: Warehouse) =>
    (
      params: Record<string, string | number | boolean | null | undefined>,
      signal: AbortSignal,
    ) =>
      warehouse
        ? datasetApi.list(
            { ...params, warehouseId: warehouse.warehouseId },
            signal,
          )
        : Promise.resolve({ items: [], page: 1, totalPages: 0 });
  const stageSchemas = allowedTargetSchemas;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidation("");
    const sourceWarehouse =
      draft.sourceWarehouse || (initial ? undefined : draft.targetWarehouse);
    const sourceDataset =
      draft.sourceDataset || (initial ? undefined : draft.targetDataset);
    const targetWarehouse = draft.targetWarehouse || currentWarehouse;
    const targetDataset = draft.targetDataset || currentDataset;
    if (
      !targetWarehouse ||
      !targetDataset ||
      !sourceWarehouse ||
      !sourceDataset
    ) {
      setValidation(
        "Chọn warehouse và dataset nguồn lẫn đích từ danh sách đã đăng ký.",
      );
      return;
    }
    const payload: IngestionSourceInput = {
      name: draft.name.trim(),
      warehouseId: targetWarehouse.warehouseId,
      datasetId: targetDataset.datasetId,
      sourceWarehouseId: sourceWarehouse.warehouseId,
      sourceDatasetId: sourceDataset.datasetId,
      readSql: draft.readSql.trim(),
      raw: { schema: draft.rawSchema, name: draft.rawName.trim() },
      stage: { schema: draft.stageSchema, name: draft.stageName.trim() },
      warehouse: {
        schema: draft.warehouseSchema,
        name: draft.warehouseName.trim(),
      },
      mart: { schema: draft.martSchema, name: draft.martName.trim() },
      columns: draft.columns.map((column) => column.name.trim()),
      requiredColumns: draft.columns
        .filter((column) => column.required)
        .map((column) => column.name.trim()),
      columnTypes: Object.fromEntries(
        draft.columns.map((column) => [column.name.trim(), column.type]),
      ),
      maxStringLengths: Object.fromEntries(
        draft.columns
          .filter((column) => column.type === "STRING" && column.maxLength)
          .map((column) => [column.name.trim(), Number(column.maxLength)]),
      ),
      maxRows: Number(draft.maxRows),
      maxBytes: Number(draft.maxBytes),
      timeoutSeconds: Number(draft.timeoutSeconds),
    };
    onSubmit(payload);
  };

  return (
    <form className="source-registry-form" onSubmit={submit}>
      {error != null && <ErrorState error={error} />}
      {testError != null && <ErrorState error={testError} />}
      {validation && <Notice tone="error">{validation}</Notice>}
      <div className="form-grid">
        <Field label="Tên nguồn">
          <input
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <AsyncSelect
          label="Warehouse đích"
          value={draft.targetWarehouse || currentWarehouse}
          onSelect={(item) => {
            set("targetWarehouse", item);
            set("targetDataset", undefined);
          }}
          load={loadWarehouses}
          getId={(item) => item.warehouseId}
          getLabel={(item) => `${item.name} · ${item.engine}`}
          cacheKey="ingestion-target-warehouses"
        />
        <AsyncSelect
          label="Dataset đích"
          value={draft.targetDataset || currentDataset}
          disabled={!draft.targetWarehouse && !currentWarehouse}
          onSelect={(item) => set("targetDataset", item)}
          load={loadDatasets(draft.targetWarehouse || currentWarehouse)}
          getId={(item) => item.datasetId}
          getLabel={(item) => `${item.name} · ${item.status}`}
          cacheKey={`ingestion-target-datasets/${(draft.targetWarehouse || currentWarehouse)?.warehouseId}`}
        />
        <AsyncSelect
          label="Warehouse nguồn"
          value={
            draft.sourceWarehouse ||
            (!initial ? draft.targetWarehouse || currentWarehouse : undefined)
          }
          onSelect={(item) => {
            set("sourceWarehouse", item);
            set("sourceDataset", undefined);
          }}
          load={loadWarehouses}
          getId={(item) => item.warehouseId}
          getLabel={(item) => `${item.name} · ${item.engine}`}
          cacheKey="ingestion-source-warehouses"
        />
        <AsyncSelect
          label="Dataset nguồn"
          value={
            draft.sourceDataset ||
            (!initial ? draft.targetDataset || currentDataset : undefined)
          }
          disabled={
            !(
              draft.sourceWarehouse ||
              (!initial ? draft.targetWarehouse || currentWarehouse : undefined)
            )
          }
          onSelect={(item) => set("sourceDataset", item)}
          load={loadDatasets(
            draft.sourceWarehouse ||
              (!initial
                ? draft.targetWarehouse || currentWarehouse
                : undefined),
          )}
          getId={(item) => item.datasetId}
          getLabel={(item) => `${item.name} · ${item.status}`}
          cacheKey={`ingestion-source-datasets/${(draft.sourceWarehouse || (!initial ? draft.targetWarehouse || currentWarehouse : undefined))?.warehouseId}`}
        />
      </div>
      {targetWarehouseQuery.error && (
        <ErrorState
          error={targetWarehouseQuery.error}
          retry={() => void targetWarehouseQuery.refetch()}
        />
      )}
      {targetDatasetQuery.error && (
        <ErrorState
          error={targetDatasetQuery.error}
          retry={() => void targetDatasetQuery.refetch()}
        />
      )}
      {sourceWarehouseQuery.error && (
        <ErrorState
          error={sourceWarehouseQuery.error}
          retry={() => void sourceWarehouseQuery.refetch()}
        />
      )}
      {sourceDatasetQuery.error && (
        <ErrorState
          error={sourceDatasetQuery.error}
          retry={() => void sourceDatasetQuery.refetch()}
        />
      )}
      <Field
        label="SELECT nguồn"
        hint="Java kiểm tra truy vấn theo metadata và allowlist của dataset nguồn."
      >
        <textarea
          required
          rows={6}
          maxLength={100000}
          value={draft.readSql}
          onChange={(e) => set("readSql", e.target.value)}
          placeholder="SELECT source_column AS result_alias FROM registered_table"
        />
      </Field>
      <div className="form-grid">
        <Field label="Schema raw">
          <select
            required
            value={draft.rawSchema}
            onChange={(e) => set("rawSchema", e.target.value)}
          >
            <option value="">Chọn schema</option>
            {stageSchemas.map((schema) => (
              <option key={schema}>{schema}</option>
            ))}
          </select>
        </Field>
        <Field label="Bảng raw">
          <input
            required
            value={draft.rawName}
            onChange={(e) => set("rawName", e.target.value)}
          />
        </Field>
        <Field label="Schema staging">
          <select
            required
            value={draft.stageSchema}
            onChange={(e) => set("stageSchema", e.target.value)}
          >
            <option value="">Chọn schema</option>
            {stageSchemas.map((schema) => (
              <option key={schema}>{schema}</option>
            ))}
          </select>
        </Field>
        <Field label="Bảng staging">
          <input
            required
            value={draft.stageName}
            onChange={(e) => set("stageName", e.target.value)}
          />
        </Field>
        <Field label="Schema warehouse">
          <select
            required
            value={draft.warehouseSchema}
            onChange={(e) => set("warehouseSchema", e.target.value)}
          >
            <option value="">Chọn schema</option>
            {stageSchemas.map((schema) => (
              <option key={schema}>{schema}</option>
            ))}
          </select>
        </Field>
        <Field label="Bảng warehouse">
          <input
            required
            value={draft.warehouseName}
            onChange={(e) => set("warehouseName", e.target.value)}
          />
        </Field>
        <Field label="Schema mart">
          <select
            required
            value={draft.martSchema}
            onChange={(e) => set("martSchema", e.target.value)}
          >
            <option value="">Chọn schema</option>
            {stageSchemas.map((schema) => (
              <option key={schema}>{schema}</option>
            ))}
          </select>
        </Field>
        <Field label="Bảng mart">
          <input
            required
            value={draft.martName}
            onChange={(e) => set("martName", e.target.value)}
          />
        </Field>
      </div>
      {allowedSourceSchemas.length === 0 && (
        <Notice tone="warning">
          Dataset nguồn chưa khai báo schema được phép; truy vấn sẽ không qua
          validation Java cho tới khi metadata được cấu hình.
        </Notice>
      )}
      <section className="source-columns">
        <h3>Cột kết quả và kiểu canonical</h3>
        <div className="source-column-list">
          {draft.columns.map((column, index) => (
            <div className="source-column-row" key={index}>
              <Field label={`Alias ${index + 1}`}>
                <input
                  required
                  pattern="[A-Za-z_][A-Za-z0-9_]{0,62}"
                  value={column.name}
                  onChange={(e) =>
                    updateColumn(index, { name: e.target.value })
                  }
                />
              </Field>
              <Field label="Kiểu">
                <select
                  value={column.type}
                  onChange={(e) =>
                    updateColumn(index, {
                      type: e.target.value as ColumnDraft["type"],
                      maxLength:
                        e.target.value === "STRING" ? column.maxLength : "",
                    })
                  }
                >
                  {canonicalTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Độ dài STRING">
                <input
                  type="number"
                  min="1"
                  max="10000"
                  disabled={column.type !== "STRING"}
                  value={column.maxLength}
                  onChange={(e) =>
                    updateColumn(index, { maxLength: e.target.value })
                  }
                />
              </Field>
              <label className="source-required">
                <input
                  type="checkbox"
                  checked={column.required}
                  onChange={(e) =>
                    updateColumn(index, { required: e.target.checked })
                  }
                />{" "}
                Bắt buộc
              </label>
              <Button
                aria-label={`Xóa alias ${index + 1}`}
                disabled={draft.columns.length === 1}
                onClick={() =>
                  set(
                    "columns",
                    draft.columns.filter((_, i) => i !== index),
                  )
                }
              >
                Xóa
              </Button>
            </div>
          ))}
        </div>
        <Button
          onClick={() =>
            set("columns", [
              ...draft.columns,
              { name: "", type: "STRING", required: false, maxLength: "" },
            ])
          }
        >
          <Plus size={15} /> Thêm cột
        </Button>
      </section>
      <div className="form-grid source-limits">
        <Field label="Giới hạn dòng">
          <input
            type="number"
            min="1"
            max="10000"
            required
            value={draft.maxRows}
            onChange={(e) => set("maxRows", e.target.value)}
          />
        </Field>
        <Field label="Giới hạn dữ liệu (byte)">
          <input
            type="number"
            min="1024"
            max="52428800"
            required
            value={draft.maxBytes}
            onChange={(e) => set("maxBytes", e.target.value)}
          />
        </Field>
        <Field label="Timeout (giây)">
          <input
            type="number"
            min="1"
            max="60"
            required
            value={draft.timeoutSeconds}
            onChange={(e) => set("timeoutSeconds", e.target.value)}
          />
        </Field>
      </div>
      {testResult && <SourceTestResult result={testResult} />}
      <div className="inline-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu cấu hình"}
        </Button>
        {sourceIdReady && (
          <Button
            disabled={testPending}
            onClick={() => onTest(initial!.sourceId)}
          >
            <FlaskConical size={16} />{" "}
            {testPending ? "Đang kiểm tra…" : "Kiểm tra nguồn"}
          </Button>
        )}
      </div>
    </form>
  );
}

function SourceTestResult({ result }: { result: SourceTest }) {
  return (
    <div className="source-test-result">
      <Notice tone={result.reachable ? "success" : "error"}>
        <strong>
          {result.reachable ? "Nguồn và đích sẵn sàng" : "Kiểm tra chưa đạt"}
        </strong>
        <div>
          {result.sourceEngine} → {result.targetEngine} ·{" "}
          {result.rowCount.toLocaleString("vi-VN")} dòng mẫu
          {result.truncated ? " (đã giới hạn)" : ""} ·{" "}
          {new Date(result.checkedAt).toLocaleString("vi-VN")}
        </div>
      </Notice>
      <p>
        Cột trả về:{" "}
        {result.columns
          .map((column) => `${column.name} (${column.dataType})`)
          .join(", ") || "không có"}
      </p>
      <p>
        Đích đã kiểm tra:{" "}
        {result.targets
          .map((target) => `${target.schema}.${target.name}`)
          .join(", ") || "không có"}
      </p>
    </div>
  );
}

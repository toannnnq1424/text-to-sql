import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileSpreadsheet,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { datasetApi } from "../api/datasetApi";
import { ingestionApi } from "../api/ingestionApi";
import { warehouseApi } from "../api/warehouseApi";
import {
  FileDataTypeSchema,
  type FileColumn,
  type FilePlan,
  type FileRun,
  type FileUpload,
} from "../api/schema";
import { formatDate } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  Notice,
  Resource,
  Pagination,
} from "../components/ui";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const acceptedExtensions = [
  ".csv",
  ".tsv",
  ".txt",
  ".xlsx",
  ".json",
  ".jsonl",
  ".ndjson",
  ".parquet",
  ".arrow",
  ".feather",
  ".ipc",
  ".orc",
  ".avro",
];
const dataTypes = FileDataTypeSchema.options;

function safeName(value: string, fallback: string) {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^\d+/, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || fallback;
}

function displayCell(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fileExtension(fileName: string) {
  return fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
}

export function FileIngestionWorkflow() {
  const context = useWarehouse();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File>();
  const [upload, setUpload] = useState<FileUpload>();
  const [columns, setColumns] = useState<FileColumn[]>([]);
  const [plan, setPlan] = useState<FilePlan>();
  const [runId, setRunId] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historySize, setHistorySize] = useState(10);
  const [targetWarehouseId, setTargetWarehouseId] = useState(
    context.warehouseId,
  );
  const [targetSchema, setTargetSchema] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [delimiter, setDelimiter] = useState("");
  const [formError, setFormError] = useState("");
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadSequence = useRef(0);
  const idempotency = useRef<{ planId: string; key: string } | undefined>(
    undefined,
  );
  const selectedDataset = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);

  const warehouses = useQuery({
    queryKey: ["warehouses", "file-ingestion-targets"],
    queryFn: ({ signal }) =>
      warehouseApi.list({ page: 1, pageSize: 100 }, signal),
  });
  const activeWarehouses = (warehouses.data?.items || []).filter(
    (warehouse) => warehouse.status === "ACTIVE",
  );
  const targets = useQuery({
    queryKey: ["file-ingestion-targets", targetWarehouseId],
    queryFn: ({ signal }) =>
      ingestionApi.fileTargets(targetWarehouseId, signal),
    enabled: Boolean(targetWarehouseId && auth.can("OPERATOR")),
  });
  const runs = useQuery({
    queryKey: [
      "file-ingestion-runs",
      targetWarehouseId,
      historyPage,
      historySize,
    ],
    queryFn: ({ signal }) =>
      ingestionApi.fileRuns(
        {
          warehouseId: targetWarehouseId || context.warehouseId,
          page: historyPage,
          pageSize: historySize,
        },
        signal,
      ),
    enabled: Boolean(targetWarehouseId || context.warehouseId),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["PENDING", "RUNNING"].includes(item.status),
      )
        ? 2500
        : false,
  });
  const selectedRun = useQuery({
    queryKey: ["file-ingestion-run", runId],
    queryFn: ({ signal }) => ingestionApi.getFileRun(runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      query.state.data &&
      ["PENDING", "RUNNING"].includes(query.state.data.status)
        ? 1500
        : false,
  });
  const registeredDataset = useQuery({
    queryKey: ["file-ingestion-dataset", selectedRun.data?.datasetId],
    queryFn: ({ signal }) =>
      datasetApi.get(selectedRun.data!.datasetId!, signal),
    enabled: Boolean(
      selectedRun.data?.status === "SUCCESS" && selectedRun.data.datasetId,
    ),
  });

  useEffect(() => {
    setTargetWarehouseId(context.warehouseId);
    setTargetSchema("");
    clearPlan();
  }, [context.warehouseId]);
  useEffect(() => {
    const dataset = registeredDataset.data;
    if (!dataset || selectedDataset.current === dataset.datasetId) return;
    if (dataset.warehouseId !== context.warehouseId) {
      const warehouse = activeWarehouses.find(
        (item) => item.warehouseId === dataset.warehouseId,
      );
      if (warehouse) context.selectWarehouse(warehouse);
      return;
    }
    context.selectDataset(dataset);
    selectedDataset.current = dataset.datasetId;
  }, [
    activeWarehouses,
    context.selectDataset,
    context.selectWarehouse,
    context.warehouseId,
    registeredDataset.data,
  ]);

  const uploadFile = useMutation({
    mutationFn: async (input: {
      file: File;
      sheet?: string;
      delimiter?: string;
      sequence: number;
    }) => {
      uploadController.current?.abort();
      const controller = new AbortController();
      uploadController.current = controller;
      try {
        return await ingestionApi.uploadFile(input, controller.signal);
      } finally {
        if (uploadController.current === controller)
          uploadController.current = undefined;
      }
    },
    onSuccess: (result, input) => {
      if (input.sequence !== uploadSequence.current) return;
      setUpload(result);
      setColumns(result.columns);
      setPlan(undefined);
      setRunId("");
      setFormError("");
    },
    onError: (error, input) => {
      if (input.sequence !== uploadSequence.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFormError(error.message);
    },
  });
  const validate = useMutation({
    mutationFn: () => {
      if (!upload) throw new Error("Hãy phân tích file trước.");
      return ingestionApi.validateFile(upload.id, {
        warehouseId: targetWarehouseId,
        targetSchema,
        targetTable,
        datasetName,
        columns,
      });
    },
    onSuccess: (result) => {
      setPlan(result);
      idempotency.current = undefined;
      setFormError("");
    },
    onError: (error) => setFormError(error.message),
  });
  const start = useMutation({
    mutationFn: () => {
      if (!plan) throw new Error("Kế hoạch nạp dữ liệu chưa được xác thực.");
      if (Date.parse(plan.expiresAt) <= Date.now()) {
        setPlan(undefined);
        idempotency.current = undefined;
        throw new Error(
          "Kế hoạch đã hết hạn. Hãy xác thực lại file và mapping.",
        );
      }
      if (!idempotency.current || idempotency.current.planId !== plan.id) {
        idempotency.current = {
          planId: plan.id,
          key: crypto.randomUUID(),
        };
      }
      return ingestionApi.runFile({
        planId: plan.id,
        digest: plan.digest,
        idempotencyKey: idempotency.current.key,
      });
    },
    onSuccess: (result) => {
      setRunId(result.id);
      setFormError("");
      void queryClient.invalidateQueries({ queryKey: ["file-ingestion-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["datasets"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
    onError: (error) => setFormError(error.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => ingestionApi.cancelFileRun(id),
    onSuccess: (result) => {
      void queryClient.setQueryData(["file-ingestion-run", result.id], result);
      void queryClient.invalidateQueries({ queryKey: ["file-ingestion-runs"] });
    },
  });

  function clearPlan() {
    setPlan(undefined);
    idempotency.current = undefined;
  }

  function releaseUpload() {
    if (upload)
      void ingestionApi
        .discardFile(upload.id)
        .catch((error: Error) => setFormError(error.message));
  }

  function reset() {
    if (currentRun && ["PENDING", "RUNNING"].includes(currentRun.status))
      return;
    releaseUpload();
    uploadSequence.current += 1;
    uploadController.current?.abort();
    uploadMutationReset();
    setFile(undefined);
    setUpload(undefined);
    setColumns([]);
    setPlan(undefined);
    setRunId("");
    setTargetTable("");
    setDatasetName("");
    setFormError("");
    setDelimiter("");
    idempotency.current = undefined;
    if (fileInput.current) fileInput.current.value = "";
  }

  function uploadMutationReset() {
    uploadFile.reset();
    validate.reset();
    start.reset();
  }

  function chooseFile(next?: File) {
    if (!next) return;
    if (
      validate.isPending ||
      start.isPending ||
      (currentRun && ["PENDING", "RUNNING"].includes(currentRun.status))
    )
      return;
    if (!auth.can("OPERATOR")) {
      setFormError("Bạn cần quyền Operator để nạp file vào warehouse.");
      return;
    }
    reset();
    const extension = fileExtension(next.name);
    if (!acceptedExtensions.includes(extension)) {
      setFormError("Định dạng file chưa được hỗ trợ.");
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setFormError("File vượt giới hạn 25 MiB.");
      return;
    }
    setFile(next);
    setTargetTable(safeName(next.name, "imported_data"));
    setDatasetName(safeName(next.name, "Imported file"));
    uploadFile.mutate({
      file: next,
      delimiter: delimiter || undefined,
      sequence: ++uploadSequence.current,
    });
  }

  function changeSheet(sheet: string) {
    if (
      !file ||
      (currentRun && ["PENDING", "RUNNING"].includes(currentRun.status))
    )
      return;
    releaseUpload();
    clearPlan();
    setUpload(undefined);
    uploadFile.mutate({
      file,
      sheet,
      delimiter: delimiter || undefined,
      sequence: ++uploadSequence.current,
    });
  }

  function changeDelimiter(next: string) {
    if (currentRun && ["PENDING", "RUNNING"].includes(currentRun.status))
      return;
    releaseUpload();
    setDelimiter(next);
    if (
      file &&
      upload &&
      [".csv", ".tsv", ".txt"].includes(fileExtension(file.name))
    ) {
      setUpload(undefined);
      clearPlan();
      uploadFile.mutate({
        file,
        sheet: upload.sheet,
        delimiter: next || undefined,
        sequence: ++uploadSequence.current,
      });
    }
  }

  function updateColumn(index: number, patch: Partial<FileColumn>) {
    clearPlan();
    setColumns((current) =>
      current.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    );
  }

  const selectedWarehouse = activeWarehouses.find(
    (warehouse) => warehouse.warehouseId === targetWarehouseId,
  );
  const canRun = auth.can("OPERATOR") && selectedWarehouse !== undefined;
  const currentRun = selectedRun.data;

  return (
    <section className="file-ingestion-workflow" aria-label="Nạp file dữ liệu">
      <Card
        title="Nạp file dữ liệu"
        icon={<FileSpreadsheet size={22} />}
        actions={
          <span className="file-ingestion-limit">
            Tối đa 25 MiB · 100.000 dòng · 200 cột
          </span>
        }
      >
        <ol className="file-ingestion-stepper" aria-label="Các bước nạp file">
          {[
            "Tải file và phân tích",
            "Chỉnh mapping và đích",
            "Xác nhận kế hoạch",
            "Theo dõi pipeline",
          ].map((label, index) => (
            <li
              className={index <= (plan ? 2 : upload ? 1 : 0) ? "active" : ""}
              key={label}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {!auth.can("OPERATOR") && (
          <Notice>Bạn cần quyền Operator để nạp file vào warehouse.</Notice>
        )}
        {formError && (
          <div className="file-ingestion-error" role="alert">
            <AlertTriangle size={18} />
            <span>{formError}</span>
          </div>
        )}

        <div className="file-ingestion-upload-row">
          <div
            className={`file-drop-zone${uploadFile.isPending ? " uploading" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (
                !auth.can("OPERATOR") ||
                validate.isPending ||
                start.isPending
              )
                return;
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept={acceptedExtensions.join(",")}
              aria-label="Chọn file dữ liệu"
              disabled={
                !auth.can("OPERATOR") ||
                validate.isPending ||
                start.isPending ||
                Boolean(
                  currentRun &&
                  ["PENDING", "RUNNING"].includes(currentRun.status),
                )
              }
              onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
            />
            <span className="file-drop-icon">
              {uploadFile.isPending ? (
                <RefreshCw size={26} className="spin" />
              ) : (
                <Upload size={26} />
              )}
            </span>
            <strong>
              {uploadFile.isPending
                ? "Đang phân tích file…"
                : file?.name || "Kéo file vào đây hoặc chọn file"}
            </strong>
            <small>
              CSV, TSV, XLSX, JSON, NDJSON, Parquet, Arrow, ORC, Avro
            </small>
            <label className="button secondary file-picker-button">
              <input
                type="file"
                accept={acceptedExtensions.join(",")}
                disabled={
                  !auth.can("OPERATOR") ||
                  validate.isPending ||
                  start.isPending ||
                  Boolean(
                    currentRun &&
                    ["PENDING", "RUNNING"].includes(currentRun.status),
                  )
                }
                onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
              />
              Chọn file
            </label>
            {uploadFile.isPending && (
              <Button
                onClick={() => uploadController.current?.abort()}
                aria-label="Hủy phân tích file"
              >
                <X size={16} /> Hủy
              </Button>
            )}
          </div>
          {file && (
            <div className="file-ingestion-file-meta">
              <span>{formatBytes(file.size)}</span>
              {upload && (
                <span>{upload.rowCount.toLocaleString("vi-VN")} dòng</span>
              )}
              {upload && <span>{upload.columnCount} cột</span>}
              <Button
                onClick={reset}
                disabled={
                  uploadFile.isPending ||
                  validate.isPending ||
                  start.isPending ||
                  Boolean(
                    currentRun &&
                    ["PENDING", "RUNNING"].includes(currentRun.status),
                  )
                }
              >
                <RotateCcw size={16} /> Đặt lại
              </Button>
            </div>
          )}
        </div>

        {upload && (
          <>
            <div className="file-ingestion-toolbar">
              {upload.sheets.length > 0 && (
                <Field label="Trang tính">
                  <select
                    value={upload.sheet || upload.sheets[0]}
                    onChange={(event) => changeSheet(event.currentTarget.value)}
                    disabled={uploadFile.isPending}
                  >
                    {upload.sheets.map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {[".csv", ".tsv", ".txt"].includes(
                fileExtension(upload.fileName),
              ) && (
                <Field label="Dấu phân cách">
                  <select
                    value={delimiter}
                    onChange={(event) =>
                      changeDelimiter(event.currentTarget.value)
                    }
                    disabled={uploadFile.isPending}
                  >
                    <option value="">Tự phát hiện</option>
                    <option value=",">Dấu phẩy (,)</option>
                    <option value=";">Chấm phẩy (;)</option>
                    <option value="\t">Tab</option>
                    <option value="|">Gạch đứng (|)</option>
                  </select>
                </Field>
              )}
              <div className="file-ingestion-summary">
                <strong>{upload.rowCount.toLocaleString("vi-VN")}</strong> dòng
                · {upload.columnCount} cột · {formatBytes(upload.fileSize)}
              </div>
            </div>
            {upload.warnings.length > 0 && (
              <Notice>
                {upload.warnings.map((warning) => (
                  <span className="file-ingestion-warning" key={warning}>
                    <AlertTriangle size={15} /> {warning}
                  </span>
                ))}
              </Notice>
            )}
            <Card title="Ánh xạ cột được phát hiện" icon={<Check size={20} />}>
              <p className="muted">
                Hệ thống nhận diện toàn bộ cột và kiểu dữ liệu. Có thể chỉnh
                tên, kiểu hoặc nullable trước khi kiểm tra kế hoạch.
              </p>
              <div className="file-ingestion-mapping-scroll">
                <table className="file-ingestion-mapping">
                  <thead>
                    <tr>
                      <th>Cột trong file</th>
                      <th>Tên cột đích</th>
                      <th>Kiểu dữ liệu</th>
                      <th>Cho phép rỗng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((column, index) => (
                      <tr key={`${column.sourceName}-${index}`}>
                        <td>
                          <strong>{column.sourceName}</strong>
                        </td>
                        <td>
                          <input
                            aria-label={`Tên đích cho ${column.sourceName}`}
                            value={column.name}
                            maxLength={128}
                            onChange={(event) =>
                              updateColumn(index, {
                                name: event.currentTarget.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`Kiểu dữ liệu cho ${column.sourceName}`}
                            value={column.dataType}
                            onChange={(event) =>
                              updateColumn(index, {
                                dataType: event.currentTarget
                                  .value as FileColumn["dataType"],
                              })
                            }
                          >
                            {dataTypes.map((type) => (
                              <option value={type} key={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Cho phép giá trị rỗng cho ${column.sourceName}`}
                            checked={column.nullable}
                            onChange={(event) =>
                              updateColumn(index, {
                                nullable: event.currentTarget.checked,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card
              title="Xem trước 20 dòng"
              icon={<FileSpreadsheet size={20} />}
            >
              <div className="file-ingestion-preview-scroll">
                <table className="file-ingestion-preview">
                  <thead>
                    <tr>
                      <th>#</th>
                      {columns.map((column, index) => (
                        <th key={`${column.sourceName}-${index}`}>
                          {column.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {upload.previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        <td>{rowIndex + 1}</td>
                        {columns.map((column, columnIndex) => (
                          <td key={`${column.sourceName}-${columnIndex}`}>
                            {displayCell(row[columnIndex])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {upload.previewRows.length === 0 && (
                <Empty
                  title="Không có dòng xem trước"
                  description="Kiểm tra file hoặc chọn một trang tính khác."
                />
              )}
            </Card>
            <Card title="Đích và dataset" icon={<ChevronRight size={20} />}>
              <div className="file-ingestion-target-grid">
                <Field label="Warehouse đích">
                  <select
                    aria-label="Warehouse đích"
                    value={targetWarehouseId}
                    onChange={(event) => {
                      clearPlan();
                      setTargetWarehouseId(event.currentTarget.value);
                      setTargetSchema("");
                    }}
                    disabled={
                      warehouses.isPending || activeWarehouses.length === 0
                    }
                  >
                    {activeWarehouses.map((warehouse) => (
                      <option
                        value={warehouse.warehouseId}
                        key={warehouse.warehouseId}
                      >
                        {warehouse.name} · {warehouse.engine.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Namespace / schema">
                  <select
                    aria-label="Namespace / schema"
                    value={targetSchema}
                    onChange={(event) => {
                      clearPlan();
                      setTargetSchema(event.currentTarget.value);
                    }}
                    disabled={
                      targets.isPending || !targets.data?.namespaces.length
                    }
                  >
                    <option value="">
                      {targets.isPending
                        ? "Đang kiểm tra quyền tạo bảng…"
                        : "Chọn namespace được phép ghi"}
                    </option>
                    {targets.data?.namespaces.map((namespace) => (
                      <option value={namespace} key={namespace}>
                        {namespace}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Bảng đích">
                  <input
                    aria-label="Bảng đích"
                    value={targetTable}
                    maxLength={128}
                    onChange={(event) => {
                      clearPlan();
                      setTargetTable(event.currentTarget.value);
                    }}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Tên dataset">
                  <input
                    aria-label="Tên dataset"
                    value={datasetName}
                    maxLength={120}
                    onChange={(event) => {
                      clearPlan();
                      setDatasetName(event.currentTarget.value);
                    }}
                    autoComplete="off"
                  />
                </Field>
              </div>
              {targets.error && (
                <ErrorState
                  error={targets.error}
                  retry={() => void targets.refetch()}
                />
              )}
              {targets.data && targets.data.namespaces.length === 0 && (
                <Notice>
                  Warehouse này chưa có namespace mà tài khoản writer được phép
                  tạo bảng.
                </Notice>
              )}
              <div className="file-ingestion-actions">
                <Button
                  variant="primary"
                  disabled={
                    !canRun ||
                    !upload ||
                    columns.length === 0 ||
                    !targetSchema.trim() ||
                    !targetTable.trim() ||
                    !datasetName.trim() ||
                    validate.isPending ||
                    start.isPending
                  }
                  onClick={() => validate.mutate()}
                >
                  {validate.isPending
                    ? "Đang xác thực…"
                    : "Kiểm tra và tạo kế hoạch"}
                </Button>
                {!canRun && (
                  <small>
                    Chọn warehouse đang hoạt động và cần quyền Operator.
                  </small>
                )}
              </div>
            </Card>
          </>
        )}

        {plan && (
          <Card title="Kế hoạch đã xác thực" icon={<ShieldIcon />}>
            <Notice>
              Kế hoạch được đóng dấu bằng digest. Mọi thay đổi file, mapping
              hoặc đích sẽ yêu cầu xác thực lại.
            </Notice>
            <dl className="file-ingestion-plan-summary">
              <div>
                <dt>File</dt>
                <dd>{plan.fileName}</dd>
              </div>
              <div>
                <dt>Đích</dt>
                <dd>
                  {plan.targetSchema}.{plan.targetTable}
                </dd>
              </div>
              <div>
                <dt>Dataset</dt>
                <dd>{plan.datasetName}</dd>
              </div>
              <div>
                <dt>Số dòng</dt>
                <dd>{plan.rowCount.toLocaleString("vi-VN")}</dd>
              </div>
              <div>
                <dt>Digest</dt>
                <dd>
                  <code>{plan.digest}</code>
                </dd>
              </div>
              <div>
                <dt>Hết hạn</dt>
                <dd>{formatDate(plan.expiresAt)}</dd>
              </div>
            </dl>
            <ol className="file-ingestion-layers">
              {plan.layers.map((layer, index) => (
                <li key={layer.name}>
                  <span className="layer-order">{index + 1}</span>
                  <div>
                    <strong>{layer.name}</strong>
                    <small>
                      {layer.schema}.{layer.table}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
            {plan.warnings.map((warning) => (
              <Notice key={warning}>{warning}</Notice>
            ))}
            <div className="file-ingestion-actions">
              <Button
                variant="primary"
                disabled={!canRun || start.isPending}
                onClick={() => start.mutate()}
              >
                {start.isPending ? "Đang bắt đầu…" : "Xác nhận và nạp dữ liệu"}
              </Button>
              <Button onClick={clearPlan} disabled={start.isPending}>
                Hủy kế hoạch
              </Button>
            </div>
          </Card>
        )}

        {runId && (
          <Card title="Tiến độ nạp dữ liệu" icon={<RefreshCw size={20} />}>
            {selectedRun.error && (
              <ErrorState
                error={selectedRun.error}
                retry={() => void selectedRun.refetch()}
              />
            )}
            {selectedRun.isPending && <p role="status">Đang tải tiến độ…</p>}
            {currentRun && (
              <FileRunStatus
                run={currentRun}
                onCancel={() => cancel.mutate(currentRun.id)}
                cancelPending={cancel.isPending}
              />
            )}
            {cancel.error && <ErrorState error={cancel.error} />}
          </Card>
        )}
        {uploadFile.error && !formError && (
          <ErrorState error={uploadFile.error} />
        )}
        {validate.error && !formError && <ErrorState error={validate.error} />}
        {start.error && !formError && <ErrorState error={start.error} />}
      </Card>

      <Card title="Lịch sử nạp file" icon={<RefreshCw size={20} />}>
        {runs.error && (
          <ErrorState error={runs.error} retry={() => void runs.refetch()} />
        )}
        {runs.isPending && <p role="status">Đang tải lịch sử…</p>}
        {runs.data && runs.data.items.length === 0 && (
          <Empty
            title="Chưa có lần nạp file"
            description="Các lần nạp file đã xác nhận sẽ xuất hiện tại đây."
          />
        )}
        {runs.data && runs.data.items.length > 0 && (
          <div className="file-ingestion-history">
            {runs.data.items.map((item) => (
              <button
                className={`file-ingestion-history-row${item.id === runId ? " selected" : ""}`}
                key={item.id}
                onClick={() => setRunId(item.id)}
              >
                <span className="history-file">
                  <FileSpreadsheet size={18} />
                  {item.fileName}
                </span>
                <Badge status={item.status} />
                <span>
                  {item.rowsLoaded.toLocaleString("vi-VN")} /{" "}
                  {item.rowCount.toLocaleString("vi-VN")} dòng
                </span>
                <time>{formatDate(item.startedAt)}</time>
              </button>
            ))}
          </div>
        )}
        {runs.data && runs.data.totalItems > 0 && (
          <Pagination
            {...runs.data}
            onChange={(page, size) => {
              setHistoryPage(page);
              setHistorySize(size);
            }}
          />
        )}
      </Card>
      {currentRun?.status === "SUCCESS" && currentRun.datasetId && (
        <div className="file-ingestion-completion" role="status">
          <Check size={18} /> Dataset đã đăng ký.{" "}
          <Link to="/catalog/tables">Mở Data Catalog</Link>
          <Link to="/query">Đặt câu hỏi</Link>
          <small>{currentRun.datasetId}</small>
        </div>
      )}
    </section>
  );
}

function FileRunStatus({
  run,
  onCancel,
  cancelPending,
}: {
  run: FileRun;
  onCancel: () => void;
  cancelPending: boolean;
}) {
  return (
    <>
      <div className="file-run-overview">
        <div>
          <small>File</small>
          <strong>{run.fileName}</strong>
        </div>
        <div>
          <small>Trạng thái</small>
          <Badge status={run.status} />
        </div>
        <div>
          <small>Đã nạp</small>
          <strong>
            {run.rowsLoaded.toLocaleString("vi-VN")} /{" "}
            {run.rowCount.toLocaleString("vi-VN")}
          </strong>
        </div>
        <div>
          <small>Bắt đầu</small>
          <strong>{formatDate(run.startedAt)}</strong>
        </div>
      </div>
      <ol className="file-ingestion-layers">
        {run.stages.map((stage, index) => (
          <li
            key={stage.name}
            className={`stage-${stage.status.toLowerCase()}`}
          >
            <span className="layer-order">{index + 1}</span>
            <div>
              <strong>{stage.name}</strong>
              <small>
                {stage.status} · {stage.rowsLoaded.toLocaleString("vi-VN")} dòng
              </small>
            </div>
          </li>
        ))}
      </ol>
      {run.partialFailure && (
        <Notice>
          Pipeline hoàn tất một phần. Hãy xem lỗi chi tiết trước khi tiếp tục.
        </Notice>
      )}
      {run.error && <ErrorState error={run.error} />}
      {run.createdTables.length > 0 && (
        <div className="file-ingestion-created-tables">
          <strong>Các bảng được tạo</strong>
          {run.createdTables.map((table) => (
            <code key={`${table.schema}.${table.table}`}>
              {table.schema}.{table.table}
            </code>
          ))}
        </div>
      )}
      {["PENDING", "RUNNING"].includes(run.status) && (
        <Button onClick={onCancel} disabled={cancelPending}>
          <X size={16} /> {cancelPending ? "Đang hủy…" : "Hủy lần nạp"}
        </Button>
      )}
      {run.datasetId && run.status === "SUCCESS" && (
        <div className="file-ingestion-dataset-link">
          Dataset ID: <code>{run.datasetId}</code>{" "}
          <Link to="/catalog/tables">Mở Data Catalog</Link>
          <Link to="/query">Đặt câu hỏi</Link>
        </div>
      )}
    </>
  );
}

function ShieldIcon() {
  return <Check size={20} />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

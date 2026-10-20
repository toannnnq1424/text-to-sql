import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Eye,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { catalogApi } from "../api/catalogApi";
import { datasetApi } from "../api/datasetApi";
import { ingestionApi } from "../api/ingestionApi";
import { warehouseApi } from "../api/warehouseApi";
import type {
  Dataset,
  IngestionSource,
  IngestionSourceInput,
  SourcePreview,
  TableMetadata,
  Warehouse,
} from "../api/schema";
import { IngestionSourceInputSchema } from "../api/schema";
import { engineLabel } from "../lib/format";
import {
  AsyncSelect,
  Button,
  DataGrid,
  DetailList,
  ErrorState,
  Field,
  Notice,
  SqlBlock,
} from "../components/ui";

const layers = [
  {
    key: "raw",
    label: "Dữ liệu gốc",
    technical: "Raw",
    description: "Giữ bản sao dữ liệu vừa đọc từ nguồn.",
  },
  {
    key: "stage",
    label: "Dữ liệu chuẩn hóa",
    technical: "Staging",
    description: "Chứa các dòng đạt quy tắc chất lượng.",
  },
  {
    key: "warehouse",
    label: "Kho dữ liệu",
    technical: "Warehouse",
    description: "Lưu dữ liệu đã chuẩn hóa để dùng chung.",
  },
  {
    key: "mart",
    label: "Dữ liệu phân tích",
    technical: "Mart",
    description: "Bảng cuối được dùng để phân tích trong dataset đích.",
  },
] as const;
type Target = IngestionSourceInput["raw"];
type Targets = Partial<Record<(typeof layers)[number]["key"], Target>>;
type Rule = { required: boolean; maxLength: string };
const tableName = (table: Target) => `${table.schema}.${table.name}`;

export function IngestionSourceWizard({
  initial,
  currentWarehouse,
  currentDataset,
  busy,
  error,
  onSubmit,
}: {
  initial?: IngestionSource;
  currentWarehouse?: Warehouse;
  currentDataset?: Dataset;
  busy: boolean;
  error: unknown;
  onSubmit: (input: IngestionSourceInput) => void;
}) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState(initial?.name || "");
  const [sourceWarehouse, setSourceWarehouse] = useState<Warehouse | undefined>(
    initial ? undefined : currentWarehouse,
  );
  const [sourceDataset, setSourceDataset] = useState<Dataset | undefined>(
    initial ? undefined : currentDataset,
  );
  const [targetWarehouse, setTargetWarehouse] = useState<Warehouse | undefined>(
    initial ? undefined : currentWarehouse,
  );
  const [targetDataset, setTargetDataset] = useState<Dataset | undefined>(
    initial ? undefined : currentDataset,
  );
  const [mode, setMode] = useState<"table" | "sql">(initial ? "sql" : "table");
  const [sourceTable, setSourceTable] = useState<TableMetadata>();
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [sql, setSql] = useState(initial?.readSql || "");
  const [preview, setPreview] = useState<SourcePreview>();
  const [targets, setTargets] = useState<Targets>(
    initial
      ? {
          raw: initial.raw,
          stage: initial.stage,
          warehouse: initial.warehouse,
          mart: initial.mart,
        }
      : {},
  );
  const [rules, setRules] = useState<Record<string, Rule>>(() =>
    Object.fromEntries(
      (initial?.columns || []).map((column) => [
        column,
        {
          required: initial!.requiredColumns.includes(column),
          maxLength: initial!.maxStringLengths[column]?.toString() || "",
        },
      ]),
    ),
  );
  const [limits, setLimits] = useState({
    maxRows: initial?.maxRows || 10000,
    maxBytes: initial?.maxBytes || 52428800,
    timeoutSeconds: initial?.timeoutSeconds || 60,
  });
  const [validation, setValidation] = useState("");
  const version = useRef(0);
  const [checkedSignature, setCheckedSignature] = useState("");
  const contexts = useQuery({
    queryKey: ["source-wizard-context", initial?.sourceId],
    enabled: Boolean(initial),
    queryFn: async () => {
      const [sourceWarehouse, sourceDataset, targetWarehouse, targetDataset] =
        await Promise.all([
          warehouseApi.get(initial!.sourceWarehouseId),
          datasetApi.get(initial!.sourceDatasetId),
          warehouseApi.get(initial!.warehouseId),
          datasetApi.get(initial!.datasetId),
        ]);
      return { sourceWarehouse, sourceDataset, targetWarehouse, targetDataset };
    },
  });
  useEffect(() => {
    if (!contexts.data) return;
    setSourceWarehouse(contexts.data.sourceWarehouse);
    setSourceDataset(contexts.data.sourceDataset);
    setTargetWarehouse(contexts.data.targetWarehouse);
    setTargetDataset(contexts.data.targetDataset);
  }, [contexts.data]);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const invalidate = () => {
    version.current += 1;
    setCheckedSignature("");
    setValidation("");
  };
  const invalidateSource = () => {
    invalidate();
    setPreview(undefined);
  };
  const inspect = useMutation({
    mutationFn: async () => {
      if (!sourceWarehouse || !sourceDataset)
        throw new Error("Chọn kết nối và dataset nguồn.");
      const revision = version.current;
      const data = await ingestionApi.previewSource({
        sourceWarehouseId: sourceWarehouse.warehouseId,
        sourceDatasetId: sourceDataset.datasetId,
        ...(mode === "table"
          ? { tableId: sourceTable!.tableId, columns: selectedColumns }
          : { readSql: sql }),
      });
      return { revision, data };
    },
    onSuccess: ({ revision, data }) => {
      if (version.current !== revision) return;
      setPreview(data);
      setRules((current) =>
        Object.fromEntries(
          data.columns.map((column) => [
            column.name,
            current[column.name] || { required: false, maxLength: "" },
          ]),
        ),
      );
      setStep(1);
    },
  });
  const makeInput = (): IngestionSourceInput => {
    if (
      !sourceWarehouse ||
      !sourceDataset ||
      !targetWarehouse ||
      !targetDataset ||
      !preview
    )
      throw new Error(
        "Chọn nguồn, xem trước dữ liệu và chọn nơi nhận trước khi tiếp tục.",
      );
    if (!name.trim()) throw new Error("Đặt tên nguồn trước khi tiếp tục.");
    if (!layers.every((layer) => targets[layer.key]))
      throw new Error("Chọn đủ bốn bảng nhận dữ liệu.");
    if (
      new Set(layers.map((layer) => tableName(targets[layer.key]!))).size !== 4
    )
      throw new Error(
        "Mỗi bước cần một bảng riêng. Hãy chọn bốn bảng đích khác nhau.",
      );
    const parsed = IngestionSourceInputSchema.safeParse({
      name: name.trim(),
      warehouseId: targetWarehouse.warehouseId,
      datasetId: targetDataset.datasetId,
      sourceWarehouseId: sourceWarehouse.warehouseId,
      sourceDatasetId: sourceDataset.datasetId,
      readSql: preview.readSql,
      ...targets,
      columns: preview.columns.map((column) => column.name),
      columnTypes: preview.columnTypes,
      requiredColumns: preview.columns
        .filter((column) => rules[column.name]?.required)
        .map((column) => column.name),
      maxStringLengths: Object.fromEntries(
        preview.columns
          .filter(
            (column) =>
              preview.columnTypes[column.name] === "STRING" &&
              rules[column.name]?.maxLength,
          )
          .map((column) => [column.name, Number(rules[column.name].maxLength)]),
      ),
      ...limits,
    });
    if (!parsed.success)
      throw new Error(
        parsed.error.issues[0]?.message || "Kiểm tra lại cấu hình.",
      );
    return parsed.data;
  };
  const check = useMutation({
    mutationFn: async () => {
      const input = makeInput();
      const result = await ingestionApi.validateSource(input);
      return { result, signature: JSON.stringify(input) };
    },
    onSuccess: ({ signature }) => setCheckedSignature(signature),
  });
  const loadWarehouses = (
    params: Parameters<typeof warehouseApi.list>[0],
    signal: AbortSignal,
  ) => warehouseApi.list({ ...params, status: "ACTIVE" }, signal);
  const loadDatasets =
    (warehouse?: Warehouse) =>
    (params: Parameters<typeof datasetApi.list>[0], signal: AbortSignal) =>
      warehouse
        ? datasetApi.list(
            { ...params, warehouseId: warehouse.warehouseId, status: "ACTIVE" },
            signal,
          )
        : Promise.resolve({ items: [], page: 1, totalPages: 0 });
  const next = () => {
    try {
      makeInput();
      setValidation("");
      setStep(2);
    } catch (error) {
      setValidation((error as Error).message);
    }
  };
  const input = (() => {
    try {
      return makeInput();
    } catch {
      return undefined;
    }
  })();
  const isChecked = Boolean(
    input && JSON.stringify(input) === checkedSignature,
  );
  const working = busy || inspect.isPending || check.isPending;
  const titles = [
    "Bạn muốn lấy dữ liệu nào?",
    "Dữ liệu sẽ được đưa tới đâu?",
    "Xem lại trước khi lưu",
  ];
  return (
    <form
      className="source-wizard"
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 2 && isChecked && input) onSubmit(input);
      }}
    >
      <ol className="source-wizard-steps" aria-label="Các bước đăng ký nguồn">
        {["Chọn dữ liệu", "Chọn nơi nhận", "Kiểm tra và lưu"].map(
          (label, index) => (
            <li
              key={label}
              aria-current={step === index ? "step" : undefined}
              className={
                step === index ? "current" : step > index ? "complete" : ""
              }
            >
              <span>{step > index ? <Check size={16} /> : index + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      <div className="source-wizard-body">
        <h3 ref={heading} tabIndex={-1}>
          {titles[step]}
        </h3>
        {contexts.isLoading && <p role="status">Đang tải nguồn đã lưu…</p>}
        {contexts.error && (
          <ErrorState
            error={contexts.error}
            retry={() => void contexts.refetch()}
          />
        )}
        {validation && <Notice tone="error">{validation}</Notice>}
        {error != null && <ErrorState error={error} />}
        <fieldset
          disabled={working || contexts.isLoading || Boolean(contexts.error)}
        >
          {step === 0 && (
            <>
              <p className="source-wizard-help">
                Chọn bảng từ một kết nối có sẵn. Ứng dụng sẽ đọc thử dữ liệu và
                tự nhận diện các cột; bạn không cần nhập từng cột hay viết SQL.
              </p>
              <div className="form-grid">
                <AsyncSelect
                  label="Kết nối nguồn"
                  value={sourceWarehouse}
                  disabled={working}
                  load={loadWarehouses}
                  getId={(item) => item.warehouseId}
                  getLabel={(item) =>
                    `${item.name} · ${engineLabel[item.engine]}`
                  }
                  cacheKey="source-wizard-origins"
                  onSelect={(item) => {
                    if (item.warehouseId === sourceWarehouse?.warehouseId)
                      return;
                    invalidateSource();
                    setSourceWarehouse(item);
                    setSourceDataset(undefined);
                    setSourceTable(undefined);
                    setSelectedColumns([]);
                    setSql("");
                  }}
                />
                <AsyncSelect
                  label="Dataset nguồn"
                  value={sourceDataset}
                  disabled={!sourceWarehouse || working}
                  load={loadDatasets(sourceWarehouse)}
                  getId={(item) => item.datasetId}
                  getLabel={(item) => item.name}
                  cacheKey={`source-wizard-datasets/${sourceWarehouse?.warehouseId}`}
                  onSelect={(item) => {
                    if (item.datasetId === sourceDataset?.datasetId) return;
                    invalidateSource();
                    setSourceDataset(item);
                    setSourceTable(undefined);
                    setSelectedColumns([]);
                    setSql("");
                  }}
                />
              </div>
              <p className="source-wizard-help">
                Dataset giới hạn những bảng được phép đọc. Chưa có kết nối?{" "}
                <Link to="/warehouses">Thêm kết nối warehouse</Link> trước khi
                đăng ký nguồn.
              </p>
              <div
                className="source-mode-picker"
                role="group"
                aria-label="Cách chọn dữ liệu nguồn"
              >
                <Button
                  variant={mode === "table" ? "primary" : "secondary"}
                  aria-pressed={mode === "table"}
                  onClick={() => {
                    invalidateSource();
                    setMode("table");
                  }}
                >
                  Chọn bảng có sẵn
                </Button>
                <Button
                  variant={mode === "sql" ? "primary" : "secondary"}
                  aria-pressed={mode === "sql"}
                  onClick={() => {
                    invalidateSource();
                    setMode("sql");
                  }}
                >
                  Dùng SQL nâng cao
                </Button>
              </div>
              {mode === "table" ? (
                <>
                  <AsyncSelect
                    label="Bảng cần lấy dữ liệu"
                    value={sourceTable}
                    disabled={!sourceDataset || working}
                    cacheKey={`source-wizard-tables/${sourceDataset?.datasetId}`}
                    load={(params, signal) =>
                      catalogApi.tables(
                        sourceDataset!.datasetId,
                        params,
                        signal,
                      )
                    }
                    getId={(item) => item.tableId}
                    getLabel={tableName}
                    onSelect={(item) => {
                      invalidateSource();
                      setSourceTable(item);
                      setSelectedColumns(
                        item.columns.map((column) => column.name),
                      );
                    }}
                  />
                  {sourceTable && (
                    <details className="source-advanced">
                      <summary>
                        Chọn cột cần lấy ({selectedColumns.length}/
                        {sourceTable.columns.length})
                      </summary>
                      <div className="source-column-picker">
                        {sourceTable.columns.map((column) => (
                          <label key={column.name}>
                            <input
                              type="checkbox"
                              checked={selectedColumns.includes(column.name)}
                              onChange={(event) => {
                                invalidateSource();
                                setSelectedColumns((current) =>
                                  event.target.checked
                                    ? sourceTable.columns
                                        .filter(
                                          (item) =>
                                            item.name === column.name ||
                                            current.includes(item.name),
                                        )
                                        .map((item) => item.name)
                                    : current.filter(
                                        (name) => name !== column.name,
                                      ),
                                );
                              }}
                            />
                            <span>
                              {column.name}
                              <small>{column.dataType}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                  {selectedColumns.length > 100 && (
                    <Notice tone="warning">
                      Chọn tối đa 100 cột cho mỗi nguồn.
                    </Notice>
                  )}
                </>
              ) : (
                <Field
                  label="SELECT nguồn"
                  hint="Dùng khi cần lọc, tổng hợp hoặc ghép bảng. Chỉ cho phép đọc các bảng trong dataset nguồn."
                >
                  <textarea
                    aria-label="SELECT nguồn"
                    required
                    rows={6}
                    maxLength={100000}
                    value={sql}
                    onChange={(event) => {
                      invalidateSource();
                      setSql(event.target.value);
                    }}
                  />
                </Field>
              )}
              {inspect.error && <ErrorState error={inspect.error} />}
              <Notice>
                Đọc thử tối đa 20 dòng, không thay đổi dữ liệu nguồn. Sau đó bạn
                sẽ chọn nơi nhận và kiểm tra trước khi lưu.
              </Notice>
            </>
          )}
          {step === 1 && (
            <>
              <div className="source-preview-summary">
                <Database size={20} />
                <span>
                  <strong>
                    {sourceTable && mode === "table"
                      ? tableName(sourceTable)
                      : "SELECT đã kiểm tra"}
                  </strong>
                  <small>
                    {preview?.columns.length} cột · {preview?.rows.length} dòng
                    xem trước{preview?.truncated ? " · nguồn còn dữ liệu" : ""}
                  </small>
                </span>
              </div>
              <details className="source-advanced">
                <summary>Xem dữ liệu và các cột đã nhận diện</summary>
                {preview && <SourcePreviewTable preview={preview} />}
              </details>
              <Field
                label="Tên nguồn"
                hint="Đặt tên dễ nhận biết để chọn lại mỗi lần nạp dữ liệu."
              >
                <input
                  required
                  maxLength={120}
                  aria-label="Tên nguồn"
                  placeholder="Nhập tên mô tả nguồn dữ liệu"
                  value={name}
                  onChange={(event) => {
                    invalidate();
                    setName(event.target.value);
                  }}
                />
              </Field>
              <div className="form-grid">
                <AsyncSelect
                  label="Kết nối đích"
                  value={targetWarehouse}
                  disabled={working}
                  load={loadWarehouses}
                  getId={(item) => item.warehouseId}
                  getLabel={(item) =>
                    `${item.name} · ${engineLabel[item.engine]}`
                  }
                  cacheKey="source-wizard-destinations"
                  onSelect={(item) => {
                    if (item.warehouseId === targetWarehouse?.warehouseId)
                      return;
                    invalidate();
                    setTargetWarehouse(item);
                    setTargetDataset(undefined);
                    setTargets({});
                  }}
                />
                <AsyncSelect
                  label="Dataset đích"
                  value={targetDataset}
                  disabled={!targetWarehouse || working}
                  load={loadDatasets(targetWarehouse)}
                  getId={(item) => item.datasetId}
                  getLabel={(item) => item.name}
                  cacheKey={`source-wizard-target-datasets/${targetWarehouse?.warehouseId}`}
                  onSelect={(item) => {
                    if (item.datasetId === targetDataset?.datasetId) return;
                    invalidate();
                    setTargetDataset(item);
                    setTargets({});
                  }}
                />
              </div>
              <Notice>
                Luồng này ghi vào bốn bảng đã được chuẩn bị sẵn. Mỗi bảng cần
                cùng tên và kiểu cột với dữ liệu nguồn, được tài khoản nạp cấp
                quyền ghi. Ứng dụng sẽ kiểm tra trước khi lưu.
              </Notice>
              <div className="source-target-path">
                {layers.map((layer, index) => (
                  <section key={layer.key} className="source-target-step">
                    <div className="source-target-description">
                      <span className="source-step-number">{index + 1}</span>
                      <div>
                        <h4>
                          {layer.label}
                          <small>{layer.technical}</small>
                        </h4>
                        <p>{layer.description}</p>
                      </div>
                    </div>
                    <AsyncSelect<Target>
                      label={`Bảng ${layer.technical}`}
                      value={targets[layer.key]}
                      disabled={!targetDataset || working}
                      getId={tableName}
                      getLabel={tableName}
                      cacheKey={`source-wizard-target-tables/${targetWarehouse?.warehouseId}/${targetDataset?.datasetId}/${layer.key}`}
                      load={(params, signal) =>
                        ingestionApi.sourceTargets(
                          {
                            ...params,
                            warehouseId: targetWarehouse?.warehouseId,
                            datasetId: targetDataset?.datasetId,
                          },
                          signal,
                        )
                      }
                      onSelect={(item) => {
                        invalidate();
                        setTargets((current) => ({
                          ...current,
                          [layer.key]: { schema: item.schema, name: item.name },
                        }));
                      }}
                    />
                  </section>
                ))}
              </div>
              <p className="source-wizard-help">
                Chưa có bảng đích? Nhờ quản trị viên chuẩn bị bảng và quyền ghi.
                Nếu muốn tạo bảng mới từ file, dùng tab{" "}
                <strong>Nạp file</strong>.
              </p>
              <details className="source-advanced">
                <summary>
                  Tùy chọn nâng cao: chất lượng dữ liệu và giới hạn
                </summary>
                <p>
                  Cột và kiểu dữ liệu được nhận diện tự động. Các quy tắc dưới
                  đây áp dụng khi kiểm tra và nạp.
                </p>
                <div className="source-rule-list">
                  {preview?.columns.map((column) => (
                    <div key={column.name} className="source-rule-row">
                      <span>
                        <strong>{column.name}</strong>
                        <small>{preview.columnTypes[column.name]}</small>
                      </span>
                      <label>
                        <input
                          type="checkbox"
                          checked={rules[column.name]?.required || false}
                          onChange={(event) => {
                            invalidate();
                            setRules((current) => ({
                              ...current,
                              [column.name]: {
                                ...current[column.name],
                                required: event.target.checked,
                              },
                            }));
                          }}
                        />{" "}
                        Không được trống
                      </label>
                      {preview.columnTypes[column.name] === "STRING" && (
                        <Field label={`Độ dài tối đa ${column.name}`}>
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            placeholder="Không giới hạn thêm"
                            value={rules[column.name]?.maxLength || ""}
                            onChange={(event) => {
                              invalidate();
                              setRules((current) => ({
                                ...current,
                                [column.name]: {
                                  ...current[column.name],
                                  maxLength: event.target.value,
                                },
                              }));
                            }}
                          />
                        </Field>
                      )}
                    </div>
                  ))}
                </div>
                <div className="form-grid">
                  {(
                    [
                      {
                        key: "maxRows",
                        label: "Số dòng tối đa mỗi lần nạp",
                        min: 1,
                        max: 10000,
                      },
                      {
                        key: "timeoutSeconds",
                        label: "Thời gian chờ tối đa (giây)",
                        min: 1,
                        max: 60,
                      },
                      {
                        key: "maxBytes",
                        label: "Dung lượng tối đa (byte)",
                        min: 1024,
                        max: 52428800,
                      },
                    ] as const
                  ).map((field) => (
                    <Field key={field.key} label={field.label}>
                      <input
                        required
                        type="number"
                        min={field.min}
                        max={field.max}
                        value={limits[field.key]}
                        onChange={(event) => {
                          invalidate();
                          setLimits((current) => ({
                            ...current,
                            [field.key]: Number(event.target.value),
                          }));
                        }}
                      />
                    </Field>
                  ))}
                </div>
              </details>
            </>
          )}
          {step === 2 && (
            <>
              <Notice>
                Lưu nguồn chỉ lưu cấu hình, chưa chuyển dữ liệu. Sau khi lưu,
                chọn nguồn này rồi bấm <strong>Chạy pipeline mới</strong> để bắt
                đầu nạp.
              </Notice>
              <DetailList
                items={[
                  ["Tên nguồn", name],
                  [
                    "Lấy từ",
                    `${sourceWarehouse?.name} / ${sourceDataset?.name}`,
                  ],
                  [
                    "Đưa tới",
                    `${targetWarehouse?.name} / ${targetDataset?.name}`,
                  ],
                  [
                    "Các cột",
                    preview?.columns.map((column) => column.name).join(", "),
                  ],
                  ...layers.map(
                    (layer) =>
                      [
                        layer.label,
                        targets[layer.key]
                          ? tableName(targets[layer.key]!)
                          : "Chưa chọn",
                      ] as [string, string],
                  ),
                ]}
              />
              <details className="source-advanced">
                <summary>Xem SELECT sẽ được thực thi</summary>
                <SqlBlock sql={preview?.readSql || ""} />
              </details>
              {check.error && (
                <ErrorState error={check.error} retry={() => check.mutate()} />
              )}
              {isChecked && (
                <Notice tone="success">
                  <strong>
                    Nguồn và bốn bảng đích đã kiểm tra thành công.
                  </strong>
                  <div>
                    {check.data?.result.rowCount.toLocaleString("vi-VN")} dòng
                    đã kiểm tra · {preview?.columns.length} cột khớp. Có thể lưu
                    cấu hình.
                  </div>
                </Notice>
              )}
              <Button disabled={working} onClick={() => check.mutate()}>
                <ShieldCheck size={17} />
                {check.isPending
                  ? "Đang kiểm tra nguồn và đích…"
                  : isChecked
                    ? "Kiểm tra lại"
                    : "Kiểm tra nguồn và bảng đích"}
              </Button>
            </>
          )}
        </fieldset>
      </div>
      <footer className="source-wizard-footer">
        <span>Bước {step + 1}/3</span>
        <div className="inline-actions">
          {step > 0 && (
            <Button
              disabled={working}
              onClick={() => {
                setValidation("");
                setStep((current) => current - 1);
              }}
            >
              <ArrowLeft size={16} /> Quay lại
            </Button>
          )}
          {step === 0 && (
            <Button
              variant="primary"
              disabled={
                working ||
                !sourceDataset ||
                Boolean(contexts.error) ||
                (mode === "table"
                  ? !sourceTable ||
                    !selectedColumns.length ||
                    selectedColumns.length > 100
                  : !sql.trim())
              }
              onClick={() => inspect.mutate()}
            >
              <Eye size={17} />
              {inspect.isPending
                ? "Đang đọc dữ liệu…"
                : "Xem trước và tiếp tục"}
            </Button>
          )}
          {step === 1 && (
            <Button variant="primary" disabled={working} onClick={next}>
              Xem lại cấu hình <ArrowRight size={16} />
            </Button>
          )}
          {step === 2 && (
            <Button
              type="submit"
              variant="primary"
              disabled={working || !isChecked}
            >
              {busy ? "Đang lưu…" : "Lưu nguồn dữ liệu"}
            </Button>
          )}
        </div>
      </footer>
    </form>
  );
}

function SourcePreviewTable({ preview }: { preview: SourcePreview }) {
  return (
    <div className="source-preview-table">
      <DataGrid
        rows={preview.rows.map((data, index) => ({ data, index }))}
        rowKey={(row) => String(row.index)}
        columns={preview.columns.map((column) => ({
          key: column.name,
          label: `${column.name} · ${preview.columnTypes[column.name]}`,
          render: (row: { data: SourcePreview["rows"][number] }) =>
            row.data[column.name] === null
              ? "NULL"
              : String(row.data[column.name]),
        }))}
      />
      {!preview.rows.length && (
        <p>Bảng chưa có dòng dữ liệu; các cột được đọc từ metadata thật.</p>
      )}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BookOpen, Check, Play, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { semanticApi } from "../api/workbenchApi";
import type {
  SemanticDocument,
  SemanticSelection,
} from "../api/workbenchSchema";
import { SemanticSelectionSchema } from "../api/workbenchSchema";
import type { Dimension, Example, Metric, Relationship } from "../api/schema";
import { PageHeading } from "../components/Shell";
import {
  ApiAccess,
  Button,
  Card,
  ContextGate,
  Empty,
  ErrorState,
  Field,
  Notice,
  Resource,
} from "../components/ui";

const tableKey = (table: { schema: string; name: string }) =>
  JSON.stringify([table.schema, table.name]);
const splitList = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const sections = [
  ["metrics", "Chỉ số"],
  ["dimensions", "Chiều phân tích"],
  ["relationships", "Quan hệ"],
  ["rules", "Quy tắc nghiệp vụ"],
  ["examples", "Ví dụ SQL"],
] as const;

export function SemanticPage() {
  const context = useWarehouse();
  const document = useQuery({
    queryKey: ["semantic-document", context.datasetId],
    queryFn: ({ signal }) => semanticApi.get(context.datasetId, signal),
    enabled: context.enabled && Boolean(context.datasetId),
  });
  return (
    <ApiAccess>
      <PageHeading
        title="Ngữ nghĩa nghiệp vụ"
        description="Định nghĩa chỉ số, chiều phân tích và quan hệ từ schema thật. Kiểm tra cấu hình trước khi kích hoạt, rồi truy vấn bằng định nghĩa đã lưu."
      />
      <ContextGate>
        <Resource resource={document}>
          {(data) => (
            <SemanticWorkbench
              key={`${context.datasetId}:${data.semanticVersion}`}
              initial={data}
            />
          )}
        </Resource>
      </ContextGate>
    </ApiAccess>
  );
}

function SemanticWorkbench({ initial }: { initial: SemanticDocument }) {
  const context = useWarehouse();
  const auth = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [section, setSection] =
    useState<(typeof sections)[number][0]>("metrics");
  const [validated, setValidated] = useState("");
  const [saved, setSaved] = useState(false);
  const editable = auth.can("ADMIN");
  const signature = JSON.stringify(draft);
  const update = (value: Partial<SemanticDocument>) => {
    setDraft((current) => ({ ...current, ...value }));
    setValidated("");
    setSaved(false);
  };
  const validate = useMutation({
    mutationFn: async () => {
      const signature = JSON.stringify(draft);
      const result = await semanticApi.validate(context.datasetId, draft);
      return { signature, result };
    },
    onSuccess: ({ signature }) => setValidated(signature),
  });
  const save = useMutation({
    mutationFn: () => semanticApi.save(context.datasetId, draft),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({
        queryKey: ["semantic-document", context.datasetId],
      });
      await client.invalidateQueries({ queryKey: ["dataset"] });
      await client.invalidateQueries({
        predicate: (query) =>
          [
            "catalog",
            "catalog-tables",
            "catalog-metrics",
            "catalog-dimensions",
            "catalog-relationships",
            "catalog-examples",
            "metric",
            "dimension",
          ].includes(String(query.queryKey[0])) &&
          query.queryKey[1] === context.datasetId,
      });
      await client.invalidateQueries({
        queryKey: ["knowledge-status", context.datasetId],
      });
    },
  });
  const busy = validate.isPending || save.isPending;
  return (
    <div className="workbench-stack">
      {!editable && (
        <Notice>
          Bạn có thể xem định nghĩa đang hoạt động. Vai trò ADMIN cần thiết để
          chỉnh sửa và kích hoạt.
        </Notice>
      )}
      <Card
        title="Cấu hình đang hoạt động"
        icon={<BookOpen size={20} />}
        actions={
          <span className="version-label">{initial.semanticVersion}</span>
        }
      >
        <div className="workbench-fields">
          <Field
            label="Phiên bản ngữ nghĩa"
            hint="Đổi phiên bản khi thay đổi nội dung."
          >
            <input
              value={draft.semanticVersion}
              disabled={!editable || busy}
              maxLength={100}
              onChange={(e) => update({ semanticVersion: e.target.value })}
            />
          </Field>
          <Field label="Phiên bản schema">
            <input value={draft.schemaVersion} readOnly />
          </Field>
          <Field label="Múi giờ IANA">
            <input
              value={draft.timezone}
              disabled={!editable || busy}
              onChange={(e) => update({ timezone: e.target.value })}
            />
          </Field>
        </div>
        <p className="muted">
          {initial.tables.length} bảng trong phạm vi dataset. Schema vật lý do
          server cung cấp; định nghĩa nghiệp vụ không thay đổi dữ liệu nguồn.
        </p>
        <div
          className="workbench-tabs"
          role="tablist"
          aria-label="Định nghĩa ngữ nghĩa"
        >
          {sections.map(([key, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={section === key}
              className={section === key ? "active" : ""}
              key={key}
              onClick={() => setSection(key)}
            >
              {label}
              {key !== "rules" && <span>{draft[key].length}</span>}
            </button>
          ))}
        </div>
        <fieldset className="workbench-fieldset" disabled={!editable || busy}>
          {section === "metrics" && (
            <MetricEditor
              document={draft}
              onChange={(metrics) => update({ metrics })}
            />
          )}
          {section === "dimensions" && (
            <DimensionEditor
              document={draft}
              onChange={(dimensions) => update({ dimensions })}
            />
          )}
          {section === "relationships" && (
            <RelationshipEditor
              document={draft}
              onChange={(relationships) => update({ relationships })}
            />
          )}
          {section === "rules" && (
            <Field
              label="Quy tắc nghiệp vụ"
              hint="Mỗi dòng một quy tắc; được đưa vào ngữ cảnh AI cùng metadata."
            >
              <textarea
                rows={8}
                value={draft.businessRules.join("\n")}
                onChange={(e) =>
                  update({ businessRules: e.target.value.split("\n") })
                }
              />
            </Field>
          )}
          {section === "examples" && (
            <ExampleEditor
              document={draft}
              onChange={(examples) => update({ examples })}
            />
          )}
        </fieldset>
        <div className="workbench-footer">
          <Button
            disabled={!editable || busy}
            onClick={() => validate.mutate()}
          >
            <Check size={17} />
            {validate.isPending ? "Đang kiểm tra…" : "Kiểm tra cấu hình"}
          </Button>
          <Button
            variant="primary"
            disabled={!editable || busy || validated !== signature}
            onClick={() => save.mutate()}
          >
            <Save size={17} />
            {save.isPending ? "Đang lưu…" : "Lưu và kích hoạt"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setDraft(initial);
              setValidated("");
              setSaved(false);
            }}
          >
            Khôi phục bản đang lưu
          </Button>
        </div>
        {validate.error && <ErrorState error={validate.error} />}
        {save.error && <ErrorState error={save.error} />}{" "}
        {validated === signature && (
          <Notice tone="success">
            Cấu hình hợp lệ: {validate.data?.result.metricCount} chỉ số,{" "}
            {validate.data?.result.dimensionCount} chiều phân tích.{" "}
            {validate.data?.result.diagnostics.join(" · ")}
          </Notice>
        )}
        {saved && <Notice tone="success">Đã lưu cấu hình ngữ nghĩa.</Notice>}
      </Card>
      <StructuredQuery
        document={initial}
        onRun={async (selection) => {
          const query = await semanticApi.run(context.datasetId, selection);
          client.setQueryData(["query", query.queryId], query);
          navigate(`/query/${encodeURIComponent(query.queryId)}/overview`);
        }}
      />
    </div>
  );
}

function TableSelect({
  document,
  value,
  onChange,
  label,
}: {
  document: SemanticDocument;
  value: string;
  onChange: (table: SemanticDocument["tables"][number]) => void;
  label: string;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => {
          const table = document.tables.find(
            (t) => tableKey(t) === e.target.value,
          );
          if (table) onChange(table);
        }}
      >
        <option value="">Chọn bảng</option>
        {document.tables.map((table) => (
          <option key={tableKey(table)} value={tableKey(table)}>
            {table.schema}.{table.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function MetricEditor({
  document,
  onChange,
}: {
  document: SemanticDocument;
  onChange: (rows: Metric[]) => void;
}) {
  const change = (index: number, value: Partial<Metric>) =>
    onChange(
      document.metrics.map((item, i) =>
        i === index ? { ...item, ...value } : item,
      ),
    );
  return (
    <div className="workbench-stack">
      {!document.metrics.length && (
        <p className="muted">
          Chưa định nghĩa chỉ số. Thêm công thức tổng hợp trên bảng thực để phân
          tích.
        </p>
      )}
      {document.metrics.map((metric, index) => (
        <div className="definition-card" key={index}>
          <div className="definition-header">
            <h3>Chỉ số {index + 1}</h3>
            <Button
              variant="danger"
              aria-label={`Xóa chỉ số ${index + 1}`}
              onClick={() =>
                onChange(document.metrics.filter((_, i) => i !== index))
              }
            >
              <Trash2 size={16} />
            </Button>
          </div>
          <div className="workbench-fields">
            <Field label="Tên chỉ số">
              <input
                value={metric.name}
                onChange={(e) => change(index, { name: e.target.value })}
              />
            </Field>
            <Field label="Đơn vị">
              <input
                value={metric.unit}
                onChange={(e) => change(index, { unit: e.target.value })}
              />
            </Field>
            <Field label="Tên đồng nghĩa (phân cách dấu phẩy)">
              <input
                value={metric.synonyms.join(", ")}
                onChange={(e) =>
                  change(index, { synonyms: splitList(e.target.value) })
                }
              />
            </Field>
          </div>
          <Field label="Mô tả">
            <input
              value={metric.description}
              onChange={(e) => change(index, { description: e.target.value })}
            />
          </Field>
          <Field
            label="Biểu thức tổng hợp"
            hint="Dùng tên bảng/cột đúng schema; Java và compiler kiểm tra tham chiếu, phép tổng hợp và đường join."
          >
            <textarea
              className="code-input"
              rows={2}
              value={metric.expression}
              onChange={(e) => change(index, { expression: e.target.value })}
            />
          </Field>
          <div className="workbench-fields">
            <Field label="Bảng được tham chiếu">
              <select
                multiple
                value={metric.tableRefs.map(tableKey)}
                onChange={(e) =>
                  change(index, {
                    tableRefs: Array.from(e.target.selectedOptions)
                      .map((option) =>
                        document.tables.find(
                          (table) => tableKey(table) === option.value,
                        )!,
                      )
                      .map(({ schema, name }) => ({ schema, name })),
                  })
                }
              >
                {document.tables.map((table) => (
                  <option key={tableKey(table)} value={tableKey(table)}>
                    {table.schema}.{table.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Chiều phân tích tương thích">
              <select
                multiple
                value={metric.compatibleDimensions}
                onChange={(e) =>
                  change(index, {
                    compatibleDimensions: Array.from(
                      e.target.selectedOptions,
                    ).map((option) => option.value),
                  })
                }
              >
                {document.dimensions.map((dimension) => (
                  <option value={dimension.name} key={dimension.name}>
                    {dimension.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ))}
      <Button
        onClick={() =>
          onChange([
            ...document.metrics,
            {
              name: "",
              description: "",
              expression: "",
              unit: "",
              tableRefs: [],
              compatibleDimensions: [],
              synonyms: [],
            },
          ])
        }
      >
        <Plus size={17} />
        Thêm chỉ số
      </Button>
    </div>
  );
}
function DimensionEditor({
  document,
  onChange,
}: {
  document: SemanticDocument;
  onChange: (rows: Dimension[]) => void;
}) {
  const change = (index: number, value: Partial<Dimension>) =>
    onChange(
      document.dimensions.map((item, i) =>
        i === index ? { ...item, ...value } : item,
      ),
    );
  return (
    <div className="workbench-stack">
      {!document.dimensions.length && (
        <p className="muted">
          Chưa định nghĩa chiều phân tích. Chọn bảng và cột vật lý để tạo chiều.
        </p>
      )}
      {document.dimensions.map((dimension, index) => {
        const table = document.tables.find(
          (t) => tableKey(t) === tableKey(dimension.table),
        );
        return (
          <div className="definition-card" key={index}>
            <div className="definition-header">
              <h3>Chiều phân tích {index + 1}</h3>
              <Button
                variant="danger"
                aria-label={`Xóa chiều ${index + 1}`}
                onClick={() =>
                  onChange(document.dimensions.filter((_, i) => i !== index))
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
            <div className="workbench-fields">
              <Field label="Tên chiều">
                <input
                  value={dimension.name}
                  onChange={(e) => change(index, { name: e.target.value })}
                />
              </Field>
              <TableSelect
                document={document}
                label="Bảng nguồn"
                value={table ? tableKey(table) : ""}
                onChange={(table) =>
                  change(index, {
                    table: { schema: table.schema, name: table.name },
                    column: "",
                    dataType: "",
                  })
                }
              />
              <Field label="Cột nguồn">
                <select
                  value={dimension.column}
                  onChange={(e) =>
                    change(index, {
                      column: e.target.value,
                      dataType:
                        table?.columns.find((c) => c.name === e.target.value)
                          ?.dataType || "",
                    })
                  }
                >
                  <option value="">Chọn cột</option>
                  {table?.columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name} · {column.dataType}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Mô tả">
              <input
                value={dimension.description}
                onChange={(e) => change(index, { description: e.target.value })}
              />
            </Field>
            <Field label="Tên đồng nghĩa (phân cách dấu phẩy)">
              <input
                value={dimension.synonyms.join(", ")}
                onChange={(e) =>
                  change(index, { synonyms: splitList(e.target.value) })
                }
              />
            </Field>
          </div>
        );
      })}
      <Button
        onClick={() =>
          onChange([
            ...document.dimensions,
            {
              name: "",
              description: "",
              table: { schema: "", name: "" },
              column: "",
              dataType: "",
              synonyms: [],
            },
          ])
        }
      >
        <Plus size={17} />
        Thêm chiều phân tích
      </Button>
    </div>
  );
}
function RelationshipEditor({
  document,
  onChange,
}: {
  document: SemanticDocument;
  onChange: (rows: Relationship[]) => void;
}) {
  const change = (index: number, value: Partial<Relationship>) =>
    onChange(
      document.relationships.map((item, i) =>
        i === index ? { ...item, ...value } : item,
      ),
    );
  return (
    <div className="workbench-stack">
      <Notice>
        Chọn đúng lực lượng quan hệ. Join làm nhân bản chỉ số sẽ bị từ chối;
        server kiểm tra tính duy nhất của đầu quan hệ được khai báo.
      </Notice>
      {document.relationships.map((relationship, index) => (
        <div className="definition-card" key={index}>
          <div className="definition-header">
            <h3>Quan hệ {index + 1}</h3>
            <Button
              variant="danger"
              aria-label={`Xóa quan hệ ${index + 1}`}
              onClick={() =>
                onChange(document.relationships.filter((_, i) => i !== index))
              }
            >
              <Trash2 size={16} />
            </Button>
          </div>
          <div className="workbench-fields">
            {(["from", "to"] as const).map((side) => {
              const endpoint = relationship[side];
              const table = document.tables.find(
                (t) => tableKey(t) === tableKey(endpoint.table),
              );
              return (
                <div key={side}>
                  <TableSelect
                    document={document}
                    label={side === "from" ? "Từ bảng" : "Đến bảng"}
                    value={table ? tableKey(table) : ""}
                    onChange={(table) =>
                      change(index, {
                        [side]: {
                          table: { schema: table.schema, name: table.name },
                          column: "",
                        },
                      })
                    }
                  />
                  <Field label={side === "from" ? "Cột từ" : "Cột đến"}>
                    <select
                      value={endpoint.column}
                      onChange={(e) =>
                        change(index, {
                          [side]: { ...endpoint, column: e.target.value },
                        })
                      }
                    >
                      <option value="">Chọn cột</option>
                      {table?.columns.map((column) => (
                        <option key={column.name}>{column.name}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              );
            })}
            <Field label="Lực lượng quan hệ">
              <select
                value={relationship.cardinality}
                onChange={(e) =>
                  change(index, {
                    cardinality: e.target.value as Relationship["cardinality"],
                  })
                }
              >
                {[
                  "MANY_TO_ONE",
                  "ONE_TO_ONE",
                  "ONE_TO_MANY",
                  "MANY_TO_MANY",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ))}
      <Button
        onClick={() =>
          onChange([
            ...document.relationships,
            {
              from: { table: { schema: "", name: "" }, column: "" },
              to: { table: { schema: "", name: "" }, column: "" },
              cardinality: "MANY_TO_ONE",
            },
          ])
        }
      >
        <Plus size={17} />
        Thêm quan hệ
      </Button>
    </div>
  );
}
function ExampleEditor({
  document,
  onChange,
}: {
  document: SemanticDocument;
  onChange: (rows: Example[]) => void;
}) {
  const context = useWarehouse();
  const change = (index: number, value: Partial<Example>) =>
    onChange(
      document.examples.map((item, i) =>
        i === index ? { ...item, ...value } : item,
      ),
    );
  return (
    <div className="workbench-stack">
      {document.examples.map((example, index) => (
        <div className="definition-card" key={index}>
          <div className="definition-header">
            <h3>
              Ví dụ {index + 1} · {example.sqlDialect}
            </h3>
            <Button
              variant="danger"
              aria-label={`Xóa ví dụ ${index + 1}`}
              onClick={() =>
                onChange(document.examples.filter((_, i) => i !== index))
              }
            >
              <Trash2 size={16} />
            </Button>
          </div>
          <Field label="Câu hỏi">
            <input
              value={example.question}
              maxLength={1000}
              onChange={(e) => change(index, { question: e.target.value })}
            />
          </Field>
          <Field label="SQL chỉ đọc">
            <textarea
              className="code-input"
              rows={5}
              value={example.sql}
              onChange={(e) => change(index, { sql: e.target.value })}
            />
          </Field>
          <div className="workbench-fields">
            <Field label="Chỉ số đã chọn">
              <select
                multiple
                value={example.selectedMetrics}
                onChange={(e) =>
                  change(index, {
                    selectedMetrics: Array.from(e.target.selectedOptions).map(
                      (o) => o.value,
                    ),
                  })
                }
              >
                {document.metrics.map((metric) => (
                  <option key={metric.name}>{metric.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Chiều đã chọn">
              <select
                multiple
                value={example.selectedDimensions}
                onChange={(e) =>
                  change(index, {
                    selectedDimensions: Array.from(
                      e.target.selectedOptions,
                    ).map((o) => o.value),
                  })
                }
              >
                {document.dimensions.map((dimension) => (
                  <option key={dimension.name}>{dimension.name}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ))}
      <Button
        onClick={() =>
          onChange([
            ...document.examples,
            {
              question: "",
              sqlDialect: context.warehouse!.engine,
              sql: "",
              selectedMetrics: [],
              selectedDimensions: [],
            },
          ])
        }
      >
        <Plus size={17} />
        Thêm ví dụ SQL
      </Button>
    </div>
  );
}
function StructuredQuery({
  document,
  onRun,
}: {
  document: SemanticDocument;
  onRun: (selection: SemanticSelection) => Promise<void>;
}) {
  const auth = useAuth();
  const [selection, setSelection] = useState<SemanticSelection>({
    metrics: [],
    dimensions: [],
    filters: [],
    limit: 100,
  });
  const run = useMutation({
    mutationFn: () => onRun(SemanticSelectionSchema.parse(selection)),
  });
  const selected = selection.metrics
    .map((name) => document.metrics.find((metric) => metric.name === name))
    .filter((m): m is Metric => Boolean(m));
  const compatible = document.dimensions.filter(
    (dimension) =>
      !selected.length ||
      selected.every((metric) =>
        metric.compatibleDimensions.includes(dimension.name),
      ),
  );
  return (
    <Card title="Phân tích từ định nghĩa đang lưu" icon={<Play size={20} />}>
      <p className="muted">
        Chọn chỉ số và chiều; compiler tạo SQL từ cấu hình đã kiểm tra. Kết quả
        được đọc từ warehouse, không cần gọi model.
      </p>
      {!document.metrics.length ? (
        <Empty
          title="Chưa có chỉ số"
          description="Định nghĩa và kích hoạt ít nhất một chỉ số để dùng truy vấn nghiệp vụ."
        />
      ) : (
        <>
          <div className="workbench-fields">
            <Field label="Chỉ số (tối đa 10)">
              <select
                multiple
                value={selection.metrics}
                onChange={(e) =>
                  setSelection({
                    ...selection,
                    metrics: Array.from(e.target.selectedOptions).map(
                      (o) => o.value,
                    ),
                    dimensions: [],
                    filters: [],
                  })
                }
              >
                {document.metrics.map((metric) => (
                  <option key={metric.name}>{metric.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Chiều tương thích (tối đa 5)">
              <select
                multiple
                value={selection.dimensions}
                onChange={(e) =>
                  setSelection({
                    ...selection,
                    dimensions: Array.from(e.target.selectedOptions).map(
                      (o) => o.value,
                    ),
                  })
                }
              >
                {compatible.map((dimension) => (
                  <option key={dimension.name}>{dimension.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Giới hạn số dòng">
              <input
                type="number"
                min={1}
                max={1000}
                value={selection.limit}
                onChange={(e) =>
                  setSelection({ ...selection, limit: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          {selection.filters.map((filter, index) => (
            <div className="workbench-fields definition-card" key={index}>
              <Field label="Chiều lọc">
                <select
                  value={filter.dimension}
                  onChange={(e) =>
                    setSelection({
                      ...selection,
                      filters: selection.filters.map((f, i) =>
                        i === index ? { ...f, dimension: e.target.value } : f,
                      ),
                    })
                  }
                >
                  <option value="">Chọn chiều</option>
                  {compatible.map((dimension) => (
                    <option key={dimension.name}>{dimension.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Điều kiện">
                <select
                  value={filter.operator}
                  onChange={(e) =>
                    setSelection({
                      ...selection,
                      filters: selection.filters.map((f, i) =>
                        i === index
                          ? {
                              ...f,
                              operator: e.target
                                .value as typeof filter.operator,
                            }
                          : f,
                      ),
                    })
                  }
                >
                  {[
                    "EQ",
                    "NE",
                    "GT",
                    "GTE",
                    "LT",
                    "LTE",
                    "CONTAINS",
                    "IS_NULL",
                    "IS_NOT_NULL",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              {!["IS_NULL", "IS_NOT_NULL"].includes(filter.operator) && (
                <Field label="Giá trị">
                  <input
                    value={String(filter.value ?? "")}
                    onChange={(e) =>
                      setSelection({
                        ...selection,
                        filters: selection.filters.map((f, i) =>
                          i === index ? { ...f, value: e.target.value } : f,
                        ),
                      })
                    }
                  />
                </Field>
              )}
              <Button
                aria-label={`Xóa bộ lọc ${index + 1}`}
                onClick={() =>
                  setSelection({
                    ...selection,
                    filters: selection.filters.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          <div className="workbench-footer">
            <Button
              disabled={selection.filters.length >= 10 || run.isPending}
              onClick={() =>
                setSelection({
                  ...selection,
                  filters: [
                    ...selection.filters,
                    { dimension: "", operator: "EQ", value: "" },
                  ],
                })
              }
            >
              <Plus size={16} />
              Thêm bộ lọc
            </Button>
            <Button
              variant="primary"
              disabled={
                !auth.can("ANALYST") ||
                !selection.metrics.length ||
                run.isPending
              }
              onClick={() => run.mutate()}
            >
              <Play size={16} />
              {run.isPending ? "Đang phân tích…" : "Chạy phân tích"}
            </Button>
          </div>
          {run.error && <ErrorState error={run.error} />}
        </>
      )}
    </Card>
  );
}

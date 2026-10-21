import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { catalogApi } from "../api/catalogApi";
import {
  QualityRuleSchema,
  type QualityRule,
  type QualityType,
} from "../api/qualitySchema";
import type { TableMetadata } from "../api/schema";
import { AsyncSelect, Button, ErrorState, Field, Notice } from "./ui";

export const qualityTypeLabel: Record<QualityType, string> = {
  NOT_NULL: "Không được trống",
  UNIQUE: "Không trùng giá trị",
  RANGE: "Khoảng số hợp lệ",
  ACCEPTED_VALUES: "Danh sách giá trị cho phép",
  ROW_COUNT: "Số dòng trong bảng",
  REFERENCE: "Tham chiếu tồn tại",
};
export const qualityTypeHelp: Record<QualityType, string> = {
  NOT_NULL: "Đếm mọi dòng có giá trị NULL trong cột.",
  UNIQUE:
    "Bỏ qua NULL. Đếm số bản ghi trùng thừa, không phải tất cả thành viên trong nhóm trùng.",
  RANGE:
    "Giới hạn dưới và trên đều bao gồm giá trị biên. NULL được bỏ qua; dùng quy tắc không trống nếu cần.",
  ACCEPTED_VALUES:
    "Bỏ qua NULL. So sánh theo collation của database; chữ hoa/thường có thể khác giữa các engine.",
  ROW_COUNT:
    "Kiểm tra tổng số dòng của toàn bảng. Nếu ngoài khoảng, ghi một lần kiểm tra vi phạm, không phải số dòng lỗi.",
  REFERENCE:
    "Bỏ qua NULL. Mỗi dòng nguồn phải có giá trị tương ứng trong cột tham chiếu; bảng đích trùng không nhân số lỗi.",
};
type Ref = { schema: string; name: string };
const same = (a: Ref, b: Ref) => a.schema === b.schema && a.name === b.name;
const tableKey = (table: Ref) => JSON.stringify([table.schema, table.name]);
const isNumeric = (type: string) =>
  ["INTEGER", "BIGINT", "DECIMAL", "FLOAT"].includes(type);
const comparable = (type: string) =>
  isNumeric(type) ||
  ["STRING", "BOOLEAN", "DATE", "TIME", "TIMESTAMP"].includes(type);

export function QualityRuleEditor({
  datasetId,
  rule,
  existingIds,
  onApply,
  onCancel,
}: {
  datasetId: string;
  rule?: QualityRule;
  existingIds: string[];
  onApply: (rule: QualityRule) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(rule?.name || "");
  const [ruleId] = useState(rule?.ruleId || `rule-${crypto.randomUUID()}`);
  const [type, setType] = useState<QualityType>(rule?.type || "NOT_NULL");
  const [table, setTable] = useState<Ref | undefined>(rule?.table);
  const [column, setColumn] = useState(
    rule && "column" in rule ? rule.column : "",
  );
  const [referenceTable, setReferenceTable] = useState<Ref | undefined>(
    rule?.type === "REFERENCE" ? rule.referenceTable : undefined,
  );
  const [referenceColumn, setReferenceColumn] = useState(
    rule?.type === "REFERENCE" ? rule.referenceColumn : "",
  );
  const [min, setMin] = useState(rule && "min" in rule ? rule.min || "" : "");
  const [max, setMax] = useState(rule && "max" in rule ? rule.max || "" : "");
  const [values, setValues] = useState(
    rule?.type === "ACCEPTED_VALUES" ? rule.values.join("\n") : "",
  );
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [error, setError] = useState("");
  const metadata = useQualityTable(datasetId, table);
  const referenceMetadata = useQualityTable(datasetId, referenceTable);
  const columns = (metadata.data?.columns || []).filter(
    (item) =>
      type === "NOT_NULL" ||
      (type === "RANGE"
        ? isNumeric(item.dataType)
        : type === "ACCEPTED_VALUES"
          ? item.dataType === "STRING"
          : comparable(item.dataType)),
  );
  const sourceType = columns.find((item) => item.name === column)?.dataType;
  const referenceColumns = (referenceMetadata.data?.columns || []).filter(
    (item) =>
      comparable(item.dataType) &&
      (isNumeric(sourceType || "")
        ? isNumeric(item.dataType)
        : item.dataType === sourceType),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!table || !metadata.data) {
      setError("Chọn bảng từ metadata hiện tại trước khi áp dụng.");
      return;
    }
    const candidate = {
      ruleId,
      name,
      type,
      table,
      enabled,
      ...(type !== "ROW_COUNT" ? { column } : {}),
      ...(["RANGE", "ROW_COUNT"].includes(type)
        ? { ...(min ? { min } : {}), ...(max ? { max } : {}) }
        : {}),
      ...(type === "ACCEPTED_VALUES" ? { values: values.split("\n") } : {}),
      ...(type === "REFERENCE" ? { referenceTable, referenceColumn } : {}),
    };
    const parsed = QualityRuleSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Kiểm tra lại quy tắc.");
      return;
    }
    if (existingIds.includes(ruleId)) {
      setError("Mã quy tắc đã tồn tại.");
      return;
    }
    if (
      !metadata.data ||
      !metadata.data.queryable ||
      (type !== "ROW_COUNT" && !columns.some((item) => item.name === column))
    ) {
      setError("Chọn bảng và cột hợp lệ từ metadata hiện tại.");
      return;
    }
    if (
      type === "REFERENCE" &&
      (!referenceMetadata.data?.queryable ||
        !referenceColumns.some((item) => item.name === referenceColumn))
    ) {
      setError("Chọn bảng và cột tham chiếu có kiểu tương thích.");
      return;
    }
    onApply(parsed.data);
  }
  const changeType = (next: QualityType) => {
    setType(next);
    setColumn("");
    setReferenceTable(undefined);
    setReferenceColumn("");
    setMin("");
    setMax("");
    setError("");
  };
  return (
    <form className="quality-rule-form" onSubmit={submit}>
      <div className="quality-form-grid">
        <Field label="Tên quy tắc">
          <input
            aria-label="Tên quy tắc"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Loại kiểm tra">
          <select
            aria-label="Loại kiểm tra"
            value={type}
            onChange={(event) => changeType(event.target.value as QualityType)}
          >
            {Object.entries(qualityTypeLabel).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Notice>{qualityTypeHelp[type]}</Notice>
      <div className="quality-form-grid">
        <TableSelector
          datasetId={datasetId}
          label="Bảng cần kiểm tra"
          value={metadata.data}
          onSelect={(item) => {
            setTable({ schema: item.schema, name: item.name });
            setColumn("");
            setReferenceColumn("");
          }}
        />
        {type !== "ROW_COUNT" && (
          <Field label="Cột cần kiểm tra">
            <select
              aria-label="Cột cần kiểm tra"
              required
              value={column}
              disabled={!metadata.data || metadata.isFetching}
              onChange={(event) => {
                setColumn(event.target.value);
                setReferenceColumn("");
              }}
            >
              <option value="">Chọn cột phù hợp</option>
              {columns.map((item) => (
                <option value={item.name} key={item.name}>
                  {item.name} · {item.dataType}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {metadata.error && (
        <ErrorState
          error={metadata.error}
          retry={() => void metadata.refetch()}
        />
      )}
      {table && metadata.data && !columns.length && type !== "ROW_COUNT" && (
        <Notice tone="warning">
          Bảng này không có cột với kiểu phù hợp cho loại kiểm tra đã chọn.
        </Notice>
      )}
      {["RANGE", "ROW_COUNT"].includes(type) && (
        <div className="quality-form-grid">
          <Field
            label="Giới hạn dưới (bao gồm)"
            hint={
              type === "ROW_COUNT"
                ? "Số nguyên không âm; để trống nếu không giới hạn."
                : "Số thập phân, dùng dấu chấm; để trống nếu không giới hạn."
            }
          >
            <input
              aria-label="Giới hạn dưới"
              inputMode={type === "ROW_COUNT" ? "numeric" : "decimal"}
              maxLength={100}
              value={min}
              onChange={(event) => setMin(event.target.value)}
            />
          </Field>
          <Field label="Giới hạn trên (bao gồm)">
            <input
              aria-label="Giới hạn trên"
              inputMode={type === "ROW_COUNT" ? "numeric" : "decimal"}
              maxLength={100}
              value={max}
              onChange={(event) => setMax(event.target.value)}
            />
          </Field>
        </div>
      )}
      {type === "ACCEPTED_VALUES" && (
        <Field
          label="Giá trị cho phép"
          hint="Mỗi dòng là một giá trị nguyên vẹn, tối đa 50 giá trị. Dòng trống cho phép chuỗi rỗng; không tự cắt khoảng trắng."
        >
          <textarea
            aria-label="Giá trị cho phép"
            rows={5}
            value={values}
            onChange={(event) => setValues(event.target.value)}
          />
        </Field>
      )}
      {type === "REFERENCE" && (
        <div className="quality-form-grid">
          <TableSelector
            datasetId={datasetId}
            label="Bảng tham chiếu"
            value={referenceMetadata.data}
            onSelect={(item) => {
              setReferenceTable({ schema: item.schema, name: item.name });
              setReferenceColumn("");
            }}
          />
          <Field label="Cột tham chiếu">
            <select
              aria-label="Cột tham chiếu"
              required
              value={referenceColumn}
              disabled={
                !column ||
                !referenceMetadata.data ||
                referenceMetadata.isFetching
              }
              onChange={(event) => setReferenceColumn(event.target.value)}
            >
              <option value="">Chọn cột tương thích</option>
              {referenceColumns.map((item) => (
                <option value={item.name} key={item.name}>
                  {item.name} · {item.dataType}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {referenceMetadata.error && type === "REFERENCE" && (
        <ErrorState
          error={referenceMetadata.error}
          retry={() => void referenceMetadata.refetch()}
        />
      )}
      <label className="quality-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Bật quy tắc khi chạy kiểm tra
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <small className="muted">
        Quy tắc chỉ dùng metadata đã được cấp quyền. Java kiểm tra lại kiểu dữ
        liệu, phạm vi bảng/cột và phiên bản trước khi lưu hoặc chạy.
      </small>
      <div className="quality-actions">
        <Button onClick={onCancel}>Hủy</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={
            metadata.isFetching ||
            (type === "REFERENCE" && referenceMetadata.isFetching)
          }
        >
          <Save size={17} />
          Áp dụng vào bản nháp
        </Button>
      </div>
    </form>
  );
}
function TableSelector({
  datasetId,
  label,
  value,
  onSelect,
}: {
  datasetId: string;
  label: string;
  value?: TableMetadata;
  onSelect: (table: TableMetadata) => void;
}) {
  return (
    <AsyncSelect
      label={label}
      cacheKey={`${datasetId}/quality`}
      value={value}
      onSelect={onSelect}
      load={async (params, signal) => {
        const result = await catalogApi.tables(
          datasetId,
          { ...params, queryable: true },
          signal,
        );
        return {
          ...result,
          items: result.items.filter((item) => item.queryable),
        };
      }}
      getId={tableKey}
      getLabel={(item) => `${item.schema}.${item.name}`}
    />
  );
}
function useQualityTable(datasetId: string, table?: Ref) {
  return useQuery({
    queryKey: ["quality-table", datasetId, table?.schema, table?.name],
    queryFn: async ({ signal }) => {
      const result = await catalogApi.tables(
        datasetId,
        {
          search: `${table!.schema}.${table!.name}`,
          page: 1,
          pageSize: 100,
          queryable: true,
        },
        signal,
      );
      const match = result.items.find((item) => same(item, table!));
      if (!match)
        throw new Error(
          "Bảng không còn trong metadata được phép. Chọn lại bảng hoặc làm mới catalog.",
        );
      return match;
    },
    enabled: Boolean(table),
  });
}

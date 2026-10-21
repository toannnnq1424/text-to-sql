import { z } from "zod";
import { EngineSchema, ErrorBodySchema, pageSchema } from "./schema";

const identifier = z.string().min(1).max(256);
const table = z.strictObject({ schema: identifier, name: identifier });
const base = {
  ruleId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  name: z.string().trim().min(1, "Nhập tên quy tắc.").max(120),
  table,
  enabled: z.boolean(),
};
const decimal = z
  .string()
  .max(100)
  .regex(
    /^-?\d+(?:\.\d+)?$/,
    "Nhập số thập phân dùng dấu chấm, không dùng số mũ.",
  )
  .refine((value) => {
    const digits = value.replace(/[-.]/g, "").replace(/^0+/, "") || "0";
    return digits.length <= 38 && (value.split(".")[1]?.length || 0) <= 18;
  }, "Số phải có tối đa 38 chữ số và 18 chữ số thập phân.");
const integer = z
  .string()
  .regex(/^\d+$/, "Số dòng phải là số nguyên không âm.")
  .max(100)
  .refine(
    (value) =>
      value.length <= 100 &&
      /^\d+$/.test(value) &&
      BigInt(value) <= 9223372036854775807n,
    "Vượt giới hạn BIGINT.",
  );
export function compareQualityBounds(left: string, right: string) {
  const scale = Math.max(
    left.split(".")[1]?.length || 0,
    right.split(".")[1]?.length || 0,
  );
  const scaled = (value: string) => {
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const result = BigInt(whole + fraction.padEnd(scale, "0"));
    return value.startsWith("-") ? -result : result;
  };
  const a = scaled(left);
  const b = scaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
export const QualityRuleSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...base,
      type: z.literal("NOT_NULL"),
      column: identifier,
    }),
    z.strictObject({ ...base, type: z.literal("UNIQUE"), column: identifier }),
    z.strictObject({
      ...base,
      type: z.literal("RANGE"),
      column: identifier,
      min: decimal.optional(),
      max: decimal.optional(),
    }),
    z.strictObject({
      ...base,
      type: z.literal("ACCEPTED_VALUES"),
      column: identifier,
      values: z.array(z.string().max(256)).min(1).max(50),
    }),
    z.strictObject({
      ...base,
      type: z.literal("ROW_COUNT"),
      min: integer.optional(),
      max: integer.optional(),
    }),
    z.strictObject({
      ...base,
      type: z.literal("REFERENCE"),
      column: identifier,
      referenceTable: table,
      referenceColumn: identifier,
    }),
  ])
  .superRefine((rule, ctx) => {
    if (rule.type === "RANGE" || rule.type === "ROW_COUNT") {
      if (rule.min === undefined && rule.max === undefined)
        ctx.addIssue({
          code: "custom",
          message: "Nhập ít nhất một giới hạn.",
          path: ["min"],
        });
      if (
        rule.min !== undefined &&
        rule.max !== undefined &&
        /^-?\d+(?:\.\d+)?$/.test(rule.min) &&
        /^-?\d+(?:\.\d+)?$/.test(rule.max) &&
        compareQualityBounds(rule.min, rule.max) > 0
      )
        ctx.addIssue({
          code: "custom",
          message: "Giới hạn dưới không được lớn hơn giới hạn trên.",
          path: ["max"],
        });
    }
    if (
      rule.type === "ACCEPTED_VALUES" &&
      new Set(rule.values).size !== rule.values.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Các giá trị cho phép phải khác nhau.",
        path: ["values"],
      });
  });
export type QualityRule = z.infer<typeof QualityRuleSchema>;
export type QualityType = QualityRule["type"];
const rules = z
  .array(QualityRuleSchema)
  .max(20)
  .superRefine((items, ctx) => {
    if (new Set(items.map((item) => item.ruleId)).size !== items.length)
      ctx.addIssue({ code: "custom", message: "Mã quy tắc phải duy nhất." });
  });
export const QualityRulesInputSchema = z.strictObject({
  revision: z.string().regex(/^\d+$/),
  rules,
});
export const QualityRulesSchema = z.object({
  datasetId: identifier,
  revision: z.string().regex(/^\d+$/),
  rules,
});
export type QualityRules = z.infer<typeof QualityRulesSchema>;
const count = z.string().regex(/^\d+$/);
export const QualityCheckSchema = z.object({
  ruleId: identifier,
  name: z.string(),
  type: z.enum([
    "NOT_NULL",
    "UNIQUE",
    "RANGE",
    "ACCEPTED_VALUES",
    "ROW_COUNT",
    "REFERENCE",
  ]),
  table,
  column: identifier.optional(),
  status: z.enum(["PASSED", "FAILED", "ERROR"]),
  checkedRows: count.nullable(),
  violations: count.nullable(),
  observedValue: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  error: ErrorBodySchema.nullable(),
});
export type QualityCheck = z.infer<typeof QualityCheckSchema>;
export const QualityRunSchema = z.object({
  runId: identifier,
  datasetId: identifier,
  warehouseId: identifier,
  sqlDialect: EngineSchema,
  revision: z.string().regex(/^\d+$/),
  status: z.enum(["RUNNING", "PASSED", "FAILED", "ERROR"]),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  correlationId: z.string(),
  consistency: z.literal("PER_CHECK"),
  rules,
  checks: z.array(QualityCheckSchema).max(20),
  error: ErrorBodySchema.nullable(),
});
export type QualityRun = z.infer<typeof QualityRunSchema>;
export const QualityRunPageSchema = pageSchema(QualityRunSchema);
export const QualityRunInputSchema = z.strictObject({});

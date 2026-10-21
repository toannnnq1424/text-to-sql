import { describe, expect, it } from "vitest";
import {
  QualityRuleSchema,
  QualityRulesInputSchema,
  QualityRunSchema,
  compareQualityBounds,
} from "./qualitySchema";
import { qualityRule, qualityRun } from "../test/qualityFixtures";
const common = {
  ruleId: "rule",
  name: "Read-only validation",
  table: { schema: "analytics", name: "observations" },
  enabled: true,
};
describe("data quality contract", () => {
  it.each([
    { type: "NOT_NULL", column: "amount" },
    { type: "UNIQUE", column: "row_id" },
    {
      type: "RANGE",
      column: "amount",
      min: "-10.25",
      max: "12345678901234567890.123456789012345678",
    },
    { type: "ROW_COUNT", min: "0", max: "9223372036854775807" },
    { type: "ACCEPTED_VALUES", column: "category", values: ["", "a", " a "] },
    {
      type: "REFERENCE",
      column: "parent_id",
      referenceTable: common.table,
      referenceColumn: "id",
    },
  ])("accepts a complete $type definition", (specific) =>
    expect(
      QualityRuleSchema.safeParse({ ...common, ...specific }).success,
    ).toBe(true),
  );
  it.each([
    { type: "ROW_COUNT", min: "-1" },
    { type: "ROW_COUNT", min: "1.1" },
    { type: "ROW_COUNT", min: "9223372036854775808" },
    { type: "ROW_COUNT", min: "not-a-number" },
    { type: "ROW_COUNT", min: "1", column: "extra" },
    { type: "RANGE", column: "amount" },
    { type: "RANGE", column: "amount", min: "1e4" },
    { type: "RANGE", column: "amount", min: "0.1234567890123456789" },
    {
      type: "RANGE",
      column: "amount",
      max: "123456789012345678901234567890123456789",
    },
    { type: "ACCEPTED_VALUES", column: "category", values: ["a", "a"] },
    { type: "REFERENCE", column: "id", referenceTable: common.table },
    { type: "NOT_NULL", column: "amount", sql: "DROP TABLE observations" },
  ])("rejects unsafe/incomplete $type input without throwing", (specific) =>
    expect(
      QualityRuleSchema.safeParse({ ...common, ...specific }).success,
    ).toBe(false),
  );
  it("orders precise decimal and integer bounds without Number rounding", () => {
    expect(compareQualityBounds("9007199254740993", "9007199254740992")).toBe(
      1,
    );
    expect(compareQualityBounds("-0.001", "0")).toBe(-1);
    expect(compareQualityBounds("-100.01", "-100.0100")).toBe(0);
    expect(
      QualityRuleSchema.safeParse({
        ...common,
        type: "ROW_COUNT",
        min: "9007199254740993",
        max: "9007199254740992",
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate rule IDs and more than20 rules", () => {
    expect(
      QualityRulesInputSchema.safeParse({
        revision: "1",
        rules: [qualityRule, qualityRule],
      }).success,
    ).toBe(false);
    expect(
      QualityRulesInputSchema.safeParse({
        revision: "1",
        rules: Array.from({ length: 21 }, (_, i) => ({
          ...qualityRule,
          ruleId: `rule-${i}`,
        })),
      }).success,
    ).toBe(false);
  });
  it("preserves BIGINT measurements as strings and requires frozen definitions", () => {
    expect(QualityRunSchema.parse(qualityRun).checks[0].checkedRows).toBe(
      "9007199254740993",
    );
    expect(
      QualityRunSchema.safeParse({ ...qualityRun, rules: undefined }).success,
    ).toBe(false);
    expect(
      QualityRunSchema.safeParse({
        ...qualityRun,
        checks: [{ ...qualityRun.checks[0], checkedRows: 9007199254740992 }],
      }).success,
    ).toBe(false);
  });
});

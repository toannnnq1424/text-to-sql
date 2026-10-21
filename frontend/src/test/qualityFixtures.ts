import type { QualityRule, QualityRun } from "../api/qualitySchema";
import { datasets, warehouses, table } from "./fixtures";
export const qualityRule: QualityRule = {
  ruleId: "required-region",
  name: "Region must be present",
  type: "NOT_NULL",
  table: { schema: table.schema, name: table.name },
  column: "region",
  enabled: true,
};
export const qualityRun: QualityRun = {
  runId: "quality-test-run",
  datasetId: datasets[0].datasetId,
  warehouseId: warehouses[0].warehouseId,
  sqlDialect: "POSTGRESQL",
  revision: "3",
  status: "FAILED",
  createdAt: "2026-10-21T00:00:00Z",
  completedAt: "2026-10-21T00:00:01Z",
  correlationId: "quality-test-correlation",
  consistency: "PER_CHECK",
  rules: [qualityRule],
  checks: [
    {
      ruleId: qualityRule.ruleId,
      name: qualityRule.name,
      type: qualityRule.type,
      table: qualityRule.table,
      column: qualityRule.column,
      status: "FAILED",
      checkedRows: "9007199254740993",
      violations: "1",
      observedValue: null,
      durationMs: 12,
      error: null,
    },
  ],
  error: null,
};

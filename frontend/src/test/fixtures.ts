import queryJson from "../../../docs/contracts/examples/query-success.json" with { type: "json" };
import whJson from "../../../docs/contracts/examples/warehouses.json" with { type: "json" };
import dsJson from "../../../docs/contracts/examples/datasets.json" with { type: "json" };
import ai from "../../../docs/contracts/examples/ai-request.json" with { type: "json" };
import {
  QuerySchema,
  WarehouseSchema,
  DatasetSchema,
  MetricSchema,
  DimensionSchema,
  TableSchema,
} from "../api/schema";
export const query = QuerySchema.parse(queryJson);
export const warehouses = whJson.items.map((w) => WarehouseSchema.parse(w));
export const datasets = dsJson.items.map((d) => DatasetSchema.parse(d));
export const page = <T>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 20,
  totalItems: items.length,
  totalPages: items.length ? 1 : 0,
});
export const metric = MetricSchema.parse({
  ...ai.semanticContext.metrics[0],
  examples: ai.semanticContext.examples,
});
export const dimension = DimensionSchema.parse(
  ai.semanticContext.dimensions[0],
);
export const table = TableSchema.parse({
  ...ai.semanticContext.tables[0],
  tableId: "table-sales",
  queryable: true,
  primaryKey: ["sale_id"],
  foreignKeys: [],
});
export const catalog = {
  datasetId: datasets[0].datasetId,
  semanticVersion: "1.0.0",
  schemaVersion: "1.0.0",
  tableCount: 1,
  metricCount: 1,
  dimensionCount: 1,
  relationshipCount: 0,
  exampleCount: 1,
  tableCategories: [{ name: "public", count: 1 }],
  metricCategories: [{ name: "Sales", count: 1 }],
  exampleCategories: [{ name: "Sales", count: 1 }],
};
export const summary = { ...query, rowCount: query.result!.returnedRowCount };
export const monitoring = {
  queryVolume: 12,
  successRate: 0.75,
  llmErrorCount: 1,
  sqlValidationRejectionCount: 2,
  timeoutCount: 1,
  avgLatencyMs: 200,
  p95LatencyMs: 800,
  queriesByEngine: [{ engine: "POSTGRESQL", count: 12 }],
  queriesByDataset: [
    { datasetId: datasets[0].datasetId, name: datasets[0].name, count: 12 },
  ],
  warehouseHealth: [
    {
      id: warehouses[0].warehouseId,
      name: warehouses[0].name,
      status: "ACTIVE",
    },
  ],
  ingestionHealth: [],
  from: "2026-10-18T17:00:00Z",
  to: "2026-10-19T17:00:00Z",
  denominator: 12,
};
export const settings = {
  locale: "vi",
  timezone: "Asia/Ho_Chi_Minh",
  defaultQueryMode: "AUTO",
  limits: {
    maxRows: 1000,
    maxBytes: 5242880,
    statementTimeoutMs: 15000,
    queryDeadlineMs: 60000,
  },
  availableModes: ["AUTO", "API", "DETERMINISTIC"],
  providerConfigured: true,
  modelDisplayName: "test-provider",
};
export const ingestion = {
  runId: "ing-001",
  batchId: "batch-001",
  warehouseId: warehouses[0].warehouseId,
  datasetId: datasets[0].datasetId,
  engine: "POSTGRESQL",
  status: "SUCCESS",
  sourceId: "source-001",
  rowsWritten: 300,
  rejectedCount: 2,
  startedAt: "2026-10-19T00:00:00Z",
  completedAt: "2026-10-19T00:00:02Z",
  durationMs: 2000,
  idempotent: true,
  steps: ["RAW", "STAGING", "WAREHOUSE", "MART"].map((stage) => ({
    stage,
    status: "SUCCESS",
    durationMs: 500,
    error: null,
  })),
  error: null,
};
export const evalRun = {
  runId: "eval-001",
  warehouseId: warehouses[0].warehouseId,
  datasetId: datasets[0].datasetId,
  engine: "POSTGRESQL",
  model: "test-provider",
  status: "SUCCESS",
  createdAt: "2026-10-19T00:00:00Z",
  completedAt: "2026-10-19T00:00:01Z",
  metrics: {
    totalCases: 40,
    completedCases: 40,
    executionSuccessRate: 0.9,
    resultEquivalenceRate: 0.8,
    invalidSqlRejectionRate: 1,
    dialectAccuracy: 1,
    avgLatencyMs: 200,
    p95LatencyMs: 800,
    denominators: { validQuestions: 30, unsafeQuestions: 10 },
  },
};
export const evalCase = {
  resultId: "case-result-001",
  caseId: "TC-001",
  runId: evalRun.runId,
  question: query.question,
  difficulty: "EASY",
  sqlDialect: "POSTGRESQL",
  status: "PASSED",
  expectedSql: query.generatedSql,
  generatedSql: query.generatedSql,
  validationResult: "VALID",
  resultEquivalent: true,
  chartMatch: true,
  latencyMs: 100,
  failureReason: null,
  actualResult: query.result,
};
export const source = {
  sourceId: "source-001",
  name: "Registered CSV source",
  type: "CSV",
  status: "ACTIVE",
  sourceWarehouseId: warehouses[0].warehouseId,
  sourceDatasetId: datasets[0].datasetId,
};
export const ingestionSource = {
  ...source,
  warehouseId: warehouses[0].warehouseId,
  datasetId: datasets[0].datasetId,
  readSql: "SELECT sale_id AS sale_id FROM analytics.fact_sales",
  raw: { schema: "analytics", name: "raw_sales" },
  stage: { schema: "analytics", name: "stage_sales" },
  warehouse: { schema: "analytics", name: "warehouse_sales" },
  mart: { schema: "analytics", name: "mart_sales" },
  columns: ["sale_id"],
  requiredColumns: ["sale_id"],
  columnTypes: { sale_id: "INTEGER" },
  maxStringLengths: {},
  maxRows: 1000,
  maxBytes: 5242880,
  timeoutSeconds: 30,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
};
export const sourceTest = {
  sourceId: source.sourceId,
  reachable: true,
  checkedAt: "2026-10-19T00:00:00Z",
  sourceEngine: "POSTGRESQL",
  targetEngine: "POSTGRESQL",
  rowCount: 20,
  truncated: false,
  columns: [
    {
      name: "sale_id",
      label: "sale_id",
      dataType: "INTEGER",
      semanticRole: "OTHER",
    },
  ],
  targets: [
    ingestionSource.raw,
    ingestionSource.stage,
    ingestionSource.warehouse,
    ingestionSource.mart,
  ],
};
export const suite = {
  suiteId: "suite-001",
  name: "Cross-domain suite",
  version: "1.0.0",
  caseCount: 40,
  engines: ["POSTGRESQL", "MYSQL", "SQL_SERVER"],
};

export const modelProviders = {
  items: [
    {
      providerId: "environment",
      revision: "test-env-revision",
      name: "Local test model",
      kind: "OLLAMA" as const,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "test-local:small",
      hasApiKey: false,
      enabled: true,
      configured: true,
      source: "ENVIRONMENT" as const,
      readOnly: true,
      updatedAt: null,
    },
  ],
  defaultProviderId: "environment",
  configurationAvailable: true,
};

import { z } from "zod";
export const EngineSchema = z.enum(["POSTGRESQL", "MYSQL", "SQL_SERVER"]);
export type Engine = z.infer<typeof EngineSchema>;
const id = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const time = z.iso.datetime({ offset: true });
const rate = z.number().min(0).max(1).nullable();
export const ErrorBodySchema = z.object({
  code: id,
  message: z.string(),
  correlationId: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
export const TableRefSchema = z.object({ schema: id, name: id });
export const WarehouseSchema = z.object({
  warehouseId: id,
  name: id,
  engine: EngineSchema,
  status: z.enum(["ACTIVE", "UNAVAILABLE", "INVALID", "DISABLED"]),
  capabilities: z.object({
    readOnlyQuery: z.boolean(),
    metadataDiscovery: z.boolean(),
  }),
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  database: z.string().optional(),
  defaultSchema: z.string().nullable().optional(),
  username: z.string().optional(),
  ingestionUsername: z.string().optional(),
  createdAt: time.optional(),
  updatedAt: time.optional(),
});
export type Warehouse = z.infer<typeof WarehouseSchema>;
export const DatasetSchema = z.object({
  datasetId: id,
  warehouseId: id,
  name: id,
  description: z.string(),
  allowedSchemas: z.array(z.string()),
  allowedTables: z.array(TableRefSchema),
  semanticVersion: id,
  schemaVersion: id,
  status: z.enum(["ACTIVE", "INVALID_SCHEMA", "DISABLED"]),
  updatedAt: time,
});
export type Dataset = z.infer<typeof DatasetSchema>;
export const ModeSchema = z.enum(["AUTO", "API", "DETERMINISTIC"]);
export type Mode = z.infer<typeof ModeSchema>;
export const QueryRequestSchema = z.strictObject({
  warehouseId: id,
  datasetId: id,
  question: z
    .string()
    .trim()
    .refine(
      (s) => Array.from(s).length > 0 && Array.from(s).length <= 1000,
      "Nhập câu hỏi từ 1 đến 1000 ký tự.",
    ),
  mode: ModeSchema.optional(),
});
export const ColumnSchema = z.object({
  name: id,
  label: z.string(),
  dataType: z.enum([
    "STRING",
    "INTEGER",
    "BIGINT",
    "DECIMAL",
    "FLOAT",
    "BOOLEAN",
    "DATE",
    "TIMESTAMP",
  ]),
  semanticRole: z.enum(["DIMENSION", "METRIC", "TIME", "OTHER"]),
  unit: z.string().optional(),
});
export type Column = z.infer<typeof ColumnSchema>;
export const CellSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const ResultSchema = z
  .object({
    columns: z.array(ColumnSchema),
    rows: z.array(z.record(z.string(), CellSchema)).max(100),
    returnedRowCount: count,
    page: count.min(1),
    pageSize: count.min(1).max(100),
    truncated: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.columns.map((c) => c.name)).size !== data.columns.length)
      ctx.addIssue({ code: "custom", message: "Duplicate column names" });
    if (
      data.rows.length > data.pageSize ||
      data.rows.length > data.returnedRowCount
    )
      ctx.addIssue({ code: "custom", message: "Invalid result pagination" });
    for (const row of data.rows)
      for (const column of data.columns) {
        const v = row[column.name];
        const valid =
          v === null ||
          (column.dataType === "BOOLEAN"
            ? typeof v === "boolean"
            : ["DECIMAL", "BIGINT"].includes(column.dataType)
              ? typeof v === "string" &&
                /^-?\d+(\.\d+)?$/.test(v) &&
                (column.dataType !== "BIGINT" || !v.includes("."))
              : ["FLOAT", "INTEGER"].includes(column.dataType)
                ? typeof v === "number" &&
                  Number.isFinite(v) &&
                  (column.dataType !== "INTEGER" || Number.isSafeInteger(v))
                : typeof v === "string");
        if (!valid)
          ctx.addIssue({
            code: "custom",
            message: `Invalid cell type: ${column.name}`,
          });
      }
  });
export type QueryResult = z.infer<typeof ResultSchema>;
export const ChartTypeSchema = z.enum([
  "table",
  "number",
  "bar",
  "grouped-bar",
  "line",
  "area",
  "pie",
]);
export type ChartType = z.infer<typeof ChartTypeSchema>;
export const ChartSchema = z.object({
  type: ChartTypeSchema,
  title: z.string(),
  x: z.string().optional(),
  series: z.array(z.object({ column: id, label: z.string() })),
  reason: z.string().optional(),
});
export type ChartSpec = z.infer<typeof ChartSchema>;
export const QueryStatusSchema = z.enum([
  "RUNNING",
  "SUCCESS",
  "REJECTED",
  "VALIDATION_ERROR",
  "QUERY_ERROR",
  "TIMEOUT",
]);
export const QuerySummarySchema = z.object({
  queryId: id,
  correlationId: id,
  warehouseId: id,
  datasetId: id,
  engine: EngineSchema,
  question: z.string(),
  status: QueryStatusSchema,
  model: z.string().nullable(),
  executionMode: z.enum(["API", "DETERMINISTIC", "SEMANTIC"]),
  semanticVersion: id,
  schemaVersion: id,
  latencyMs: count.nullable(),
  rowCount: count.nullable(),
  createdAt: time,
});
export type QuerySummary = z.infer<typeof QuerySummarySchema>;
export const QuerySchema = QuerySummarySchema.omit({ rowCount: true }).extend({
  generatedSql: z.string().nullable(),
  candidateSql: z.string().nullable().default(null),
  sqlDialect: EngineSchema,
  completedAt: time.nullable(),
  explanation: z.string().nullable(),
  assumptions: z.array(z.string()),
  selectedMetrics: z.array(z.string()),
  selectedDimensions: z.array(z.string()),
  sourceTables: z.array(TableRefSchema),
  result: ResultSchema.nullable(),
  chart: z
    .unknown()
    .nullable()
    .transform((v) =>
      ChartSchema.safeParse(v).success ? ChartSchema.parse(v) : null,
    ),
  error: ErrorBodySchema.nullable(),
});
export type Query = z.infer<typeof QuerySchema>;
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item).max(100),
    page: count.min(1),
    pageSize: count.min(1).max(100),
    totalItems: count,
    totalPages: count,
  });
export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};
export const MetadataColumnSchema = z.object({
  name: id,
  dataType: id,
  nullable: z.boolean(),
  description: z.string(),
  synonyms: z.array(z.string()),
  primaryKey: z.boolean().optional(),
  foreignKey: z.boolean().optional(),
});
export const ExampleSchema = z.object({
  question: id,
  sqlDialect: EngineSchema,
  sql: z.string(),
  selectedMetrics: z.array(z.string()),
  selectedDimensions: z.array(z.string()),
  category: z.string().optional(),
  language: z.enum(["vi", "en"]).optional(),
});
export type Example = z.infer<typeof ExampleSchema>;
export const RelationshipSchema = z.object({
  from: z.object({ table: TableRefSchema, column: id }),
  to: z.object({ table: TableRefSchema, column: id }),
  cardinality: z.enum([
    "ONE_TO_ONE",
    "MANY_TO_ONE",
    "ONE_TO_MANY",
    "MANY_TO_MANY",
  ]),
});
export type Relationship = z.infer<typeof RelationshipSchema>;
export const TableSchema = TableRefSchema.extend({
  tableId: id,
  logicalName: id,
  description: z.string(),
  grain: z.string(),
  columns: z.array(MetadataColumnSchema),
  queryable: z.boolean(),
  category: z.string().optional(),
  status: z.string().optional(),
  primaryKey: z.array(z.string()).default([]),
  foreignKeys: z.array(RelationshipSchema).default([]),
});
export type TableMetadata = z.infer<typeof TableSchema>;
export const MetricSchema = z.object({
  name: id,
  description: z.string(),
  expression: z.string(),
  unit: z.string(),
  tableRefs: z.array(TableRefSchema),
  compatibleDimensions: z.array(z.string()),
  synonyms: z.array(z.string()),
  examples: z.array(ExampleSchema).optional(),
  category: z.string().optional(),
  dataType: z.string().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;
export const DimensionSchema = z.object({
  name: id,
  description: z.string(),
  table: TableRefSchema,
  column: id,
  dataType: id,
  synonyms: z.array(z.string()),
});
export type Dimension = z.infer<typeof DimensionSchema>;
export const CatalogSchema = z.object({
  datasetId: id,
  semanticVersion: id,
  schemaVersion: id,
  tableCount: count,
  metricCount: count,
  dimensionCount: count,
  relationshipCount: count,
  exampleCount: count,
  tableCategories: z.array(z.object({ name: id, count })),
  metricCategories: z.array(z.object({ name: id, count })),
  exampleCategories: z.array(z.object({ name: id, count })),
});
export type Catalog = z.infer<typeof CatalogSchema>;
export const SourceSchema = z.object({
  sourceId: id,
  name: id,
  type: id,
  status: z.enum(["ACTIVE", "DISABLED"]),
  sourceWarehouseId: id,
  sourceDatasetId: id,
});
export type Source = z.infer<typeof SourceSchema>;
export const SourceTargetSchema = z.strictObject({
  schema: id,
  name: id,
});
export const IngestionSourceSchema = z.object({
  ...SourceSchema.shape,
  warehouseId: id,
  datasetId: id,
  readSql: z.string(),
  raw: SourceTargetSchema,
  stage: SourceTargetSchema,
  warehouse: SourceTargetSchema,
  mart: SourceTargetSchema,
  columns: z.array(id),
  requiredColumns: z.array(id),
  columnTypes: z.record(
    id,
    z.enum(["STRING", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "TIMESTAMP"]),
  ),
  maxStringLengths: z.record(id, count),
  maxRows: count.min(1),
  maxBytes: count.min(1),
  timeoutSeconds: count.min(1),
  createdAt: time,
  updatedAt: time,
});
export type IngestionSource = z.infer<typeof IngestionSourceSchema>;
export const IngestionSourceInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    warehouseId: id,
    datasetId: id,
    sourceWarehouseId: id,
    sourceDatasetId: id,
    readSql: z.string().trim().min(1).max(100000),
    raw: SourceTargetSchema,
    stage: SourceTargetSchema,
    warehouse: SourceTargetSchema,
    mart: SourceTargetSchema,
    columns: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/))
      .min(1)
      .max(100),
    requiredColumns: z.array(id),
    columnTypes: z.record(
      id,
      z.enum(["STRING", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "TIMESTAMP"]),
    ),
    maxStringLengths: z.record(id, count.min(1).max(10000)),
    maxRows: count.min(1).max(10000),
    maxBytes: count.min(1024).max(52428800),
    timeoutSeconds: count.min(1).max(60),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.columns).size !== value.columns.length) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Tên cột bị trùng.",
      });
    }
    if (
      !value.columns.every((column) => column in value.columnTypes) ||
      Object.keys(value.columnTypes).length !== value.columns.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["columnTypes"],
        message: "Khai báo đúng một kiểu dữ liệu cho mỗi cột.",
      });
    }
    if (
      value.requiredColumns.some((column) => !value.columns.includes(column)) ||
      new Set(value.requiredColumns).size !== value.requiredColumns.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["requiredColumns"],
        message: "Cột bắt buộc phải là tập con không trùng của danh sách cột.",
      });
    }
    for (const column of Object.keys(value.maxStringLengths)) {
      if (
        !value.columns.includes(column) ||
        value.columnTypes[column] !== "STRING"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["maxStringLengths", column],
          message: "Chỉ đặt giới hạn độ dài cho cột STRING đã khai báo.",
        });
      }
    }
  });
export type IngestionSourceInput = z.infer<typeof IngestionSourceInputSchema>;
export const SourceTestSchema = z.strictObject({
  sourceId: id,
  reachable: z.boolean(),
  checkedAt: time,
  sourceEngine: EngineSchema,
  targetEngine: EngineSchema,
  rowCount: count,
  truncated: z.boolean(),
  columns: z.array(ColumnSchema),
  targets: z.array(SourceTargetSchema),
});
export type SourceTest = z.infer<typeof SourceTestSchema>;
export const SourceValidationSchema = SourceTestSchema.omit({ sourceId: true });
export const SourcePreviewInputSchema = z
  .strictObject({
    sourceWarehouseId: id,
    sourceDatasetId: id,
    tableId: id.optional(),
    columns: z.array(id).min(1).max(100).optional(),
    readSql: z.string().trim().min(1).max(100000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      Boolean(value.tableId) === Boolean(value.readSql) ||
      (!value.tableId && value.columns)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Chọn bảng hoặc nhập SELECT, không đồng thời.",
      });
    }
  });
export type SourcePreviewInput = z.infer<typeof SourcePreviewInputSchema>;
export const SourcePreviewSchema = z.strictObject({
  readSql: id,
  sourceEngine: EngineSchema,
  columns: z.array(ColumnSchema).min(1).max(100),
  columnTypes: IngestionSourceInputSchema.shape.columnTypes,
  rows: z.array(z.record(id, CellSchema)).max(20),
  truncated: z.boolean(),
  checkedAt: time,
});
export type SourcePreview = z.infer<typeof SourcePreviewSchema>;
const RunStatus = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "PARTIAL",
  "FAILED",
]);
export const IngestionSchema = z.object({
  runId: id,
  batchId: id,
  warehouseId: id,
  datasetId: id,
  engine: EngineSchema,
  status: RunStatus,
  sourceId: id,
  rowsWritten: count,
  rejectedCount: count,
  startedAt: time.nullable(),
  completedAt: time.nullable(),
  durationMs: count.nullable(),
  idempotent: z.boolean(),
  steps: z.array(
    z.object({
      stage: z.enum(["RAW", "STAGING", "WAREHOUSE", "MART"]),
      status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED", "SKIPPED"]),
      durationMs: count.nullable(),
      error: ErrorBodySchema.nullable().optional(),
    }),
  ),
  error: ErrorBodySchema.nullable(),
});
export type IngestionRun = z.infer<typeof IngestionSchema>;

export const FileCellSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(FileCellSchema),
    z.record(z.string(), FileCellSchema),
  ]),
);
export const FileDataTypeSchema = z.enum([
  "STRING",
  "BIGINT",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
]);
export const FileColumnSchema = z.strictObject({
  sourceName: id,
  name: id,
  dataType: FileDataTypeSchema,
  nullable: z.boolean(),
});
export type FileColumn = z.infer<typeof FileColumnSchema>;
export const FileUploadSchema = z.strictObject({
  id,
  fileName: id,
  fileType: id,
  fileSize: count,
  rowCount: count,
  columnCount: count,
  columns: z.array(FileColumnSchema).max(200),
  previewRows: z.array(z.array(FileCellSchema)).max(20),
  warnings: z.array(z.string()),
  sheets: z.array(z.string()),
  sheet: z.string().optional(),
  expiresAt: time,
});
export type FileUpload = z.infer<typeof FileUploadSchema>;
export const FileTargetsSchema = z.strictObject({
  warehouseId: id,
  namespaces: z.array(id),
});
export type FileTargets = z.infer<typeof FileTargetsSchema>;
export const FilePlanSchema = z.strictObject({
  id,
  uploadId: id,
  warehouseId: id,
  targetSchema: id,
  targetTable: id,
  datasetName: id,
  digest: id,
  status: z.literal("VALIDATED"),
  fileName: id,
  rowCount: count,
  columns: z.array(FileColumnSchema).max(200),
  previewRows: z.array(z.array(FileCellSchema)).max(20),
  layers: z
    .array(
      z.strictObject({
        name: z.enum(["RAW", "STAGING", "WAREHOUSE", "MART"]),
        schema: id,
        table: id,
      }),
    )
    .length(4),
  expiresAt: time,
  warnings: z.array(z.string()),
});
export type FilePlan = z.infer<typeof FilePlanSchema>;
export const FileRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
]);
export const FileRunStepSchema = z.strictObject({
  name: z.enum(["RAW", "STAGING", "WAREHOUSE", "MART"]),
  status: z.enum([
    "PENDING",
    "RUNNING",
    "SUCCESS",
    "FAILED",
    "SKIPPED",
    "CANCELLED",
  ]),
  rowsLoaded: count,
});
export const FileRunSchema = z.strictObject({
  id,
  sourceKind: z.literal("FILE"),
  status: FileRunStatusSchema,
  warehouseId: id,
  datasetId: id.nullable(),
  fileName: id,
  startedAt: time,
  completedAt: time.nullable(),
  rowCount: count,
  rowsLoaded: count,
  stages: z.array(FileRunStepSchema),
  error: ErrorBodySchema.nullable(),
  partialFailure: z.boolean(),
  createdTables: z.array(z.strictObject({ schema: id, table: id })),
});
export type FileRun = z.infer<typeof FileRunSchema>;
export const FilePlanInputSchema = z
  .strictObject({
    warehouseId: id,
    targetSchema: z.string().trim().min(1).max(128),
    targetTable: z.string().trim().min(1).max(128),
    datasetName: z.string().trim().min(1).max(120),
    columns: z.array(FileColumnSchema).min(1).max(200),
  })
  .superRefine((value, ctx) => {
    const targetNames = value.columns.map((column) => column.name);
    if (new Set(targetNames).size !== targetNames.length) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Tên cột đích phải duy nhất.",
      });
    }
    if (value.columns.some((column) => column.name.length > 128)) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Tên cột đích không được vượt quá 128 ký tự.",
      });
    }
  });
export type FilePlanInput = z.infer<typeof FilePlanInputSchema>;
export const FileRunRequestSchema = z.strictObject({
  planId: id,
  digest: id,
  idempotencyKey: id,
});
export const EvaluationMetricsSchema = z.object({
  totalCases: count,
  completedCases: count,
  executionSuccessRate: rate,
  resultEquivalenceRate: rate,
  invalidSqlRejectionRate: rate,
  dialectAccuracy: rate,
  avgLatencyMs: count.nullable(),
  p95LatencyMs: count.nullable(),
  denominators: z.record(z.string(), count),
});
export const EvaluationRunSchema = z.object({
  error: ErrorBodySchema.nullable().default(null),
  runId: id,
  warehouseId: id,
  datasetId: id,
  engine: EngineSchema,
  model: z.string().nullable(),
  status: RunStatus,
  createdAt: time,
  completedAt: time.nullable(),
  metrics: EvaluationMetricsSchema,
});
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;
export const EvaluationCaseSchema = z.object({
  resultId: id,
  caseId: id,
  runId: id,
  question: z.string(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  sqlDialect: EngineSchema,
  status: z.enum(["PASSED", "FAILED", "REJECTED", "ERROR"]),
  expectedSql: z.string().nullable(),
  generatedSql: z.string().nullable(),
  validationResult: z.string().nullable(),
  resultEquivalent: z.boolean().nullable(),
  chartMatch: z.boolean().nullable(),
  latencyMs: count.nullable(),
  failureReason: z.string().nullable(),
  actualResult: ResultSchema.nullable().optional(),
  expectedResult: ResultSchema.nullable().optional(),
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export const TestSuiteSchema = z.object({
  origin: z.enum(["CURRENT_SCHEMA", "PACKAGED_REGRESSION"]).optional(),
  description: z.string().optional(),
  suiteId: id,
  name: id,
  version: id,
  caseCount: count,
  engines: z.array(EngineSchema),
});
export const DiscoverySchema = z.object({
  runId: id,
  warehouseId: id,
  status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED"]),
  createdAt: time,
  completedAt: time.nullable().optional(),
  error: ErrorBodySchema.nullable().optional(),
  metadata: z
    .object({
      schemas: z.array(z.object({ name: id, tables: z.array(TableSchema) })),
    })
    .nullable()
    .optional(),
});
const HealthSchema = z.object({ id: id, name: id, status: id });
export const MonitoringSchema = z.object({
  queryVolume: count,
  successRate: rate,
  llmErrorCount: count,
  sqlValidationRejectionCount: count,
  timeoutCount: count,
  avgLatencyMs: count.nullable(),
  p95LatencyMs: count.nullable(),
  queriesByEngine: z.array(z.object({ engine: EngineSchema, count })),
  queriesByDataset: z.array(z.object({ datasetId: id, name: id, count })),
  warehouseHealth: z.array(HealthSchema),
  ingestionHealth: z.array(HealthSchema),
  from: time,
  to: time,
  denominator: count,
});
export const PlatformSchema = z.object({
  warehouseCount: count,
  datasetCount: count,
  healthyWarehouseCount: count,
  querySuccessRate: rate,
  recentQueries: z.array(QuerySummarySchema),
  recentEvaluationRuns: z.array(EvaluationRunSchema),
  recentIngestionRuns: z.array(IngestionSchema),
  systemHealth: id,
});
export const LimitsSchema = z.object({
  maxRows: count.min(1),
  maxBytes: count.min(1),
  statementTimeoutMs: count.min(1),
  queryDeadlineMs: count.min(1),
});
export const SettingsSchema = z.object({
  locale: z.enum(["vi", "en"]),
  timezone: id,
  defaultQueryMode: ModeSchema,
  limits: LimitsSchema,
  availableModes: z.array(ModeSchema),
  providerConfigured: z.boolean(),
  modelDisplayName: z.string().nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const ImportDialectSchema = z.enum([
  "AUTO_DETECT",
  "POSTGRESQL",
  "MYSQL",
  "SQL_SERVER",
]);
export const ImportModeSchema = z.enum(["NATIVE", "CROSS_DIALECT"]);
export const ImportRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "PARTIAL",
  "FAILED",
]);
export const ImportActionSchema = z.enum([
  "CREATE_SCHEMA",
  "CREATE_TABLE",
  "INSERT",
  "CREATE_INDEX",
]);
export const ImportStepStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
  "ROLLED_BACK",
]);
const ImportConstraintSchema = z.strictObject({
  kind: z.enum(["PRIMARY_KEY", "UNIQUE", "FOREIGN_KEY"]),
  name: z.string(),
  columns: z.array(id),
  referenceSchema: z.string(),
  referenceTable: z.string(),
  referenceColumns: z.array(id),
});
const ImportIndexSchema = z.strictObject({
  name: z.string(),
  columns: z.array(id),
  unique: z.boolean(),
});
export const ImportPlanSchema = z.strictObject({
  planId: id,
  planDigest: id,
  warehouseId: id,
  targetSchema: id,
  sourceDialect: ImportDialectSchema,
  detectedDialect: z.enum(["POSTGRESQL", "MYSQL", "SQL_SERVER"]),
  targetEngine: EngineSchema,
  mode: ImportModeSchema,
  statementCount: count,
  objectCount: count,
  supportedActions: z.array(ImportActionSchema),
  warnings: z.array(z.string()),
  unsupportedFeatures: z.array(z.string()),
  preview: z.strictObject({
    statements: z
      .array(
        z.strictObject({
          index: count.min(1),
          kind: id,
          objectName: z.string(),
          summary: z.string(),
        }),
      )
      .optional(),
    schemas: z.array(
      z.strictObject({
        name: id,
        tables: z.array(
          z.strictObject({
            name: id,
            constraints: z.array(ImportConstraintSchema),
            indexes: z.array(ImportIndexSchema),
            columns: z.array(
              z.strictObject({
                name: id,
                dataType: id,
                nullable: z.boolean(),
                primaryKey: z.boolean(),
                identity: z.boolean(),
                unique: z.boolean(),
                hasDefault: z.boolean(),
                defaultValue: z
                  .union([z.string(), z.boolean(), z.number()])
                  .nullable(),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
  expiresAt: time,
});
export type ImportPlan = z.infer<typeof ImportPlanSchema>;
const ImportStepSchema = z.strictObject({
  index: count.min(1),
  kind: id,
  objectName: z.string(),
  status: ImportStepStatusSchema,
  rowsAffected: count,
  error: ErrorBodySchema.nullable(),
});
export const ImportRunSchema = z.strictObject({
  runId: id,
  planId: id,
  warehouseId: id,
  targetSchema: id,
  sourceDialect: ImportDialectSchema,
  targetEngine: EngineSchema,
  status: ImportRunStatusSchema,
  statementCount: count,
  completedStatements: count,
  rowsAffected: count,
  createdAt: time,
  completedAt: time.nullable(),
  steps: z.array(ImportStepSchema),
  error: ErrorBodySchema.nullable(),
});
export type ImportRun = z.infer<typeof ImportRunSchema>;
export const WarehouseInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  engine: EngineSchema,
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .refine((v) => !/[\s/\\@?#]/.test(v), "Chỉ nhập hostname hoặc địa chỉ IP."),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(128),
  defaultSchema: z.string().trim().max(128).nullable(),
  username: z.string().trim().min(1).max(128),
  credentialReference: z.string().trim().min(1).max(256),
  importCredentialReference: z.string().trim().max(256).optional(),
  ingestionUsername: z.string().trim().max(128).optional(),
  ingestionCredentialReference: z
    .string()
    .trim()
    .max(256)
    .refine(
      (value) => !value || /^env:[A-Z_][A-Z0-9_]*$/.test(value),
      "Dùng tham chiếu environment dạng env:WAREHOUSE_WRITER_PASSWORD.",
    )
    .optional(),
});
export type WarehouseInput = z.infer<typeof WarehouseInputSchema>;
export const SavedSchema = z.object({
  savedResultId: id,
  queryId: id,
  name: id,
  createdAt: time,
});
export const TestConnectionSchema = z.object({
  warehouseId: id,
  reachable: z.boolean(),
  latencyMs: count,
  checkedAt: time,
  error: ErrorBodySchema.nullable(),
});
export const SettingsInputSchema = SettingsSchema.pick({
  locale: true,
  timezone: true,
  defaultQueryMode: true,
  limits: true,
}).strict();

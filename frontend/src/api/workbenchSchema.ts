import { z } from "zod";
import {
  CellSchema,
  ChartTypeSchema,
  DimensionSchema,
  EngineSchema,
  ErrorBodySchema,
  ExampleSchema,
  MetadataColumnSchema,
  MetricSchema,
  RelationshipSchema,
  TableRefSchema,
} from "./schema";

const id = z.string().min(1);
const count = z.number().int().nonnegative();
const time = z.iso.datetime({ offset: true });
export const SemanticDocumentSchema = z.object({
  tables: z.array(
    TableRefSchema.extend({
      logicalName: z.string(),
      description: z.string(),
      grain: z.string(),
      columns: z.array(MetadataColumnSchema),
    }),
  ),
  metrics: z.array(MetricSchema).max(200),
  dimensions: z.array(DimensionSchema).max(200),
  relationships: z.array(RelationshipSchema).max(500),
  examples: z.array(ExampleSchema).max(1000),
  businessRules: z.array(z.string()).max(200),
  semanticVersion: id,
  schemaVersion: id,
  timezone: id,
  referenceTime: time,
});
export type SemanticDocument = z.infer<typeof SemanticDocumentSchema>;
export const SemanticValidationSchema = z.object({
  valid: z.literal(true),
  semanticVersion: id,
  metricCount: count,
  dimensionCount: count,
  diagnostics: z.array(z.string()),
});
export const SemanticFilterSchema = z.strictObject({
  dimension: id,
  operator: z.enum([
    "EQ",
    "NE",
    "GT",
    "GTE",
    "LT",
    "LTE",
    "CONTAINS",
    "IS_NULL",
    "IS_NOT_NULL",
  ]),
  value: CellSchema.optional(),
});
export const SemanticSelectionSchema = z.strictObject({
  metrics: z.array(id).min(1).max(10),
  dimensions: z.array(id).max(5),
  filters: z.array(SemanticFilterSchema).max(10),
  limit: z.number().int().min(1).max(1000),
});
export type SemanticSelection = z.infer<typeof SemanticSelectionSchema>;
export const KnowledgeStatusSchema = z.object({
  datasetId: id,
  status: z.enum(["EMPTY", "READY", "STALE", "INDEXING", "ERROR"]),
  schemaItems: count,
  exampleCount: count,
  embeddingModel: id,
  indexedAt: time.nullable(),
  semanticVersion: id,
  schemaVersion: id,
  error: z.string().nullable(),
});
export const KnowledgeExampleSchema = z.object({
  entryId: id,
  question: id,
  sql: id,
  sqlDialect: EngineSchema,
  source: z.enum(["semantic-config", "approved-query"]),
});
export const KnowledgeExamplesSchema = z.object({
  items: z.array(KnowledgeExampleSchema),
  total: count,
});
export const KnowledgeSearchInputSchema = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  limit: z.number().int().min(1).max(20),
});
export const KnowledgeSearchSchema = z.object({
  strategy: z.literal("vector"),
  question: z.string(),
  hits: z.array(
    z.object({
      itemType: id,
      name: id,
      modelName: z.string(),
      text: z.string(),
      distance: z.number().finite(),
    }),
  ),
  examples: z.array(KnowledgeExampleSchema),
  embeddingModel: id,
});
export const TransformSchema = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
        expression: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(200),
  filter: z.string().max(4000),
  groupBy: z.array(z.string().min(1).max(4000)).max(20),
});
export type Transform = z.infer<typeof TransformSchema>;
export const PipelineInputSchema = z.strictObject({
  pipelineId: id.optional(),
  name: z.string().trim().min(1).max(120),
  sourceWarehouseId: id,
  sourceDatasetId: id,
  sourceTable: TableRefSchema,
  targetWarehouseId: id,
  targetSchema: id,
  targetTable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,44}$/),
  datasetName: z.string().trim().min(1).max(120),
  stages: z.strictObject({
    staging: TransformSchema,
    warehouse: TransformSchema,
    mart: TransformSchema,
  }),
  maxRows: z.number().int().min(1).max(10000),
  maxBytes: z.number().int().min(1024).max(52428800),
  timeoutSeconds: z.number().int().min(1).max(60),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});
export type PipelineInput = z.infer<typeof PipelineInputSchema>;
export const PipelineSchema = PipelineInputSchema.extend({
  pipelineId: id,
  status: z.enum(["ACTIVE", "DISABLED"]),
});
export type Pipeline = z.infer<typeof PipelineSchema>;
export const PipelineColumnSchema = z.object({
  name: id,
  dataType: id,
  nullable: z.boolean(),
});
export const PipelinePreviewSchema = z.object({
  valid: z.literal(true),
  sourceColumns: z.array(PipelineColumnSchema),
  stages: z.array(
    z.object({
      name: id,
      columns: z.array(PipelineColumnSchema),
      rows: z.array(z.record(z.string(), CellSchema)).max(20),
      rowCount: count,
      sql: z.string(),
    }),
  ),
  targetTables: z.array(z.object({ stage: id, schema: id, name: id })),
  warnings: z.array(z.string()),
});
export type PipelinePreview = z.infer<typeof PipelinePreviewSchema>;
export const PipelineRunSchema = z.object({
  runId: id,
  pipelineId: id,
  status: z.enum(["RUNNING", "SUCCESS", "FAILED"]),
  datasetId: z.string().nullable(),
  startedAt: time,
  completedAt: time.nullable(),
  stages: z.array(
    z.object({
      name: id,
      status: z.enum([
        "PENDING",
        "RUNNING",
        "SUCCESS",
        "FAILED",
        "SKIPPED",
        "ROLLED_BACK",
      ]),
      rowsWritten: count,
    }),
  ),
  createdTables: z.array(TableRefSchema),
  error: ErrorBodySchema.nullable(),
  partialFailure: z.boolean(),
});
export type PipelineRun = z.infer<typeof PipelineRunSchema>;

export const QuestionSuggestionSchema = z.object({
  suggestionId: id,
  question: id,
  description: z.string(),
  category: id,
  origin: z.enum(["PHYSICAL_SCHEMA", "SEMANTIC_MODEL", "CURATED"]),
  chartType: ChartTypeSchema,
  tableRefs: z.array(TableRefSchema),
  selectedMetrics: z.array(z.string()),
  selectedDimensions: z.array(z.string()),
  sqlDialect: EngineSchema,
});
export type QuestionSuggestion = z.infer<typeof QuestionSuggestionSchema>;
export const SemanticAssistInputSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(2000),
});
export const SemanticAssistSchema = z.object({
  model: id,
  semanticModel: SemanticDocumentSchema,
  warnings: z.array(z.string()),
});

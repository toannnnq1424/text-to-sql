import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as s from "../src/api/schema";
import * as w from "../src/api/workbenchSchema";
const schemas: Record<string, z.ZodType> = {
  SemanticDocument: w.SemanticDocumentSchema,
  SemanticValidation: w.SemanticValidationSchema,
  SemanticSelection: w.SemanticSelectionSchema,
  KnowledgeStatus: w.KnowledgeStatusSchema,
  KnowledgeExamples: w.KnowledgeExamplesSchema,
  KnowledgeSearch: w.KnowledgeSearchSchema,
  KnowledgeSearchInput: w.KnowledgeSearchInputSchema,
  KnowledgePromotion: z.strictObject({ queryId: z.string().min(1) }),
  Pipeline: w.PipelineSchema,
  PipelineInput: w.PipelineInputSchema,
  PipelineUpdate: z.union([
    w.PipelineInputSchema,
    z.strictObject({ status: z.enum(["ACTIVE", "DISABLED"]) }),
  ]),
  PipelinePreview: w.PipelinePreviewSchema,
  PipelineRun: w.PipelineRunSchema,
  PipelineRunInput: z.strictObject({
    idempotencyKey: z.string().min(1).max(200),
  }),
  Warehouse: s.WarehouseSchema,
  Dataset: s.DatasetSchema,
  Query: s.QuerySchema.omit({ chart: true }).extend({
    chart: s.ChartSchema.nullable(),
  }),
  QueryRequest: s.QueryRequestSchema,
  QueryResult: s.ResultSchema,
  ChartSpec: s.ChartSchema,
  Error: z.object({ error: s.ErrorBodySchema }),
  WarehouseInput: s.WarehouseInputSchema,
  WarehouseUpdate: s.WarehouseInputSchema.omit({ engine: true })
    .partial()
    .extend({ status: z.enum(["ACTIVE", "DISABLED"]).optional() })
    .strict(),
  DatasetInput: s.DatasetSchema.omit({
    datasetId: true,
    status: true,
    updatedAt: true,
  }).strict(),
  Catalog: s.CatalogSchema,
  Table: s.TableSchema,
  Metric: s.MetricSchema,
  Dimension: s.DimensionSchema,
  Relationship: s.RelationshipSchema,
  Example: s.ExampleSchema,
  IngestionRun: s.IngestionSchema,
  IngestionSource: s.SourceSchema,
  IngestionSourceDetail: s.IngestionSourceSchema,
  IngestionSourceInput: s.IngestionSourceInputSchema,
  IngestionSourceUpdate: z
    .strictObject({
      ...s.IngestionSourceInputSchema.shape,
      status: z.enum(["ACTIVE", "DISABLED"]),
    })
    .partial(),
  IngestionSourceTest: s.SourceTestSchema,
  IngestionSourcePreviewInput: s.SourcePreviewInputSchema,
  IngestionSourcePreview: s.SourcePreviewSchema,
  IngestionSourceValidation: s.SourceValidationSchema,
  FileUpload: s.FileUploadSchema,
  FilePlan: s.FilePlanSchema,
  FilePlanInput: s.FilePlanInputSchema,
  FileRun: s.FileRunSchema,
  FileRunInput: s.FileRunRequestSchema,
  FileTargets: s.FileTargetsSchema,
  ImportPlan: s.ImportPlanSchema,
  ImportRun: s.ImportRunSchema,
  ImportRunInput: z.strictObject({
    planId: z.string().min(1),
    planDigest: z.string().min(1),
    idempotencyKey: z.string().min(1),
  }),
  EvaluationRun: s.EvaluationRunSchema,
  EvaluationCase: s.EvaluationCaseSchema,
  TestSuite: s.TestSuiteSchema,
  Monitoring: s.MonitoringSchema,
  Platform: s.PlatformSchema,
  Settings: s.SettingsSchema,
  SettingsInput: s.SettingsInputSchema,
  DiscoveryRun: s.DiscoverySchema,
  TestConnection: s.TestConnectionSchema,
  SavedResult: s.SavedSchema,
  SaveInput: z.strictObject({ name: z.string().trim().min(1).max(120) }),
  IngestionInput: z.strictObject({
    warehouseId: z.string().min(1),
    datasetId: z.string().min(1),
    sourceId: z.string().min(1),
    idempotencyKey: z.string().min(1),
  }),
  EvaluationInput: z.strictObject({
    warehouseId: z.string().min(1),
    datasetId: z.string().min(1),
    suiteId: z.string().min(1),
    mode: s.ModeSchema,
  }),
  Health: z.object({ status: z.literal("UP") }),
};
for (const name of [
  "Pipeline",
  "PipelineRun",
  "Warehouse",
  "Dataset",
  "Table",
  "Metric",
  "Dimension",
  "Relationship",
  "Example",
  "IngestionRun",
  "IngestionSource",
  "ImportRun",
  "FileRun",
  "EvaluationRun",
  "EvaluationCase",
  "TestSuite",
])
  schemas[`Page${name}`] = s.pageSchema(schemas[name]);
schemas.PageQuerySummary = s.pageSchema(s.QuerySummarySchema);
schemas.SavedResults = z.array(s.SavedSchema);
const components = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => {
    const { $schema, ...json } = z.toJSONSchema(schema, {
      unrepresentable: "any",
    });
    return [name, json];
  }),
);
components.QueryResult.$comment =
  "Additional runtime invariants: unique aliases, rows.length <= pageSize and returnedRowCount, DECIMAL/BIGINT string precision and per-column cell types; enforced by Zod superRefine and contract tests.";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const paths: Record<string, Record<string, unknown>> = {};
function add(
  method: string,
  path: string,
  response: string,
  input?: string,
  status = "200",
  params: string[] = [],
) {
  const identifiers = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1 },
  }));
  paths[path] ??= {};
  paths[path][method] = {
    operationId: method + path.replace(/[^a-zA-Z0-9]/g, "_"),
    security: path === "/health" ? [] : [{ bearerAuth: [] }],
    parameters: [
      ...identifiers,
      ...params.map((name) => ({
        name,
        in: "query",
        required: false,
        schema: ["page", "pageSize"].includes(name)
          ? {
              type: "integer",
              minimum: 1,
              ...(name === "pageSize" ? { maximum: 100 } : {}),
            }
          : { type: "string" },
      })),
    ],
    ...(input
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref(input) } },
          },
        }
      : {}),
    responses: {
      [status]: {
        description: "Success",
        content: { "application/json": { schema: ref(response) } },
      },
      default: {
        description: "Controlled error",
        content: { "application/json": { schema: ref("Error") } },
      },
    },
  };
}
const list = ["page", "pageSize", "sort", "direction", "search"];
const scopes = ["warehouseId", "engine", "datasetId"];
add("get", "/health", "Health");
add("get", "/platform/summary", "Platform");
add("get", "/warehouses", "PageWarehouse", undefined, "200", [
  ...list,
  "engine",
  "status",
]);
add("post", "/warehouses", "Warehouse", "WarehouseInput", "201");
add("get", "/warehouses/{id}", "Warehouse");
add("patch", "/warehouses/{id}", "Warehouse", "WarehouseUpdate");
add("post", "/warehouses/{id}/test", "TestConnection");
add("post", "/warehouses/{id}/discover", "DiscoveryRun", undefined, "202");
add("get", "/warehouses/{id}/discoveries/{runId}", "DiscoveryRun");
add("get", "/datasets", "PageDataset", undefined, "200", [
  ...list,
  "warehouseId",
  "status",
]);
add("post", "/datasets", "Dataset", "DatasetInput", "201");
add("get", "/datasets/{id}", "Dataset");
add("get", "/datasets/{id}/catalog", "Catalog");
for (const [resource, type, param] of [
  ["tables", "Table", ["schema", "category", "status", "queryable"]],
  ["metrics", "Metric", ["category", "dataType"]],
  ["dimensions", "Dimension", ["dataType"]],
  ["relationships", "Relationship", ["tableId"]],
  ["examples", "Example", ["category", "language"]],
] as const) {
  add("get", `/datasets/{id}/${resource}`, `Page${type}`, undefined, "200", [
    ...list,
    ...param,
  ]);
  if (["tables", "metrics", "dimensions"].includes(resource))
    add("get", `/datasets/{id}/${resource}/{itemId}`, type);
}
add("get", "/datasets/{id}/semantic-model", "SemanticDocument");
add("put", "/datasets/{id}/semantic-model", "Dataset", "SemanticDocument");
add(
  "post",
  "/datasets/{id}/semantic-model/validate",
  "SemanticValidation",
  "SemanticDocument",
);
add("post", "/datasets/{id}/semantic-query", "Query", "SemanticSelection");
add("get", "/datasets/{id}/knowledge", "KnowledgeStatus");
add("delete", "/datasets/{id}/knowledge", "KnowledgeStatus");
add("post", "/datasets/{id}/knowledge/index", "KnowledgeStatus");
add(
  "post",
  "/datasets/{id}/knowledge/search",
  "KnowledgeSearch",
  "KnowledgeSearchInput",
);
add("get", "/datasets/{id}/knowledge/examples", "KnowledgeExamples");
add(
  "post",
  "/datasets/{id}/knowledge/examples",
  "KnowledgeExamples",
  "KnowledgePromotion",
);
add(
  "delete",
  "/datasets/{id}/knowledge/examples/{entryId}",
  "KnowledgeExamples",
);
add("get", "/pipelines", "PagePipeline", undefined, "200", list);
add("post", "/pipelines", "Pipeline", "PipelineInput", "201");
add("post", "/pipelines/preview", "PipelinePreview", "PipelineInput");
add("get", "/pipelines/runs", "PagePipelineRun", undefined, "200", [
  ...list,
  "pipelineId",
]);
add("get", "/pipelines/runs/{id}", "PipelineRun");
add("get", "/pipelines/{id}", "Pipeline");
add("patch", "/pipelines/{id}", "Pipeline", "PipelineUpdate");
add("post", "/pipelines/{id}/run", "PipelineRun", "PipelineRunInput", "202");
add("post", "/query", "Query", "QueryRequest", "201");
add("get", "/query/history", "PageQuerySummary", undefined, "200", [
  ...list,
  ...scopes,
  "status",
  "model",
  "from",
  "to",
]);
add("get", "/query/{id}", "Query");
add("get", "/query/{id}/result", "QueryResult", undefined, "200", list);
add("post", "/query/{id}/saved", "SavedResult", "SaveInput", "201");
add("get", "/query/{id}/saved", "SavedResults");
paths["/query/{id}/export.csv"] = {
  get: {
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: {
      "200": {
        description: "Authorized bounded snapshot CSV",
        content: { "text/csv": { schema: { type: "string" } } },
      },
      default: {
        description: "Controlled error",
        content: { "application/json": { schema: ref("Error") } },
      },
    },
  },
};
add(
  "get",
  "/warehouse/ingestion/sources",
  "PageIngestionSource",
  undefined,
  "200",
  [...list, "warehouseId", "datasetId"],
);
add(
  "post",
  "/warehouse/ingestion/sources",
  "IngestionSourceDetail",
  "IngestionSourceInput",
  "201",
);
add("get", "/warehouse/ingestion/sources/{id}", "IngestionSourceDetail");
add(
  "patch",
  "/warehouse/ingestion/sources/{id}",
  "IngestionSourceDetail",
  "IngestionSourceUpdate",
);
add("post", "/warehouse/ingestion/sources/{id}/test", "IngestionSourceTest");
add(
  "post",
  "/warehouse/ingestion/sources/preview",
  "IngestionSourcePreview",
  "IngestionSourcePreviewInput",
);
add(
  "post",
  "/warehouse/ingestion/sources/validate",
  "IngestionSourceValidation",
  "IngestionSourceInput",
);
add(
  "get",
  "/warehouse/ingestion/sources/targets",
  "PageTable",
  undefined,
  "200",
  [
    "warehouseId",
    "datasetId",
    "page",
    "pageSize",
    "search",
    "sort",
    "direction",
  ],
);
add(
  "post",
  "/warehouse/ingestion/run",
  "IngestionRun",
  "IngestionInput",
  "202",
);
add("get", "/warehouse/ingestion/runs", "PageIngestionRun", undefined, "200", [
  ...list,
  ...scopes,
  "status",
  "from",
  "to",
]);
add("get", "/warehouse/ingestion/runs/{id}", "IngestionRun");
add("post", "/warehouse/ingestion/files", "FileUpload");
(
  paths["/warehouse/ingestion/files"].post as Record<string, unknown>
).requestBody = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["file"],
        properties: {
          file: { type: "string", format: "binary" },
          sheet: { type: "string" },
          delimiter: { type: "string", enum: [",", "\t", ";", "|"] },
        },
      },
    },
  },
};
add(
  "get",
  "/warehouse/ingestion/files/targets",
  "FileTargets",
  undefined,
  "200",
  ["warehouseId"],
);
add("get", "/warehouse/ingestion/files/{id}", "FileUpload");
add(
  "delete",
  "/warehouse/ingestion/files/{id}",
  "FileUpload",
  undefined,
  "204",
);
(
  paths["/warehouse/ingestion/files/{id}"].delete as Record<string, unknown>
).responses = { "204": { description: "Private upload discarded" } };
add(
  "post",
  "/warehouse/ingestion/files/{id}/validate",
  "FilePlan",
  "FilePlanInput",
);
add(
  "post",
  "/warehouse/ingestion/files/runs",
  "FileRun",
  "FileRunInput",
  "202",
);
add("get", "/warehouse/ingestion/files/runs", "PageFileRun", undefined, "200", [
  ...list,
  "warehouseId",
]);
add("get", "/warehouse/ingestion/files/runs/{id}", "FileRun");
add("post", "/warehouse/ingestion/files/runs/{id}/cancel", "FileRun");
add("post", "/import/sql/validate", "ImportPlan");
(paths["/import/sql/validate"].post as Record<string, unknown>).requestBody = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["file", "sourceDialect", "warehouseId", "targetSchema"],
        properties: {
          file: { type: "string", format: "binary" },
          sourceDialect: {
            type: "string",
            enum: ["AUTO_DETECT", "POSTGRESQL", "MYSQL", "SQL_SERVER"],
          },
          warehouseId: { type: "string", minLength: 1 },
          targetSchema: { type: "string", minLength: 1 },
        },
      },
    },
  },
};
add("post", "/import/sql/runs", "ImportRun", "ImportRunInput", "202");
add("get", "/import/sql/runs", "PageImportRun", undefined, "200", [
  ...list,
  "warehouseId",
  "targetEngine",
  "status",
  "from",
  "to",
]);
add("get", "/import/sql/runs/{id}", "ImportRun");
add("get", "/evaluation/test-suites", "PageTestSuite", undefined, "200", list);
add("post", "/evaluation/run", "EvaluationRun", "EvaluationInput", "202");
add("get", "/evaluation/runs", "PageEvaluationRun", undefined, "200", [
  ...list,
  ...scopes,
  "model",
  "status",
  "from",
  "to",
]);
add("get", "/evaluation/runs/{id}", "EvaluationRun");
add("get", "/evaluation/results", "PageEvaluationCase", undefined, "200", [
  ...list,
  ...scopes,
  "runId",
  "model",
  "status",
  "difficulty",
]);
add("get", "/evaluation/results/{id}", "EvaluationCase");
add("get", "/monitoring/summary", "Monitoring", undefined, "200", [
  ...scopes,
  "from",
  "to",
]);
add("get", "/settings", "Settings");
add("patch", "/settings", "Settings", "SettingsInput");
const document = {
  openapi: "3.1.0",
  info: {
    title: "Natural Language Analytics Warehouse — frontend consumer contract",
    version: "1.0.0",
    description:
      "Machine-readable frontend-consumed operations from the shared Markdown baseline. Generated, not evidence of backend/provider approval or runtime integration. See frontend-contract-notes.md for previously unspecified nested DTO details.",
  },
  servers: [{ url: "/api/v1" }],
  paths,
  components: {
    schemas: components,
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
};
const target = fileURLToPath(
  new URL("../../docs/contracts/frontend-openapi.json", import.meta.url),
);
writeFileSync(target, JSON.stringify(document, null, 2) + "\n");
process.stdout.write(
  `Generated ${Object.keys(paths).length} paths and ${Object.keys(components).length} schemas.\n`,
);

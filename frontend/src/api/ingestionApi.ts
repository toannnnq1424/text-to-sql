import { request, requestEmpty, encodeId, type Params } from "./client";
import {
  IngestionSchema,
  IngestionSourceInputSchema,
  IngestionSourceSchema,
  SourceSchema,
  SourceTestSchema,
  FileUploadSchema,
  FilePlanSchema,
  FileRunSchema,
  FilePlanInputSchema,
  FileRunRequestSchema,
  FileTargetsSchema,
  pageSchema,
  type FilePlanInput,
  type IngestionSourceInput,
} from "./schema";
export const ingestionApi = {
  sources: (params?: Params, signal?: AbortSignal) =>
    request("/warehouse/ingestion/sources", pageSchema(SourceSchema), {
      params,
      signal,
    }),
  source: (id: string, signal?: AbortSignal) =>
    request(
      `/warehouse/ingestion/sources/${encodeId(id)}`,
      IngestionSourceSchema,
      { signal },
    ),
  createSource: (body: IngestionSourceInput) =>
    request("/warehouse/ingestion/sources", IngestionSourceSchema, {
      method: "POST",
      body: IngestionSourceInputSchema.parse(body),
    }),
  updateSource: (
    id: string,
    body: Partial<IngestionSourceInput> & { status?: "ACTIVE" | "DISABLED" },
  ) =>
    request(
      `/warehouse/ingestion/sources/${encodeId(id)}`,
      IngestionSourceSchema,
      {
        method: "PATCH",
        body,
      },
    ),
  testSource: (id: string) =>
    request(
      `/warehouse/ingestion/sources/${encodeId(id)}/test`,
      SourceTestSchema,
      { method: "POST" },
    ),
  run: (body: {
    warehouseId: string;
    datasetId: string;
    sourceId: string;
    idempotencyKey: string;
  }) =>
    request("/warehouse/ingestion/run", IngestionSchema, {
      method: "POST",
      body,
    }),
  runs: (params?: Params, signal?: AbortSignal) =>
    request("/warehouse/ingestion/runs", pageSchema(IngestionSchema), {
      params,
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    request(`/warehouse/ingestion/runs/${encodeId(id)}`, IngestionSchema, {
      signal,
    }),
  uploadFile: (
    input: { file: File; sheet?: string; delimiter?: string },
    signal?: AbortSignal,
  ) => {
    const formData = new FormData();
    formData.set("file", input.file);
    if (input.sheet) formData.set("sheet", input.sheet);
    if (input.delimiter) formData.set("delimiter", input.delimiter);
    return request("/warehouse/ingestion/files", FileUploadSchema, {
      method: "POST",
      formData,
      signal,
      timeoutMs: 120000,
    });
  },
  discardFile: (id: string) =>
    requestEmpty(`/warehouse/ingestion/files/${encodeId(id)}`, {
      method: "DELETE",
    }),
  fileTargets: (warehouseId: string, signal?: AbortSignal) =>
    request("/warehouse/ingestion/files/targets", FileTargetsSchema, {
      params: { warehouseId },
      signal,
    }),
  validateFile: (uploadId: string, body: FilePlanInput) =>
    request(
      `/warehouse/ingestion/files/${encodeId(uploadId)}/validate`,
      FilePlanSchema,
      {
        method: "POST",
        body: FilePlanInputSchema.parse(body),
        timeoutMs: 120000,
      },
    ),
  runFile: (body: { planId: string; digest: string; idempotencyKey: string }) =>
    request("/warehouse/ingestion/files/runs", FileRunSchema, {
      method: "POST",
      body: FileRunRequestSchema.parse(body),
      timeoutMs: 120000,
    }),
  fileRuns: (params?: Params, signal?: AbortSignal) =>
    request("/warehouse/ingestion/files/runs", pageSchema(FileRunSchema), {
      params,
      signal,
    }),
  getFileRun: (id: string, signal?: AbortSignal) =>
    request(`/warehouse/ingestion/files/runs/${encodeId(id)}`, FileRunSchema, {
      signal,
    }),
  cancelFileRun: (id: string) =>
    request(
      `/warehouse/ingestion/files/runs/${encodeId(id)}/cancel`,
      FileRunSchema,
      { method: "POST" },
    ),
};

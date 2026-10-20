import { request, encodeId, type Params } from "./client";
import {
  IngestionSchema,
  IngestionSourceInputSchema,
  IngestionSourceSchema,
  SourceSchema,
  SourceTestSchema,
  pageSchema,
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
};

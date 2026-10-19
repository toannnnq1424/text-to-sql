import { request, encodeId, type Params } from "./client";
import { pageSchema, IngestionSchema, SourceSchema } from "./schema";
export const ingestionApi = {
  sources: (params?: Params, signal?: AbortSignal) =>
    request("/warehouse/ingestion/sources", pageSchema(SourceSchema), {
      params,
      signal,
    }),
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

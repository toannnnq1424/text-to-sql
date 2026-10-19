import { request, encodeId, type Params } from "./client";
import { DatasetSchema, pageSchema } from "./schema";
export const datasetApi = {
  create: (body: {
    warehouseId: string;
    name: string;
    description: string;
    allowedSchemas: string[];
    allowedTables: { schema: string; name: string }[];
    semanticVersion: string;
    schemaVersion: string;
  }) => request("/datasets", DatasetSchema, { method: "POST", body }),
  list: (params?: Params, signal?: AbortSignal) =>
    request("/datasets", pageSchema(DatasetSchema), { params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    request(`/datasets/${encodeId(id)}`, DatasetSchema, { signal }),
};

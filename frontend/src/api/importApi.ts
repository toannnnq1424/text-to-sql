import { encodeId, request, type Params } from "./client";
import { ImportPlanSchema, ImportRunSchema, pageSchema } from "./schema";

export const importApi = {
  validate: (
    input: {
      file: File;
      sourceDialect: string;
      warehouseId: string;
      targetSchema: string;
    },
    signal?: AbortSignal,
  ) => {
    const formData = new FormData();
    formData.set("file", input.file);
    formData.set("sourceDialect", input.sourceDialect);
    formData.set("warehouseId", input.warehouseId);
    formData.set("targetSchema", input.targetSchema);
    return request("/import/sql/validate", ImportPlanSchema, {
      method: "POST",
      formData,
      signal,
      timeoutMs: 30_000,
    });
  },
  run: (body: { planId: string; planDigest: string; idempotencyKey: string }) =>
    request("/import/sql/runs", ImportRunSchema, {
      method: "POST",
      body,
      timeoutMs: 30_000,
    }),
  runs: (params?: Params, signal?: AbortSignal) =>
    request("/import/sql/runs", pageSchema(ImportRunSchema), {
      params,
      signal,
    }),
  get: (runId: string, signal?: AbortSignal) =>
    request(`/import/sql/runs/${encodeId(runId)}`, ImportRunSchema, { signal }),
};

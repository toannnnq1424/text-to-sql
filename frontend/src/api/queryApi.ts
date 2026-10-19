import { z } from "zod";
import { request, encodeId, downloadCsv, type Params } from "./client";
import {
  QuerySchema,
  QueryRequestSchema,
  ResultSchema,
  SavedSchema,
} from "./schema";
export const queryApi = {
  run: (body: z.infer<typeof QueryRequestSchema>, signal?: AbortSignal) =>
    request("/query", QuerySchema, {
      method: "POST",
      body: QueryRequestSchema.parse(body),
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    request(`/query/${encodeId(id)}`, QuerySchema, { signal }),
  result: (id: string, params?: Params, signal?: AbortSignal) =>
    request(`/query/${encodeId(id)}/result`, ResultSchema, { params, signal }),
  exportCsv: downloadCsv,
  save: (id: string, name: string) =>
    request(`/query/${encodeId(id)}/saved`, SavedSchema, {
      method: "POST",
      body: { name: z.string().trim().min(1).max(120).parse(name) },
    }),
  saved: (id: string, signal?: AbortSignal) =>
    request(`/query/${encodeId(id)}/saved`, z.array(SavedSchema), { signal }),
};

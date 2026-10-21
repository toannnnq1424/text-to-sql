import { encodeId, request, type Params } from "./client";
import {
  QualityRulesInputSchema,
  QualityRulesSchema,
  QualityRunSchema,
  QualityRunPageSchema,
  type QualityRules,
} from "./qualitySchema";

const base = (id: string) => `/datasets/${encodeId(id)}/quality`;
export const qualityApi = {
  rules: (id: string, signal?: AbortSignal) =>
    request(`${base(id)}/rules`, QualityRulesSchema, { signal }),
  save: (id: string, input: Pick<QualityRules, "revision" | "rules">) =>
    request(`${base(id)}/rules`, QualityRulesSchema, {
      method: "PUT",
      body: QualityRulesInputSchema.parse(input),
    }),
  run: (id: string) =>
    request(`${base(id)}/runs`, QualityRunSchema, { method: "POST", body: {} }),
  runs: (id: string, params?: Params, signal?: AbortSignal) =>
    request(`${base(id)}/runs`, QualityRunPageSchema, { params, signal }),
  get: (id: string, runId: string, signal?: AbortSignal) =>
    request(`${base(id)}/runs/${encodeId(runId)}`, QualityRunSchema, {
      signal,
    }),
};

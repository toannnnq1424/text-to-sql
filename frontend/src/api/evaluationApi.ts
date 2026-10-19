import { request, encodeId, type Params } from "./client";
import {
  pageSchema,
  TestSuiteSchema,
  EvaluationRunSchema,
  EvaluationCaseSchema,
  type Mode,
} from "./schema";
export const evaluationApi = {
  suites: (params?: Params, signal?: AbortSignal) =>
    request("/evaluation/test-suites", pageSchema(TestSuiteSchema), {
      params,
      signal,
    }),
  run: (body: {
    warehouseId: string;
    datasetId: string;
    suiteId: string;
    mode: Mode;
  }) =>
    request("/evaluation/run", EvaluationRunSchema, { method: "POST", body }),
  runs: (params?: Params, signal?: AbortSignal) =>
    request("/evaluation/runs", pageSchema(EvaluationRunSchema), {
      params,
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    request(`/evaluation/runs/${encodeId(id)}`, EvaluationRunSchema, {
      signal,
    }),
  results: (params?: Params, signal?: AbortSignal) =>
    request("/evaluation/results", pageSchema(EvaluationCaseSchema), {
      params,
      signal,
    }),
  result: (id: string, signal?: AbortSignal) =>
    request(`/evaluation/results/${encodeId(id)}`, EvaluationCaseSchema, {
      signal,
    }),
};

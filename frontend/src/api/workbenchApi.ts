import { z } from "zod";
import { encodeId, request, type Params } from "./client";
import { DatasetSchema, QuerySchema, pageSchema } from "./schema";
import {
  KnowledgeExamplesSchema,
  KnowledgeSearchInputSchema,
  KnowledgeSearchSchema,
  KnowledgeStatusSchema,
  PipelineInputSchema,
  PipelinePreviewSchema,
  PipelineRunSchema,
  PipelineSchema,
  SemanticDocumentSchema,
  SemanticSelectionSchema,
  SemanticValidationSchema,
  SemanticAssistInputSchema,
  SemanticAssistSchema,
  type PipelineInput,
  type SemanticDocument,
  type SemanticSelection,
} from "./workbenchSchema";

const datasetPath = (id: string) => `/datasets/${encodeId(id)}`;
const pipelinePath = (id: string) => `/pipelines/${encodeId(id)}`;
export const semanticApi = {
  assist: (id: string, instruction: string) =>
    request(`${datasetPath(id)}/semantic-assist`, SemanticAssistSchema, {
      method: "POST",
      body: SemanticAssistInputSchema.parse({ instruction }),
      timeoutMs: 180000,
    }),
  get: (id: string, signal?: AbortSignal) =>
    request(`${datasetPath(id)}/semantic-model`, SemanticDocumentSchema, {
      signal,
    }),
  validate: (id: string, body: SemanticDocument) =>
    request(
      `${datasetPath(id)}/semantic-model/validate`,
      SemanticValidationSchema,
      { method: "POST", body: SemanticDocumentSchema.parse(body) },
    ),
  save: (id: string, body: SemanticDocument) =>
    request(`${datasetPath(id)}/semantic-model`, DatasetSchema, {
      method: "PUT",
      body: SemanticDocumentSchema.parse(body),
    }),
  run: (id: string, body: SemanticSelection) =>
    request(`${datasetPath(id)}/semantic-query`, QuerySchema, {
      method: "POST",
      body: SemanticSelectionSchema.parse(body),
    }),
};
export const knowledgeApi = {
  status: (id: string, signal?: AbortSignal) =>
    request(`${datasetPath(id)}/knowledge`, KnowledgeStatusSchema, { signal }),
  index: (id: string) =>
    request(`${datasetPath(id)}/knowledge/index`, KnowledgeStatusSchema, {
      method: "POST",
      timeoutMs: 300000,
    }),
  reset: (id: string) =>
    request(`${datasetPath(id)}/knowledge`, KnowledgeStatusSchema, {
      method: "DELETE",
    }),
  search: (id: string, body: z.infer<typeof KnowledgeSearchInputSchema>) =>
    request(`${datasetPath(id)}/knowledge/search`, KnowledgeSearchSchema, {
      method: "POST",
      body: KnowledgeSearchInputSchema.parse(body),
      timeoutMs: 120000,
    }),
  examples: (id: string, signal?: AbortSignal) =>
    request(`${datasetPath(id)}/knowledge/examples`, KnowledgeExamplesSchema, {
      signal,
    }),
  promote: (id: string, queryId: string) =>
    request(`${datasetPath(id)}/knowledge/examples`, KnowledgeExamplesSchema, {
      method: "POST",
      body: { queryId },
    }),
  forget: (id: string, entryId: string) =>
    request(
      `${datasetPath(id)}/knowledge/examples/${encodeId(entryId)}`,
      KnowledgeExamplesSchema,
      { method: "DELETE" },
    ),
};
export const pipelineApi = {
  list: (params?: Params, signal?: AbortSignal) =>
    request("/pipelines", pageSchema(PipelineSchema), { params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    request(pipelinePath(id), PipelineSchema, { signal }),
  create: (body: PipelineInput) =>
    request("/pipelines", PipelineSchema, {
      method: "POST",
      body: PipelineInputSchema.parse(body),
      timeoutMs: 120000,
    }),
  update: (
    id: string,
    body: PipelineInput | { status: "ACTIVE" | "DISABLED" },
  ) =>
    request(pipelinePath(id), PipelineSchema, {
      method: "PATCH",
      body,
      timeoutMs: 120000,
    }),
  preview: (body: PipelineInput) =>
    request("/pipelines/preview", PipelinePreviewSchema, {
      method: "POST",
      body: PipelineInputSchema.parse(body),
      timeoutMs: 120000,
    }),
  run: (id: string, idempotencyKey: string) =>
    request(`${pipelinePath(id)}/run`, PipelineRunSchema, {
      method: "POST",
      body: { idempotencyKey },
      timeoutMs: 120000,
    }),
  runs: (params?: Params, signal?: AbortSignal) =>
    request("/pipelines/runs", pageSchema(PipelineRunSchema), {
      params,
      signal,
    }),
  runStatus: (id: string, signal?: AbortSignal) =>
    request(`/pipelines/runs/${encodeId(id)}`, PipelineRunSchema, { signal }),
};

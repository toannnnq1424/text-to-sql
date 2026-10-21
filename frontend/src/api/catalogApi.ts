import { request, encodeId, type Params } from "./client";
import {
  pageSchema,
  CatalogSchema,
  TableSchema,
  MetricSchema,
  DimensionSchema,
  RelationshipSchema,
  ExampleSchema,
} from "./schema";
import { QuestionSuggestionSchema } from "./workbenchSchema";
const base = (id: string) => `/datasets/${encodeId(id)}`;
export const catalogApi = {
  suggestions: (id: string, params?: Params, signal?: AbortSignal) =>
    request(
      `${base(id)}/question-suggestions`,
      pageSchema(QuestionSuggestionSchema),
      { params, signal },
    ),
  summary: (id: string, signal?: AbortSignal) =>
    request(`${base(id)}/catalog`, CatalogSchema, { signal }),
  tables: (id: string, params?: Params, signal?: AbortSignal) =>
    request(`${base(id)}/tables`, pageSchema(TableSchema), { params, signal }),
  table: (id: string, tableId: string, signal?: AbortSignal) =>
    request(`${base(id)}/tables/${encodeId(tableId)}`, TableSchema, { signal }),
  metrics: (id: string, params?: Params, signal?: AbortSignal) =>
    request(`${base(id)}/metrics`, pageSchema(MetricSchema), {
      params,
      signal,
    }),
  metric: (id: string, name: string, signal?: AbortSignal) =>
    request(`${base(id)}/metrics/${encodeId(name)}`, MetricSchema, { signal }),
  dimensions: (id: string, params?: Params, signal?: AbortSignal) =>
    request(`${base(id)}/dimensions`, pageSchema(DimensionSchema), {
      params,
      signal,
    }),
  dimension: (id: string, name: string, signal?: AbortSignal) =>
    request(`${base(id)}/dimensions/${encodeId(name)}`, DimensionSchema, {
      signal,
    }),
  relationships: (id: string, params?: Params, signal?: AbortSignal) =>
    request(`${base(id)}/relationships`, pageSchema(RelationshipSchema), {
      params,
      signal,
    }),
  examples: (id: string, params?: Params, signal?: AbortSignal) =>
    request(`${base(id)}/examples`, pageSchema(ExampleSchema), {
      params,
      signal,
    }),
};

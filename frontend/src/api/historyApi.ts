import { request, type Params } from "./client";
import { pageSchema, QuerySummarySchema } from "./schema";
export const historyApi = {
  list: (params?: Params, signal?: AbortSignal) =>
    request("/query/history", pageSchema(QuerySummarySchema), {
      params,
      signal,
    }),
};

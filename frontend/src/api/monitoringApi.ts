import { request, type Params } from "./client";
import { MonitoringSchema } from "./schema";
export const monitoringApi = {
  summary: (params?: Params, signal?: AbortSignal) =>
    request("/monitoring/summary", MonitoringSchema, {
      params: Object.fromEntries(
        Object.entries(params || {}).filter(([key]) =>
          ["warehouseId", "engine", "datasetId", "from", "to"].includes(key),
        ),
      ),
      signal,
    }),
};

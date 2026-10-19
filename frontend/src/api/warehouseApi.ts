import { request, encodeId, type Params } from "./client";
import {
  WarehouseSchema,
  pageSchema,
  WarehouseInputSchema,
  DiscoverySchema,
  TestConnectionSchema,
  type WarehouseInput,
} from "./schema";
export const warehouseApi = {
  list: (params?: Params, signal?: AbortSignal) =>
    request("/warehouses", pageSchema(WarehouseSchema), { params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    request(`/warehouses/${encodeId(id)}`, WarehouseSchema, { signal }),
  create: (body: WarehouseInput) =>
    request("/warehouses", WarehouseSchema, {
      method: "POST",
      body: WarehouseInputSchema.parse(body),
    }),
  update: (
    id: string,
    body: Partial<Omit<WarehouseInput, "engine">> & {
      status?: "ACTIVE" | "DISABLED";
    },
  ) =>
    request(`/warehouses/${encodeId(id)}`, WarehouseSchema, {
      method: "PATCH",
      body,
    }),
  test: (id: string) =>
    request(`/warehouses/${encodeId(id)}/test`, TestConnectionSchema, {
      method: "POST",
    }),
  discover: (id: string) =>
    request(`/warehouses/${encodeId(id)}/discover`, DiscoverySchema, {
      method: "POST",
    }),
  discovery: (id: string, runId: string, signal?: AbortSignal) =>
    request(
      `/warehouses/${encodeId(id)}/discoveries/${encodeId(runId)}`,
      DiscoverySchema,
      { signal },
    ),
};

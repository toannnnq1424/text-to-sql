import { encodeId, request, requestEmpty } from "./client";
import {
  ModelProviderDefaultSchema,
  ModelProviderInputSchema,
  ModelProviderSchema,
  ModelProvidersSchema,
  ModelProviderUpdateSchema,
  type ModelProviderInput,
  type ModelProviderUpdate,
} from "./modelProviderSchema";

export const modelProviderApi = {
  list: (signal?: AbortSignal) =>
    request("/settings/model-providers", ModelProvidersSchema, { signal }),
  create: (body: ModelProviderInput) =>
    request("/settings/model-providers", ModelProviderSchema, {
      method: "POST",
      body: ModelProviderInputSchema.parse(body),
    }),
  update: (id: string, body: ModelProviderUpdate) =>
    request(`/settings/model-providers/${encodeId(id)}`, ModelProviderSchema, {
      method: "PUT",
      body: ModelProviderUpdateSchema.parse(body),
    }),
  setDefault: (providerId: string | null) =>
    request("/settings/model-providers/default", ModelProvidersSchema, {
      method: "PUT",
      body: ModelProviderDefaultSchema.parse({ providerId }),
    }),
  remove: (id: string) =>
    requestEmpty(`/settings/model-providers/${encodeId(id)}`, {
      method: "DELETE",
    }),
};

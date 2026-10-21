import { z } from "zod";

const visible = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const ProviderKindSchema = z.enum(["ONLINE", "OLLAMA"]);
export const ProviderSourceSchema = z.enum(["APPLICATION", "ENVIRONMENT"]);
export const ProviderSnapshotSchema = z.strictObject({
  providerId: visible,
  revision: visible,
  name: visible.max(120),
  kind: ProviderKindSchema,
  model: visible.max(200),
  source: ProviderSourceSchema,
});
export type ProviderSnapshot = z.infer<typeof ProviderSnapshotSchema>;
export const ModelProviderSchema = ProviderSnapshotSchema.extend({
  baseUrl: z.string().max(2048),
  hasApiKey: z.boolean(),
  enabled: z.boolean(),
  configured: z.boolean(),
  readOnly: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export const ModelProvidersSchema = z.strictObject({
  items: z.array(ModelProviderSchema),
  defaultProviderId: z.string().min(1).nullable(),
  configurationAvailable: z.boolean(),
});
export type ModelProviders = z.infer<typeof ModelProvidersSchema>;
const baseUrl = visible.max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}, "Địa chỉ HTTP(S) không được chứa tài khoản, query hoặc fragment.");
const fields = {
  name: visible.max(120),
  kind: ProviderKindSchema,
  baseUrl,
  model: visible
    .max(200)
    .regex(/^[A-Za-z0-9_.:/@+\-]+$/, "Tên model chứa ký tự không hợp lệ."),
  enabled: z.boolean(),
  apiKey: z
    .string()
    .min(1)
    .max(8192)
    .regex(
      /^[^\s\u0000-\u001f\u007f]+$/,
      "API key không được chứa khoảng trắng, xuống dòng hoặc ký tự điều khiển.",
    )
    .optional(),
};
export const ModelProviderInputSchema = z.strictObject(fields);
export const ModelProviderUpdateSchema = z
  .strictObject({
    ...fields,
    revision: visible,
    clearApiKey: z.boolean().optional(),
  })
  .refine(
    (value) => !(value.clearApiKey && value.apiKey),
    "Chỉ chọn thay key hoặc xóa key.",
  );
export const ModelProviderDefaultSchema = z.strictObject({
  providerId: z.string().min(1).nullable(),
});
export type ModelProviderInput = z.infer<typeof ModelProviderInputSchema>;
export type ModelProviderUpdate = z.infer<typeof ModelProviderUpdateSchema>;

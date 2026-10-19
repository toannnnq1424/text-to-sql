import { request } from "./client";
import { SettingsSchema, SettingsInputSchema } from "./schema";
import { z } from "zod";
export const settingsApi = {
  get: (signal?: AbortSignal) =>
    request("/settings", SettingsSchema, { signal }),
  update: (body: z.infer<typeof SettingsInputSchema>) =>
    request("/settings", SettingsSchema, {
      method: "PATCH",
      body: SettingsInputSchema.parse(body),
    }),
};

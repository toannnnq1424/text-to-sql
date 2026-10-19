import { request } from "./client";
import { PlatformSchema } from "./schema";
export const platformApi = {
  summary: (signal?: AbortSignal) =>
    request("/platform/summary", PlatformSchema, { signal }),
};

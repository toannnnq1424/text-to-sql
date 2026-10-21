import { describe, expect, it } from "vitest";
import {
  ModelProviderInputSchema,
  ModelProvidersSchema,
} from "./modelProviderSchema";
import { QueryRequestSchema, QuerySummarySchema } from "./schema";
import { executionLabel } from "../lib/modelProvider";
import * as fixture from "../test/fixtures";

describe("model provider consumer boundaries", () => {
  it("rejects any secret field in the public safe summary", () => {
    expect(ModelProvidersSchema.safeParse(fixture.modelProviders).success).toBe(
      true,
    );
    const response = structuredClone(fixture.modelProviders);
    Object.assign(response.items[0], { apiKey: "test-only-secret" });
    expect(ModelProvidersSchema.safeParse(response).success).toBe(false);
  });
  it("rejects unsafe URL credentials and control characters in submitted keys", () => {
    const input = {
      name: "A provider",
      kind: "ONLINE",
      baseUrl: "https://provider.example/v1",
      model: "model-small",
      enabled: true,
    };
    expect(
      ModelProviderInputSchema.safeParse({
        ...input,
        apiKey: "test-key\nother",
      }).success,
    ).toBe(false);
    expect(
      ModelProviderInputSchema.safeParse({ ...input, apiKey: "test key" })
        .success,
    ).toBe(false);
    for (const baseUrl of [
      "https://name:password@provider.example/v1",
      "https://provider.example/v1?key=secret",
      "https://provider.example/v1#secret",
    ]) {
      expect(
        ModelProviderInputSchema.safeParse({ ...input, baseUrl }).success,
      ).toBe(false);
    }
  });
  it("accepts only API provider overrides and leaves older query provenance unknown", () => {
    const query = {
      warehouseId: "warehouse",
      datasetId: "dataset",
      question: "Question",
      providerId: "environment",
    };
    expect(
      QueryRequestSchema.safeParse({ ...query, mode: "API" }).success,
    ).toBe(true);
    expect(
      QueryRequestSchema.safeParse({ ...query, mode: "AUTO" }).success,
    ).toBe(false);
    expect(
      QueryRequestSchema.safeParse({ ...query, mode: "DETERMINISTIC" }).success,
    ).toBe(false);
    const old = QuerySummarySchema.parse({
      ...fixture.query,
      executionMode: "API",
      rowCount: 1,
    });
    expect(old.provider).toBeNull();
    expect(
      executionLabel({
        ...old,
        model: "actual-model",
        provider: fixture.modelProviders.items[0],
      }),
    ).toContain(
      "Ollama local · actual-model · cấu hình yêu cầu test-local:small",
    );
    expect(executionLabel(old)).toContain("snapshot cũ chưa có nguồn");
    expect(executionLabel({ ...old, executionMode: "DETERMINISTIC" })).toBe(
      "Offline · khớp ví dụ (không AI)",
    );
  });
});

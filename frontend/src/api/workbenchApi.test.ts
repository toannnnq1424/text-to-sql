import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { knowledgeApi, pipelineApi, semanticApi } from "./workbenchApi";
import {
  SemanticSelectionSchema,
  PipelinePreviewSchema,
} from "./workbenchSchema";

describe("workbench consumer boundaries", () => {
  it("rejects selections outside the shared limits before making a request", async () => {
    const handler = vi.fn();
    server.use(
      http.post("*/api/v1/datasets/:id/semantic-query", () => {
        handler();
        return HttpResponse.json({});
      }),
    );
    expect(() =>
      semanticApi.run("dataset", {
        metrics: [],
        dimensions: [],
        filters: [],
        limit: 100,
      }),
    ).toThrow();
    expect(
      SemanticSelectionSchema.safeParse({
        metrics: ["count"],
        dimensions: [],
        filters: [],
        limit: 1001,
      }).success,
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
  it("does not render a malformed persisted pipeline run as successful", async () => {
    server.use(
      http.get("*/api/v1/pipelines/runs/:id", () =>
        HttpResponse.json({
          runId: "run",
          pipelineId: "pipeline",
          status: "SUCCESS",
          datasetId: null,
          startedAt: "2026-10-21T00:00:00Z",
          completedAt: null,
          stages: [{ name: "MART", status: "INVENTED", rowsWritten: 1 }],
          createdTables: [],
          error: null,
          partialFailure: false,
        }),
      ),
    );
    await expect(pipelineApi.runStatus("run")).rejects.toMatchObject({
      code: "CONTRACT_MISMATCH",
    });
  });
  it("surfaces controlled index service failures with their correlation ID", async () => {
    server.use(
      http.post("*/api/v1/datasets/:id/knowledge/index", () =>
        HttpResponse.json(
          {
            error: {
              code: "KNOWLEDGE_UNAVAILABLE",
              message: "Embedding service unavailable",
              correlationId: "knowledge-test",
              retryable: true,
              details: {},
            },
          },
          { status: 503 },
        ),
      ),
    );
    await expect(knowledgeApi.index("dataset")).rejects.toMatchObject({
      code: "KNOWLEDGE_UNAVAILABLE",
      correlationId: "knowledge-test",
      status: 503,
    });
  });
  it("bounds previews and keeps exact decimal and bigint strings", () => {
    const preview = {
      valid: true,
      sourceColumns: [{ name: "amount", dataType: "DECIMAL", nullable: false }],
      stages: [
        {
          name: "MART",
          columns: [{ name: "amount", dataType: "DECIMAL", nullable: false }],
          rows: [{ amount: "1234567890123456789.1234567890" }],
          rowCount: 1,
          sql: "SELECT amount FROM input",
        },
      ],
      targetTables: [{ stage: "MART", schema: "import", name: "result_mart" }],
      warnings: [],
    };
    expect(PipelinePreviewSchema.parse(preview).stages[0].rows[0].amount).toBe(
      "1234567890123456789.1234567890",
    );
    expect(
      PipelinePreviewSchema.safeParse({
        ...preview,
        stages: [
          {
            ...preview.stages[0],
            rows: Array.from({ length: 21 }, () => ({ amount: "1.00" })),
          },
        ],
      }).success,
    ).toBe(false);
  });
});

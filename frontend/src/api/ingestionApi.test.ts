import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { ApiError } from "./client";
import { ingestionApi } from "./ingestionApi";
import { WarehouseSchema } from "./schema";
import { server } from "../test/server";
import * as fixtures from "../test/fixtures";

const api = "*/api/v1";

describe("registered ingestion API", () => {
  it("sends only supplied fields for a partial source update", async () => {
    let received: unknown;
    server.use(
      http.patch(
        `${api}/warehouse/ingestion/sources/:id`,
        async ({ request }) => {
          received = await request.json();
          return HttpResponse.json(fixtures.ingestionSource);
        },
      ),
    );

    await ingestionApi.updateSource("source-001", { status: "DISABLED" });

    expect(received).toEqual({ status: "DISABLED" });
  });

  it("returns bounded test metadata and preserves sanitized server errors", async () => {
    const passed = await ingestionApi.testSource("source-001");
    expect(passed.reachable).toBe(true);
    expect(passed.columns.map((column) => column.name)).toEqual(["sale_id"]);
    expect(passed.targets).toHaveLength(4);

    server.use(
      http.post(`${api}/warehouse/ingestion/sources/:id/test`, () =>
        HttpResponse.json(
          {
            error: {
              code: "INGESTION_SOURCE_INVALID",
              message: "Source validation failed",
              correlationId: "source-test-correlation",
              retryable: false,
              details: { field: "readSql" },
            },
          },
          { status: 422 },
        ),
      ),
    );

    await expect(ingestionApi.testSource("source-001")).rejects.toMatchObject<
      Partial<ApiError>
    >({
      code: "INGESTION_SOURCE_INVALID",
      status: 422,
      correlationId: "source-test-correlation",
    });
  });

  it("rejects invalid column mappings before calling Java", async () => {
    let calls = 0;
    server.use(
      http.post(`${api}/warehouse/ingestion/sources`, () => {
        calls += 1;
        return HttpResponse.json(fixtures.ingestionSource, { status: 201 });
      }),
    );

    const {
      sourceId: _sourceId,
      type: _type,
      status: _status,
      sourceWarehouseId,
      sourceDatasetId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...valid
    } = fixtures.ingestionSource;

    expect(() =>
      ingestionApi.createSource({
        ...valid,
        sourceWarehouseId,
        sourceDatasetId,
        columnTypes: {},
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });

  it("keeps write-only warehouse credential references out of response data", () => {
    const response = WarehouseSchema.parse({
      ...fixtures.warehouses[0],
      ingestionUsername: "nla_pipeline_writer",
      ingestionCredentialReference: "env:PRIVATE_PIPELINE_SECRET",
    });

    expect(response.ingestionUsername).toBe("nla_pipeline_writer");
    expect(response).not.toHaveProperty("ingestionCredentialReference");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { ApiError } from "./client";
import { ingestionApi } from "./ingestionApi";
import { WarehouseSchema, type FileColumn } from "./schema";
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

describe("file ingestion API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const uploadColumns: FileColumn[] = [
    {
      sourceName: "Account Name",
      name: "account_name",
      dataType: "STRING",
      nullable: false,
    },
    {
      sourceName: "Balance",
      name: "balance",
      dataType: "DECIMAL",
      nullable: true,
    },
  ];
  const uploadResponse = {
    id: "upload-live-1",
    fileName: "accounts.csv",
    fileType: "text/csv",
    fileSize: 19,
    rowCount: 2,
    columnCount: 2,
    columns: uploadColumns,
    previewRows: [
      ["North", "12.50"],
      ["South", null],
    ],
    warnings: [],
    sheets: [],
    expiresAt: "2099-01-01T00:00:00Z",
  };

  it("uploads the file as multipart without replacing the browser boundary", async () => {
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestInit = init;
        return Response.json(uploadResponse, { status: 201 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["name,balance\nNorth,12.50"], "accounts.csv", {
      type: "text/csv",
    });
    const result = await ingestionApi.uploadFile({ file, delimiter: "," });
    const form = requestInit?.body as FormData;

    expect(result.columns.map((column) => column.name)).toEqual([
      "account_name",
      "balance",
    ]);
    expect(form.get("file")).toBe(file);
    expect(form.get("delimiter")).toBe(",");
    expect(
      (requestInit?.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
  });

  it("validates edited mappings and starts an immutable run with digest and key", async () => {
    let validationBody: unknown;
    let runBody: unknown;
    server.use(
      http.post(
        `${api}/warehouse/ingestion/files/:uploadId/validate`,
        async ({ request }) => {
          validationBody = await request.json();
          return HttpResponse.json({
            id: "file-plan-1",
            uploadId: "upload-live-1",
            warehouseId: "wh-demo-pg",
            targetSchema: "analytics",
            targetTable: "accounts",
            datasetName: "Accounts Import",
            digest: "sha256:stable-plan",
            status: "VALIDATED",
            fileName: "accounts.csv",
            rowCount: 2,
            columns: uploadColumns,
            previewRows: uploadResponse.previewRows,
            layers: [
              { name: "RAW", schema: "analytics", table: "raw_accounts" },
              { name: "STAGING", schema: "analytics", table: "stage_accounts" },
              {
                name: "WAREHOUSE",
                schema: "analytics",
                table: "warehouse_accounts",
              },
              { name: "MART", schema: "analytics", table: "accounts" },
            ],
            expiresAt: "2099-01-01T00:00:00Z",
            warnings: [],
          });
        },
      ),
      http.post(
        `${api}/warehouse/ingestion/files/runs`,
        async ({ request }) => {
          runBody = await request.json();
          return HttpResponse.json(
            {
              id: "file-run-1",
              sourceKind: "FILE",
              status: "PENDING",
              warehouseId: "wh-demo-pg",
              datasetId: null,
              fileName: "accounts.csv",
              startedAt: "2026-10-20T10:00:00Z",
              completedAt: null,
              rowCount: 2,
              rowsLoaded: 0,
              stages: [
                { name: "RAW", status: "PENDING", rowsLoaded: 0 },
                { name: "STAGING", status: "PENDING", rowsLoaded: 0 },
                { name: "WAREHOUSE", status: "PENDING", rowsLoaded: 0 },
                { name: "MART", status: "PENDING", rowsLoaded: 0 },
              ],
              error: null,
              partialFailure: false,
              createdTables: [],
            },
            { status: 202 },
          );
        },
      ),
    );

    const plan = await ingestionApi.validateFile("upload-live-1", {
      warehouseId: "wh-demo-pg",
      targetSchema: "analytics",
      targetTable: "accounts",
      datasetName: "Accounts Import",
      columns: uploadColumns,
    });
    const run = await ingestionApi.runFile({
      planId: plan.id,
      digest: plan.digest,
      idempotencyKey: "idempotency-1",
    });

    expect(validationBody).toMatchObject({ targetTable: "accounts" });
    expect(run.status).toBe("PENDING");
    expect(runBody).toEqual({
      planId: "file-plan-1",
      digest: "sha256:stable-plan",
      idempotencyKey: "idempotency-1",
    });
  });

  it("rejects a mapping with duplicate target names before Java is called", async () => {
    let calls = 0;
    server.use(
      http.post(`${api}/warehouse/ingestion/files/:uploadId/validate`, () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );

    expect(() =>
      ingestionApi.validateFile("upload-live-1", {
        warehouseId: "wh-demo-pg",
        targetSchema: "analytics",
        targetTable: "accounts",
        datasetName: "Accounts Import",
        columns: [
          uploadColumns[0],
          { ...uploadColumns[1], name: "account_name" },
        ],
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });
});

it("discards an actor-owned upload using an empty204 response", async () => {
  let removed = false;
  server.use(
    http.delete(`${api}/warehouse/ingestion/files/:id`, () => {
      removed = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await ingestionApi.discardFile("file-test");
  expect(removed).toBe(true);
});

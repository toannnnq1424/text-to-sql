import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import * as f from "./fixtures";
const base = "*/api/v1";
export const handlers = [
  http.get(`${base}/warehouses`, () => HttpResponse.json(f.page(f.warehouses))),
  http.get(`${base}/warehouses/:id`, ({ params }) => {
    const w = f.warehouses.find((w) => w.warehouseId === params.id);
    return w
      ? HttpResponse.json({
          ...w,
          host: "localhost",
          port: { POSTGRESQL: 5432, MYSQL: 3306, SQL_SERVER: 1433 }[w.engine],
          database: "analytics",
          defaultSchema: w.engine === "SQL_SERVER" ? "dbo" : "analytics",
          username: "reader",
        })
      : HttpResponse.json(
          {
            error: {
              code: "RESOURCE_NOT_FOUND",
              message: "Warehouse not found",
              correlationId: "test",
              retryable: false,
              details: {},
            },
          },
          { status: 404 },
        );
  }),
  http.get(`${base}/datasets`, ({ request }) =>
    HttpResponse.json(
      f.page(
        f.datasets.filter(
          (d) =>
            !new URL(request.url).searchParams.get("warehouseId") ||
            d.warehouseId ===
              new URL(request.url).searchParams.get("warehouseId"),
        ),
      ),
    ),
  ),
  http.get(`${base}/datasets/:id`, ({ params }) =>
    HttpResponse.json(f.datasets.find((d) => d.datasetId === params.id)),
  ),
  http.get(`${base}/settings`, () => HttpResponse.json(f.settings)),
  http.get(`${base}/platform/summary`, () =>
    HttpResponse.json({
      warehouseCount: 3,
      datasetCount: 3,
      healthyWarehouseCount: 3,
      querySuccessRate: 0.9,
      recentQueries: [f.summary],
      recentEvaluationRuns: [f.evalRun],
      recentIngestionRuns: [f.ingestion],
      systemHealth: "UP",
    }),
  ),
  http.get(`${base}/monitoring/summary`, () => HttpResponse.json(f.monitoring)),
  http.get(`${base}/query/history`, () =>
    HttpResponse.json(f.page([f.summary])),
  ),
  http.post(`${base}/query`, () => HttpResponse.json(f.query, { status: 201 })),
  http.get(`${base}/query/:id/result`, ({ request }) => {
    const u = new URL(request.url),
      p = Number(u.searchParams.get("page") || 1),
      size = Number(u.searchParams.get("pageSize") || 20);
    return HttpResponse.json({
      ...f.query.result,
      page: p,
      pageSize: size,
      rows: p === 1 ? f.query.result!.rows : [],
    });
  }),
  http.get(
    `${base}/query/:id/export.csv`,
    () =>
      new HttpResponse(
        "region,total_revenue\r\nBắc,1000000.00\r\nNam,2000000.00",
        { headers: { "Content-Type": "text/csv" } },
      ),
  ),
  http.get(`${base}/query/:id`, () => HttpResponse.json(f.query)),
  http.post(`${base}/query/:id/saved`, async ({ request }) =>
    HttpResponse.json(
      {
        savedResultId: "saved-001",
        queryId: f.query.queryId,
        name: ((await request.json()) as { name: string }).name,
        createdAt: "2026-10-19T00:00:00Z",
      },
      { status: 201 },
    ),
  ),
  http.get(`${base}/datasets/:id/catalog`, () => HttpResponse.json(f.catalog)),
  http.get(`${base}/datasets/:id/examples`, () =>
    HttpResponse.json(
      f.page([
        {
          question: f.query.question,
          sqlDialect: "POSTGRESQL",
          sql: f.query.generatedSql,
          selectedMetrics: f.query.selectedMetrics,
          selectedDimensions: f.query.selectedDimensions,
          category: "Sales",
        },
      ]),
    ),
  ),
  http.get(`${base}/datasets/:id/tables`, () =>
    HttpResponse.json(f.page([f.table])),
  ),
  http.get(`${base}/datasets/:id/tables/:tableId`, () =>
    HttpResponse.json(f.table),
  ),
  http.get(`${base}/datasets/:id/metrics`, () =>
    HttpResponse.json(f.page([f.metric])),
  ),
  http.get(`${base}/datasets/:id/metrics/:name`, () =>
    HttpResponse.json(f.metric),
  ),
  http.get(`${base}/datasets/:id/dimensions`, () =>
    HttpResponse.json(f.page([f.dimension])),
  ),
  http.get(`${base}/datasets/:id/dimensions/:name`, () =>
    HttpResponse.json(f.dimension),
  ),
  http.get(`${base}/datasets/:id/relationships`, () =>
    HttpResponse.json(f.page([])),
  ),
  http.get(`${base}/warehouse/ingestion/sources`, () =>
    HttpResponse.json(f.page([f.source])),
  ),
  http.get(`${base}/warehouse/ingestion/sources/:id`, () =>
    HttpResponse.json(f.ingestionSource),
  ),
  http.post(`${base}/warehouse/ingestion/sources`, () =>
    HttpResponse.json(f.ingestionSource, { status: 201 }),
  ),
  http.patch(`${base}/warehouse/ingestion/sources/:id`, () =>
    HttpResponse.json(f.ingestionSource),
  ),
  http.post(`${base}/warehouse/ingestion/sources/:id/test`, () =>
    HttpResponse.json(f.sourceTest),
  ),
  http.post(`${base}/warehouse/ingestion/run`, () =>
    HttpResponse.json(f.ingestion, { status: 202 }),
  ),
  http.get(`${base}/warehouse/ingestion/runs`, () =>
    HttpResponse.json(f.page([f.ingestion])),
  ),
  http.get(`${base}/warehouse/ingestion/runs/:id`, () =>
    HttpResponse.json(f.ingestion),
  ),
  http.post(`${base}/import/sql/validate`, () =>
    HttpResponse.json({
      planId: "plan-test-001",
      planDigest: "sha256:test-digest",
      warehouseId: "wh-demo-pg",
      targetSchema: "public",
      sourceDialect: "AUTO_DETECT",
      detectedDialect: "POSTGRESQL",
      targetEngine: "POSTGRESQL",
      mode: "NATIVE",
      statementCount: 2,
      objectCount: 1,
      supportedActions: [
        "CREATE_SCHEMA",
        "CREATE_TABLE",
        "INSERT",
        "CREATE_INDEX",
      ],
      warnings: [],
      unsupportedFeatures: [],
      preview: {
        statements: [
          {
            index: 1,
            kind: "CREATE_TABLE",
            objectName: "imported_tracks",
            summary: "Create table imported_tracks",
          },
        ],
        schemas: [
          {
            name: "public",
            tables: [
              {
                name: "imported_tracks",
                constraints: [],
                indexes: [],
                columns: [
                  {
                    name: "track_id",
                    dataType: "INTEGER",
                    nullable: false,
                    primaryKey: true,
                    identity: true,
                    unique: false,
                    hasDefault: false,
                    defaultValue: null,
                  },
                ],
              },
            ],
          },
        ],
      },
      expiresAt: "2099-01-01T00:00:00Z",
    }),
  ),
  http.post(`${base}/import/sql/runs`, () =>
    HttpResponse.json(
      {
        runId: "sql-import-run-001",
        planId: "plan-test-001",
        warehouseId: "wh-demo-pg",
        targetSchema: "public",
        sourceDialect: "AUTO_DETECT",
        targetEngine: "POSTGRESQL",
        status: "RUNNING",
        statementCount: 2,
        completedStatements: 0,
        rowsAffected: 0,
        createdAt: "2026-10-20T00:00:00Z",
        completedAt: null,
        steps: [],
        error: null,
      },
      { status: 202 },
    ),
  ),
  http.get(`${base}/import/sql/runs`, () => HttpResponse.json(f.page([]))),
  http.get(`${base}/import/sql/runs/:id`, () =>
    HttpResponse.json({
      runId: "sql-import-run-001",
      planId: "plan-test-001",
      warehouseId: "wh-demo-pg",
      targetSchema: "public",
      sourceDialect: "AUTO_DETECT",
      targetEngine: "POSTGRESQL",
      status: "SUCCESS",
      statementCount: 2,
      completedStatements: 2,
      rowsAffected: 16,
      createdAt: "2026-10-20T00:00:00Z",
      completedAt: "2026-10-20T00:00:02Z",
      steps: [
        {
          index: 1,
          kind: "CREATE_TABLE",
          objectName: "imported_tracks",
          status: "SUCCESS",
          rowsAffected: 0,
          error: null,
        },
      ],
      error: null,
    }),
  ),
  http.get(`${base}/evaluation/test-suites`, () =>
    HttpResponse.json(f.page([f.suite])),
  ),
  http.post(`${base}/evaluation/run`, () =>
    HttpResponse.json(f.evalRun, { status: 202 }),
  ),
  http.get(`${base}/evaluation/runs`, () =>
    HttpResponse.json(f.page([f.evalRun])),
  ),
  http.get(`${base}/evaluation/runs/:id`, () => HttpResponse.json(f.evalRun)),
  http.get(`${base}/evaluation/results`, () =>
    HttpResponse.json(f.page([f.evalCase])),
  ),
  http.get(`${base}/evaluation/results/:id`, () =>
    HttpResponse.json(f.evalCase),
  ),
  http.post(`${base}/warehouses`, async ({ request }) => {
    const input = (await request.json()) as object;
    return HttpResponse.json(
      { ...f.warehouses[0], ...input, warehouseId: "wh-new" },
      { status: 201 },
    );
  }),
  http.patch(`${base}/warehouses/:id`, async ({ request, params }) =>
    HttpResponse.json({
      ...f.warehouses.find((w) => w.warehouseId === params.id),
      ...((await request.json()) as object),
    }),
  ),
  http.post(`${base}/warehouses/:id/test`, ({ params }) =>
    HttpResponse.json({
      warehouseId: params.id,
      reachable: true,
      latencyMs: 12,
      checkedAt: "2026-10-19T00:00:00Z",
      error: null,
    }),
  ),
  http.post(`${base}/warehouses/:id/discover`, ({ params }) =>
    HttpResponse.json(
      {
        runId: "discovery-001",
        warehouseId: params.id,
        status: "PENDING",
        createdAt: "2026-10-19T00:00:00Z",
      },
      { status: 202 },
    ),
  ),
  http.get(`${base}/warehouses/:id/discoveries/:runId`, ({ params }) =>
    HttpResponse.json({
      runId: params.runId,
      warehouseId: params.id,
      status: "SUCCESS",
      createdAt: "2026-10-19T00:00:00Z",
      completedAt: "2026-10-19T00:00:01Z",
      metadata: { schemas: [{ name: "analytics", tables: [f.table] }] },
      error: null,
    }),
  ),
  http.post(`${base}/datasets`, async ({ request }) =>
    HttpResponse.json(
      {
        ...f.datasets[0],
        ...((await request.json()) as object),
        datasetId: "ds-new",
      },
      { status: 201 },
    ),
  ),
  http.patch(`${base}/settings`, async ({ request }) =>
    HttpResponse.json({ ...f.settings, ...((await request.json()) as object) }),
  ),
];
export const server = setupServer(...handlers);

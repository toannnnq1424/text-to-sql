import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import source from "../../../docs/contracts/examples/ai-request.json" with { type: "json" };
import { renderApp, readyDataset } from "../test/render";
import { server } from "../test/server";
import * as fixtures from "../test/fixtures";
import {
  SemanticDocumentSchema,
  type PipelineInput,
} from "../api/workbenchSchema";

const api = "*/api/v1";
const document = SemanticDocumentSchema.parse(source.semanticContext);
const datasetId = fixtures.datasets[0].datasetId;
const knowledgeStatus = {
  datasetId,
  status: "READY",
  schemaItems: 12,
  exampleCount: 1,
  embeddingModel: "local-embedding-test",
  indexedAt: "2026-10-20T12:00:00Z",
  semanticVersion: document.semanticVersion,
  schemaVersion: document.schemaVersion,
  error: null,
};
const example = {
  entryId: "test-example",
  question: "Approved question",
  sql: "SELECT 1",
  sqlDialect: "POSTGRESQL",
  source: "approved-query",
};
const transform = {
  columns: [{ name: "region", expression: "input.region" }],
  filter: "",
  groupBy: [],
};
const pipeline = {
  pipelineId: "pipe-test",
  name: "Actual source pipeline",
  sourceWarehouseId: fixtures.warehouses[0].warehouseId,
  sourceDatasetId: datasetId,
  sourceTable: { schema: fixtures.table.schema, name: fixtures.table.name },
  targetWarehouseId: fixtures.warehouses[0].warehouseId,
  targetSchema: "test_import",
  targetTable: "mapped_data",
  datasetName: "Mapped Dataset",
  stages: { staging: transform, warehouse: transform, mart: transform },
  maxRows: 1000,
  maxBytes: 5242880,
  timeoutSeconds: 30,
  status: "ACTIVE",
};
const preview = {
  valid: true,
  sourceColumns: [{ name: "region", dataType: "STRING", nullable: false }],
  stages: [
    {
      name: "MART",
      columns: [{ name: "region_key", dataType: "STRING", nullable: false }],
      rows: [{ region_key: "North" }],
      rowCount: 1,
      sql: "SELECT region AS region_key FROM input",
    },
  ],
  targetTables: [
    { stage: "MART", schema: "test_import", name: "mapped_data_mart" },
  ],
  warnings: ["Preview uses a bounded source sample."],
};
function semanticHandlers() {
  server.use(
    http.get(`${api}/datasets/:id/semantic-model`, () =>
      HttpResponse.json(document),
    ),
  );
}
function pipelineHandlers() {
  server.use(
    http.get(`${api}/pipelines`, () => HttpResponse.json(fixtures.page([]))),
    http.get(`${api}/pipelines/runs`, () =>
      HttpResponse.json(fixtures.page([])),
    ),
    http.get(`${api}/warehouse/ingestion/files/targets`, () =>
      HttpResponse.json({
        warehouseId: fixtures.warehouses[0].warehouseId,
        namespaces: ["test_import"],
      }),
    ),
  );
}

describe("business semantic workbench", () => {
  it("loads active definitions, validates before activation, and invalidates validation after edits", async () => {
    semanticHandlers();
    const validate = vi.fn();
    const save = vi.fn();
    server.use(
      http.post(
        `${api}/datasets/:id/semantic-model/validate`,
        async ({ request }) => {
          validate(await request.json());
          return HttpResponse.json({
            valid: true,
            semanticVersion: "workbench-test",
            metricCount: document.metrics.length,
            dimensionCount: document.dimensions.length,
            diagnostics: [],
          });
        },
      ),
      http.put(`${api}/datasets/:id/semantic-model`, async ({ request }) => {
        save(await request.json());
        return HttpResponse.json(fixtures.datasets[0]);
      }),
    );
    renderApp("/semantic");
    await readyDataset();
    const user = userEvent.setup();
    expect(
      await screen.findByDisplayValue(document.metrics[0].name),
    ).toBeVisible();
    const activate = screen.getByRole("button", { name: "Lưu và kích hoạt" });
    expect(activate).toBeDisabled();
    await user.clear(screen.getByLabelText(/^Phiên bản ngữ nghĩa/));
    await user.type(
      screen.getByLabelText(/^Phiên bản ngữ nghĩa/),
      "workbench-test",
    );
    await user.click(screen.getByRole("button", { name: "Kiểm tra cấu hình" }));
    await waitFor(() => expect(activate).toBeEnabled());
    expect(validate.mock.calls[0][0]).toMatchObject({
      semanticVersion: "workbench-test",
      schemaVersion: document.schemaVersion,
      tables: document.tables,
    });
    await user.type(screen.getByLabelText("Múi giờ IANA"), " ");
    expect(activate).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it("sends structured selections rather than expressions and renders the semantic query result", async () => {
    semanticHandlers();
    const execute = vi.fn();
    server.use(
      http.post(`${api}/datasets/:id/semantic-query`, async ({ request }) => {
        execute(await request.json());
        return HttpResponse.json({
          ...fixtures.query,
          executionMode: "SEMANTIC",
          model: "semantic-compiler",
        });
      }),
    );
    renderApp("/semantic");
    await readyDataset();
    const user = userEvent.setup();
    const metrics = await screen.findByLabelText("Chỉ số (tối đa 10)");
    await user.selectOptions(metrics, document.metrics[0].name);
    await user.click(screen.getByRole("button", { name: "Chạy phân tích" }));
    await screen.findByText("Compiler ngữ nghĩa");
    expect(execute).toHaveBeenCalledWith({
      metrics: [document.metrics[0].name],
      dimensions: [],
      filters: [],
      limit: 100,
    });
    expect(
      screen.getByRole("button", { name: "Mở phân tích nghiệp vụ" }),
    ).toBeVisible();
  });
  it("keeps viewer definitions read only and blocks execution controls", async () => {
    semanticHandlers();
    renderApp("/semantic", ["VIEWER"]);
    await readyDataset();
    expect(await screen.findByLabelText(/^Phiên bản ngữ nghĩa/)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Kiểm tra cấu hình" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Chạy phân tích" }),
    ).toBeDisabled();
  });
});
describe("knowledge workbench", () => {
  it("shows retrieved server metadata and only exposes deletion of approved examples", async () => {
    server.use(
      http.get(`${api}/datasets/:id/knowledge`, () =>
        HttpResponse.json(knowledgeStatus),
      ),
      http.get(`${api}/datasets/:id/knowledge/examples`, () =>
        HttpResponse.json({
          items: [
            example,
            {
              ...example,
              entryId: "config-example",
              source: "semantic-config",
              question: "Configured question",
            },
          ],
          total: 2,
        }),
      ),
      http.post(`${api}/datasets/:id/knowledge/search`, async ({ request }) => {
        expect(await request.json()).toEqual({
          question: "Question for vector retrieval",
          limit: 5,
        });
        return HttpResponse.json({
          strategy: "vector",
          question: "Question for vector retrieval",
          hits: [
            {
              itemType: "metric",
              name: "Actual metric from API",
              modelName: "actual_table",
              text: "Source metadata returned by vector search",
              distance: 0.125,
            },
          ],
          examples: [example],
          embeddingModel: knowledgeStatus.embeddingModel,
        });
      }),
    );
    renderApp("/knowledge");
    await readyDataset();
    const user = userEvent.setup();
    await screen.findByText("local-embedding-test");
    await user.type(
      screen.getByLabelText("Câu hỏi cần phân tích"),
      "Question for vector retrieval",
    );
    await user.click(screen.getByRole("button", { name: "Tra cứu" }));
    expect(
      await screen.findByRole("heading", { name: "Actual metric from API" }),
    ).toBeVisible();
    expect(
      screen.getByText("Source metadata returned by vector search"),
    ).toBeVisible();
    expect(screen.getByText(/Khoảng cách 0.1250/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Bỏ ví dụ" })).toHaveLength(1);
  });
  it("disables retrieval on stale metadata without inventing results", async () => {
    server.use(
      http.get(`${api}/datasets/:id/knowledge`, () =>
        HttpResponse.json({ ...knowledgeStatus, status: "STALE" }),
      ),
    );
    renderApp("/knowledge", ["VIEWER"]);
    await readyDataset();
    expect(
      await screen.findByText(/Schema hoặc định nghĩa đã thay đổi/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Tra cứu" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Lập lại chỉ mục" }),
    ).not.toBeInTheDocument();
  });
});
describe("transformation pipeline workbench", () => {
  it("creates a source-derived four-layer draft, previews actual returned schemas, and requires revalidation after changes", async () => {
    pipelineHandlers();
    const inspect = vi.fn();
    server.use(
      http.post(`${api}/pipelines/preview`, async ({ request }) => {
        inspect(await request.json());
        return HttpResponse.json(preview);
      }),
    );
    renderApp("/pipelines");
    await readyDataset();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tạo pipeline" }));
    await user.type(
      screen.getByLabelText("Tên pipeline"),
      "Source derived pipeline",
    );
    await user.type(
      screen.getByLabelText("Tên dataset kết quả"),
      "Mapped Dataset",
    );
    await user.click(screen.getByRole("button", { name: "Bảng nguồn" }));
    await user.click(
      await screen.findByRole("option", {
        name: `${fixtures.table.schema}.${fixtures.table.name}`,
      }),
    );
    await user.selectOptions(
      screen.getByLabelText("Namespace có quyền tạo bảng"),
      "test_import",
    );
    await user.type(
      screen.getByLabelText(/^Tiền tố tên bảng mới/),
      "mapped_data",
    );
    await user.click(
      screen.getByRole("button", { name: "Thiết lập chuyển đổi" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Kiểm tra và xem trước" }),
    );
    expect(await screen.findByText("North")).toBeVisible();
    expect(
      screen.getByRole("columnheader", { name: /region_key/ }),
    ).toBeVisible();
    const input = inspect.mock.calls[0][0] as PipelineInput;
    expect(input.sourceTable).toEqual({
      schema: fixtures.table.schema,
      name: fixtures.table.name,
    });
    expect(input.stages.staging.columns.map((column) => column.name)).toEqual(
      fixtures.table.columns.map((column) => column.name),
    );
    expect(screen.getByRole("button", { name: "Lưu pipeline" })).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "1. Chọn nguồn và đích" }),
    );
    await user.type(screen.getByLabelText(/^Tiền tố tên bảng mới/), "_changed");
    await user.click(
      screen.getByRole("button", { name: "3. Xem trước và lưu" }),
    );
    expect(screen.getByRole("button", { name: "Lưu pipeline" })).toBeDisabled();
    expect(screen.queryByText("North")).not.toBeInTheDocument();
  });
  it("shows persisted stage failures and partial-created objects without success claims", async () => {
    pipelineHandlers();
    const run = {
      runId: "run-failed",
      pipelineId: pipeline.pipelineId,
      status: "FAILED",
      datasetId: null,
      startedAt: "2026-10-20T12:00:00Z",
      completedAt: "2026-10-20T12:01:00Z",
      stages: [
        { name: "RAW", status: "SUCCESS", rowsWritten: 9 },
        { name: "STAGING", status: "FAILED", rowsWritten: 0 },
      ],
      createdTables: [{ schema: "test_import", name: "partial_raw" }],
      error: {
        code: "QUERY_ERROR",
        message: "Actual transformation failure",
        correlationId: "test-correlation",
        retryable: false,
        details: {},
      },
      partialFailure: true,
    };
    server.use(
      http.get(`${api}/pipelines/runs`, () =>
        HttpResponse.json(fixtures.page([run])),
      ),
      http.get(`${api}/pipelines/runs/:id`, () => HttpResponse.json(run)),
    );
    renderApp("/pipelines", ["VIEWER"]);
    await readyDataset();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "run-failed" }));
    expect(
      await screen.findByText("Actual transformation failure"),
    ).toBeVisible();
    expect(screen.getByText("test_import.partial_raw")).toBeVisible();
    expect(screen.getByText(/Lần chạy còn các bảng đã được tạo/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Tạo pipeline" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Mart đã được đăng ký/)).not.toBeInTheDocument();
  });
});

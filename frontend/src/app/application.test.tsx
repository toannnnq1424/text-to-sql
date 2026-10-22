import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { renderApp, readyDataset } from "../test/render";
import { importApi } from "../api/importApi";
import { warehouseSelectionKey } from "./warehouseSelection";
import { server } from "../test/server";
import * as f from "../test/fixtures";
const api = "*/api/v1";
describe("shell and context", () => {
  it("does not label rejected planned SQL as successfully executed", async () => {
    server.use(
      http.get(`${api}/query/:id`, () =>
        HttpResponse.json({
          ...f.query,
          status: "VALIDATION_ERROR",
          result: null,
          error: {
            code: "SQL_VALIDATION_ERROR",
            message: "Planned statement was rejected",
            correlationId: "rejected-plan",
            retryable: false,
            details: {},
          },
        }),
      ),
    );
    renderApp("/query/rejected/sql");
    await readyDataset();
    expect(
      await screen.findByText("SQL của lần truy vấn chưa thành công"),
    ).toBeVisible();
    expect(
      screen.queryByText("SQL đã thực thi", { exact: true }),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["/", "Trang chủ"],
    ["/query", "Truy vấn"],
    ["/query/q/sql", "Truy vấn"],
    ["/history/q/technical", "Lịch sử truy vấn"],
    ["/catalog/metrics/total_revenue", "Data Catalog"],
    ["/warehouses", "Warehouses"],
    ["/quality", "Chất lượng dữ liệu"],
    ["/evaluation", "Đánh giá"],
    ["/ingestion", "Nạp dữ liệu"],
    ["/import/sql", "SQL Import"],
    ["/monitoring", "Giám sát"],
    ["/settings", "Cài đặt"],
  ])("keeps sidebar active on %s", async (path, label) => {
    renderApp(path);
    await readyDataset();
    const sidebar = screen.getByRole("complementary", {
      name: "Điều hướng chính",
    });
    await waitFor(() =>
      expect(
        within(sidebar).getByRole("link", { name: label }),
      ).toHaveAttribute("aria-current", "page"),
    );
    expect(sidebar.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  });
  it("switches warehouse/engine/dataset without keeping old query context", async () => {
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Câu hỏi phân tích"), "Old question");
    await user.click(screen.getByRole("button", { name: "Warehouse" }));
    await user.click(await screen.findByRole("option", { name: /Demo MYSQL/ }));
    await waitFor(() =>
      expect(document.querySelector(".sidebar-status")).toHaveTextContent(
        "ACTIVE",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Warehouse" }),
      ).toHaveTextContent("MySQL"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Câu hỏi phân tích")).toHaveValue(""),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dataset" })).toHaveTextContent(
        "Commerce demo",
      ),
    );
  });
  it("validates, previews and confirms an allowlisted SQL import plan", async () => {
    const user = userEvent.setup();
    const validatePlan = vi.spyOn(importApi, "validate").mockResolvedValue({
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
                constraints: [
                  {
                    kind: "PRIMARY_KEY",
                    name: "pk_imported_tracks",
                    columns: ["track_id"],
                    referenceSchema: "",
                    referenceTable: "",
                    referenceColumns: [],
                  },
                ],
                indexes: [
                  {
                    name: "ix_imported_tracks_name",
                    columns: ["name"],
                    unique: false,
                  },
                ],
                columns: [
                  {
                    name: "track_id",
                    dataType: "INTEGER",
                    nullable: false,
                    primaryKey: true,
                    identity: true,
                    unique: false,
                    hasDefault: true,
                    defaultValue: "1",
                  },
                ],
              },
            ],
          },
        ],
      },
      expiresAt: "2099-01-01T00:00:00Z",
    });
    renderApp("/import/sql");
    await readyDataset();
    await user.selectOptions(
      screen.getByLabelText("Dialect nguồn"),
      "AUTO_DETECT",
    );
    await screen.findByRole("option", {
      name: "Demo POSTGRESQL · PostgreSQL",
    });
    await user.selectOptions(
      screen.getByLabelText("Warehouse đích"),
      "wh-demo-pg",
    );
    await user.type(screen.getByLabelText("Schema đích"), "public");
    await user.upload(
      screen.getByLabelText("File SQL (tối đa 2 MiB)"),
      new File(
        ["CREATE TABLE imported_tracks (track_id INTEGER PRIMARY KEY);"],
        "tracks.sql",
        {
          type: "text/plain",
        },
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Kiểm tra và xem trước" }),
    );
    expect(await screen.findByText("Kế hoạch đã xác thực")).toBeInTheDocument();
    expect(validatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDialect: "AUTO_DETECT",
        warehouseId: "wh-demo-pg",
        targetSchema: "public",
      }),
    );
    validatePlan.mockRestore();
    expect(
      screen.getByText("Create table imported_tracks"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Xem lại và xác nhận" }),
    );
    const firstDialog = screen.getByRole("alertdialog", {
      name: "Xác nhận thực thi kế hoạch?",
    });
    expect(firstDialog.tagName).toBe("DIALOG");
    expect(firstDialog).toHaveAttribute(
      "aria-describedby",
      "import-confirm-copy",
    );
    fireEvent(
      firstDialog,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Xem lại và xác nhận" }),
    ).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: "Xem lại và xác nhận" }),
    );
    const dialog = screen.getByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Xác nhận import" }),
    );
    expect(await screen.findByText("Chi tiết lần import")).toBeInTheDocument();
    expect(await screen.findByText("sql-import-run-001")).toBeInTheDocument();
    expect(await screen.findAllByText("SUCCESS")).toHaveLength(2);
  });
  it("restores warehouse context only for the signed-in subject", async () => {
    let posted: unknown;
    server.use(
      http.post(`${api}/query`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(f.query, { status: 201 });
      }),
    );
    sessionStorage.setItem(
      warehouseSelectionKey("test-user"),
      JSON.stringify({
        warehouseId: "wh-demo-pg",
        datasetId: "ds-commerce-pg",
      }),
    );
    sessionStorage.setItem(
      warehouseSelectionKey("other-user"),
      JSON.stringify({
        warehouseId: "wh-demo-mysql",
        datasetId: "ds-commerce-mysql",
      }),
    );

    renderApp("/query", ["ADMIN"], "other-user");
    await readyDataset();

    expect(screen.getByRole("button", { name: "Warehouse" })).toHaveTextContent(
      "MySQL",
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Câu hỏi phân tích"), "Đếm bản ghi");
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() =>
      expect(posted).toMatchObject({
        warehouseId: "wh-demo-mysql",
        datasetId: "ds-commerce-mysql",
      }),
    );
  });
  it("reports API failures instead of fabricating an empty list", async () => {
    server.use(http.get(`${api}/warehouses`, () => HttpResponse.error()));
    renderApp("/query");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không kết nối được Java API",
    );
  });
  it("does not allow a viewer to run a query or register warehouses", async () => {
    renderApp("/query", ["VIEWER"]);
    await readyDataset();
    expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
  });
  it("shows disabled/schema mismatch dataset states and keeps submit disabled", async () => {
    server.use(
      http.get(`${api}/datasets/:id`, () =>
        HttpResponse.json({ ...f.datasets[0], status: "INVALID_SCHEMA" }),
      ),
    );
    renderApp("/query");
    await waitFor(() =>
      expect(document.querySelector(".sidebar-status")).toHaveTextContent(
        "INVALID_SCHEMA",
      ),
    );
    expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
    expect(
      screen.getByText(/Kiểm tra metadata trước khi truy vấn/),
    ).toBeVisible();
  });
});
describe("query workflow", () => {
  it("submits only the shared request fields and displays the real API response", async () => {
    let posted: unknown;
    server.use(
      http.post(`${api}/query`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(f.query, { status: 201 });
      }),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Câu hỏi phân tích"),
      "Tổng doanh thu theo khu vực?",
    );
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: f.query.question }),
    ).toBeVisible();
    expect(posted).toEqual({
      warehouseId: f.warehouses[0].warehouseId,
      datasetId: f.datasets[0].datasetId,
      question: f.query.question,
      mode: "AUTO",
    });
  });
  it("validates blank and oversized questions before network submission", async () => {
    let calls = 0;
    server.use(
      http.post(`${api}/query`, () => {
        calls++;
        return HttpResponse.json(f.query);
      }),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    expect(
      await screen.findByText("Nhập câu hỏi từ 1 đến 1000 ký tự."),
    ).toBeVisible();
    expect(calls).toBe(0);
  });
  it("keeps errors with queryId actionable, without retrying the POST", async () => {
    let calls = 0;
    server.use(
      http.post(`${api}/query`, () => {
        calls++;
        return HttpResponse.json(
          {
            error: {
              code: "QUERY_TIMEOUT",
              message: "Truy vấn hết thời gian.",
              correlationId: "timeout-test",
              retryable: false,
              details: { queryId: "qry-timed-out" },
            },
          },
          { status: 504 },
        );
      }),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Câu hỏi phân tích"), "Question");
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    expect(await screen.findByText("Truy vấn hết thời gian.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Xem trạng thái truy vấn" }),
    ).toHaveAttribute("href", "/query/qry-timed-out/technical");
    expect(calls).toBe(1);
  });
  it("disables repeated submissions while a query is pending", async () => {
    server.use(
      http.post(`${api}/query`, async () => {
        await delay(120);
        return HttpResponse.json(f.query);
      }),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Câu hỏi phân tích"), "Question");
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    expect(screen.getByRole("button", { name: "Đang xử lý…" })).toBeDisabled();
    await screen.findByRole("heading", { level: 1, name: f.query.question });
  });
  it("clears input without clearing the selected dataset", async () => {
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Câu hỏi phân tích"), "Question");
    await user.click(screen.getByRole("button", { name: "Xóa" }));
    expect(screen.getByLabelText("Câu hỏi phân tích")).toHaveValue("");
    expect(document.querySelector(".sidebar-status")).toHaveTextContent(
      "ACTIVE",
    );
  });
  it("shows empty suggestions from the current dataset", async () => {
    server.use(
      http.get(`${api}/datasets/:id/question-suggestions`, () =>
        HttpResponse.json(f.page([])),
      ),
    );
    renderApp("/query");
    await readyDataset();
    expect(await screen.findByText("Chưa có câu hỏi mẫu")).toBeVisible();
    expect(
      screen.queryByText("Tổng doanh thu theo khu vực?"),
    ).not.toBeInTheDocument();
  });
  it("does not navigate to an old result after switching context mid-request", async () => {
    server.use(
      http.post(`${api}/query`, async () => {
        await delay(150);
        return HttpResponse.json(f.query);
      }),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Câu hỏi phân tích"), "Old context");
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    await user.click(screen.getByRole("button", { name: "Warehouse" }));
    await user.click(await screen.findByRole("option", { name: /Demo MYSQL/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Câu hỏi phân tích")).toHaveValue(""),
    );
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(
      screen.queryByRole("heading", { level: 1, name: f.query.question }),
    ).not.toBeInTheDocument();
  });
});
describe("results, history, metadata", () => {
  it("shows the warehouse that produced a result when another warehouse is selected", async () => {
    const mysqlQuery = {
      ...f.query,
      warehouseId: f.warehouses[1].warehouseId,
      datasetId: f.datasets[1].datasetId,
      sqlDialect: "MYSQL" as const,
    };
    server.use(
      http.get(`${api}/query/:id`, () => HttpResponse.json(mysqlQuery)),
    );
    renderApp("/query/q/overview");
    const source = await screen.findByLabelText("Nguồn truy vấn");
    expect(source).toHaveTextContent("Commerce demo");
    expect(source).toHaveTextContent("Demo MYSQL");
    expect(source).toHaveTextContent("MySQL");
  });
  it("renders dialect, SQL and source tables without requiring the current dataset", async () => {
    renderApp("/query/q/sql");
    expect(
      await screen.findByRole("heading", { name: "Truy vấn SQL" }),
    ).toBeVisible();
    expect(screen.getByLabelText("SQL đã thực thi")).toHaveTextContent(
      "SELECT",
    );
    expect(screen.getAllByText("PostgreSQL").length).toBeGreaterThan(0);
    expect(screen.getByText("analytics.fact_sales")).toBeVisible();
  });
  it("renders rejected queries without showing result data as success", async () => {
    server.use(
      http.get(`${api}/query/:id`, () =>
        HttpResponse.json({
          ...f.query,
          status: "REJECTED",
          result: null,
          chart: null,
          generatedSql: null,
          error: {
            code: "SQL_SECURITY_ERROR",
            message: "Unsafe query rejected",
            correlationId: "rejected",
            retryable: false,
            details: {},
          },
        }),
      ),
    );
    renderApp("/query/q/overview");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unsafe query rejected",
    );
    expect(screen.getByText("Chưa có kết quả dữ liệu")).toBeVisible();
    expect(screen.queryByText("1.000.000,00")).not.toBeInTheDocument();
  });
  it("shows all technical identifiers and null/error states safely", async () => {
    renderApp("/query/q/technical");
    expect(
      await screen.findByRole("heading", { name: "Thông tin kỹ thuật" }),
    ).toBeVisible();
    expect(screen.getByText("Correlation ID")).toBeVisible();
    expect(screen.getByText("Truncated")).toBeVisible();
  });
  it("allows saving a named snapshot via API", async () => {
    renderApp("/query/q/sql");
    await screen.findByRole("heading", { name: "Truy vấn SQL" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Lưu kết quả" }));
    const modal = screen.getByRole("dialog", { name: "Lưu kết quả truy vấn" });
    await user.type(within(modal).getByLabelText("Tên kết quả"), "My result");
    await user.click(
      within(modal).getByRole("button", { name: "Lưu kết quả" }),
    );
    expect(await screen.findByText("Đã lưu kết quả: My result")).toBeVisible();
  });
  it("sends history filters and UTC date bounds to Java", async () => {
    let url = "";
    server.use(
      http.get(`${api}/query/history`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(f.page([]));
      }),
    );
    renderApp("/history");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Tìm kiếm"), "month");
    await user.selectOptions(screen.getByLabelText("Engine"), "SQL_SERVER");
    await user.type(screen.getByLabelText("Từ ngày (UTC+07)"), "2026-10-19");
    await user.type(screen.getByLabelText("Đến ngày (UTC+07)"), "2026-10-19");
    await user.click(screen.getByRole("button", { name: "Áp dụng" }));
    await waitFor(() =>
      expect(new URL(url).searchParams.get("engine")).toBe("SQL_SERVER"),
    );
    expect(new URL(url).searchParams.get("search")).toBe("month");
    expect(new URL(url).searchParams.get("from")).toBe(
      "2026-10-18T17:00:00.000Z",
    );
  });
  it.each([
    "/catalog/tables/table-sales",
    "/catalog/metrics/total_revenue",
    "/catalog/dimensions/region",
  ])("loads metadata detail %s", async (path) => {
    renderApp(path);
    await readyDataset();
    expect(
      await screen.findByRole("heading", { name: "Thông tin chi tiết" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getAllByText(
          path.includes("metrics")
            ? "SUM(analytics.fact_sales.net_amount)"
            : path.includes("dimensions")
              ? "analytics.fact_sales.region"
              : "Sale identifier",
        ).length,
      ).toBeGreaterThan(0),
    );
  });
});
describe("warehouse and job management", () => {
  it("validates and registers a MySQL warehouse using a credential reference", async () => {
    let posted: unknown;
    server.use(
      http.post(`${api}/warehouses`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          {
            ...f.warehouses[1],
            ...(posted as object),
            warehouseId: "new-mysql",
          },
          { status: 201 },
        );
      }),
    );
    renderApp("/warehouses");
    await readyDataset();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Thêm warehouse" }));
    const modal = screen.getByRole("dialog", { name: "Đăng ký warehouse" });
    await user.type(
      within(modal).getByLabelText("Tên warehouse"),
      "Analytics MySQL",
    );
    await user.selectOptions(within(modal).getByLabelText("Engine"), "MYSQL");
    expect(within(modal).getByLabelText("Port")).toHaveValue(3306);
    await user.type(within(modal).getByLabelText("Host"), "mysql.internal");
    await user.type(
      within(modal).getByLabelText("Database / Catalog"),
      "analytics",
    );
    await user.type(
      within(modal).getByLabelText("Username (read-only)"),
      "reader",
    );
    await user.type(
      within(modal).getByLabelText(/Credential reference/),
      "secret/mysql",
    );
    await user.click(
      within(modal).getByRole("button", { name: "Đăng ký warehouse" }),
    );
    await waitFor(() =>
      expect(posted).toMatchObject({
        engine: "MYSQL",
        port: 3306,
        credentialReference: "secret/mysql",
      }),
    );
    expect(posted).not.toHaveProperty("password");
  });
  it("tests and discovers real metadata endpoints", async () => {
    renderApp("/warehouses");
    await readyDataset();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Demo POSTGRESQL" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Test Connection" }),
    );
    expect(await screen.findByText(/Kết nối thành công/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Discover Metadata" }));
    expect(
      await screen.findByRole("button", { name: "Đăng ký dataset" }),
    ).toBeVisible();
  });
  it("disables mutation controls for viewers", async () => {
    renderApp("/warehouses", ["VIEWER"]);
    await readyDataset();
    expect(
      screen.getByRole("button", { name: "Thêm warehouse" }),
    ).toBeDisabled();
  });
  it("runs registered ingestion with a unique idempotency key", async () => {
    let posted: unknown;
    server.use(
      http.post(`${api}/warehouse/ingestion/run`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(f.ingestion, { status: 202 });
      }),
    );
    renderApp("/ingestion");
    await readyDataset();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Nguồn warehouse" }));
    await user.click(screen.getByRole("button", { name: "Nguồn dữ liệu" }));
    await user.click(
      await screen.findByRole("option", { name: /Registered CSV source/ }),
    );
    await user.click(screen.getByRole("button", { name: "Chạy pipeline mới" }));
    await waitFor(() =>
      expect(posted).toMatchObject({
        warehouseId: f.warehouses[0].warehouseId,
        datasetId: f.datasets[0].datasetId,
        sourceId: "source-001",
      }),
    );
    expect((posted as { idempotencyKey: string }).idempotencyKey).toMatch(
      /[\w-]{20,}/,
    );
    expect(
      await screen.findByRole("heading", { name: "Chi tiết lần nạp dữ liệu" }),
    ).toBeVisible();
  });
  it("shows the admin source wizard before asking for technical configuration", async () => {
    const user = userEvent.setup();
    renderApp("/ingestion");
    await readyDataset();
    await user.click(screen.getByRole("tab", { name: "Nguồn warehouse" }));
    await user.click(
      await screen.findByRole("button", { name: /Đăng ký nguồn/ }),
    );
    expect(
      screen.getByRole("dialog", { name: "Thêm nguồn dữ liệu" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Bảng cần lấy dữ liệu" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Alias 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SELECT nguồn")).not.toBeInTheDocument();
  });

  it("hides source registration actions from non-admin roles", async () => {
    renderApp("/ingestion", ["OPERATOR"]);
    await readyDataset();
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "Nguồn warehouse" }));
    expect(
      await screen.findByText(/Chỉ quản trị viên mới được đăng ký/),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Đăng ký nguồn/ })).toBeNull();
  });
  it("shows evaluation SQL comparison and actual bounded results", async () => {
    renderApp("/evaluation/results/case-result-001?runId=eval-001");
    await readyDataset();
    expect(
      await screen.findByRole("heading", { name: "Chi tiết test case" }),
    ).toBeVisible();
    expect(await screen.findByText("Expected SQL")).toBeVisible();
    expect(screen.getByText("Generated SQL")).toBeVisible();
  });
  it("renders partial ingestion and sanitized error details", async () => {
    server.use(
      http.get(`${api}/warehouse/ingestion/runs/:id`, () =>
        HttpResponse.json({
          ...f.ingestion,
          status: "PARTIAL",
          error: {
            code: "INGESTION_PARTIAL",
            message: "2 rejected rows",
            correlationId: "partial-test",
            retryable: false,
            details: {},
          },
        }),
      ),
    );
    renderApp("/ingestion/ing-001");
    await readyDataset();
    expect(await screen.findByText("2 rejected rows")).toBeVisible();
  });
});

import { test, expect, type Page } from "@playwright/test";
import * as f from "../src/test/fixtures";
async function javaTestBoundary(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/api/v1", "");
    let body: unknown;
    if (path === "/session")
      body = {
        subject: "e2e-admin",
        name: "E2E Admin",
        roles: ["ADMIN"],
        local: true,
      };
    else if (path === "/warehouses") body = f.page(f.warehouses);
    else if (/^\/warehouses\/[^/]+$/.test(path)) {
      const w = f.warehouses.find(
        (w) => w.warehouseId === decodeURIComponent(path.split("/")[2]),
      );
      body = {
        ...w,
        host: "localhost",
        port: 5432,
        database: "analytics",
        username: "reader",
        defaultSchema: "analytics",
      };
    } else if (path === "/datasets")
      body = f.page(
        f.datasets.filter(
          (d) =>
            !url.searchParams.get("warehouseId") ||
            d.warehouseId === url.searchParams.get("warehouseId"),
        ),
      );
    else if (/^\/datasets\/[^/]+$/.test(path))
      body = f.datasets.find((d) => d.datasetId === path.split("/")[2]);
    else if (path.endsWith("/catalog")) body = f.catalog;
    else if (path.endsWith("/examples"))
      body = f.page([
        {
          question: f.query.question,
          sqlDialect: "POSTGRESQL",
          sql: f.query.generatedSql,
          selectedMetrics: f.query.selectedMetrics,
          selectedDimensions: f.query.selectedDimensions,
          category: "Sales",
        },
      ]);
    else if (path.endsWith("/tables")) body = f.page([f.table]);
    else if (/\/tables\//.test(path)) body = f.table;
    else if (path.endsWith("/metrics")) body = f.page([f.metric]);
    else if (/\/metrics\//.test(path)) body = f.metric;
    else if (path.endsWith("/dimensions")) body = f.page([f.dimension]);
    else if (/\/dimensions\//.test(path)) body = f.dimension;
    else if (path.endsWith("/relationships")) body = f.page([]);
    else if (path === "/settings") body = f.settings;
    else if (path === "/monitoring/summary") body = f.monitoring;
    else if (path === "/platform/summary")
      body = {
        warehouseCount: 3,
        datasetCount: 3,
        healthyWarehouseCount: 3,
        querySuccessRate: 0.9,
        recentQueries: [f.summary],
        recentEvaluationRuns: [f.evalRun],
        recentIngestionRuns: [f.ingestion],
        systemHealth: "UP",
      };
    else if (path === "/query/history") body = f.page([f.summary]);
    else if (path.endsWith("/export.csv"))
      return route.fulfill({
        contentType: "text/csv",
        body: "region,total_revenue\r\nBắc,1000000.00",
      });
    else if (path.endsWith("/result"))
      body = {
        ...f.query.result,
        page: Number(url.searchParams.get("page") || 1),
        pageSize: Number(url.searchParams.get("pageSize") || 20),
      };
    else if (path.startsWith("/query/")) body = f.query;
    else if (path === "/warehouse/ingestion/files/runs") body = f.page([]);
    else if (path === "/warehouse/ingestion/files/targets")
      body = {
        warehouseId: url.searchParams.get("warehouseId"),
        namespaces: [],
      };
    else if (path === "/warehouse/ingestion/runs") body = f.page([f.ingestion]);
    else if (path.startsWith("/warehouse/ingestion/runs/")) body = f.ingestion;
    else if (path === "/warehouse/ingestion/sources") {
      body =
        route.request().method() === "POST"
          ? f.ingestionSource
          : f.page([f.source]);
    } else if (/^\/warehouse\/ingestion\/sources\/[^/]+\/test$/.test(path))
      body = f.sourceTest;
    else if (/^\/warehouse\/ingestion\/sources\/[^/]+$/.test(path))
      body = f.ingestionSource;
    else if (path === "/import/sql/validate")
      body = {
        planId: "plan-demo-001",
        planDigest: "digest-demo-001",
        warehouseId: f.warehouses[0].warehouseId,
        targetSchema: "analytics",
        sourceDialect: "POSTGRESQL",
        detectedDialect: "POSTGRESQL",
        targetEngine: "POSTGRESQL",
        mode: "NATIVE",
        statementCount: 1,
        objectCount: 1,
        supportedActions: ["CREATE_SCHEMA", "CREATE_TABLE", "CREATE_INDEX"],
        warnings: [],
        unsupportedFeatures: [],
        preview: {
          statements: [
            {
              index: 1,
              kind: "CREATE_TABLE",
              objectName: "analytics.imported_rows",
              summary: "Create table analytics.imported_rows",
            },
          ],
          schemas: [
            {
              name: "analytics",
              tables: [
                {
                  name: "imported_rows",
                  constraints: [],
                  indexes: [],
                  columns: [
                    {
                      name: "id",
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
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      };
    else if (path === "/import/sql/runs") body = f.page([]);
    else if (path.startsWith("/import/sql/runs/"))
      body = {
        runId: "import-demo-001",
        planId: "plan-demo-001",
        warehouseId: f.warehouses[0].warehouseId,
        targetSchema: "analytics",
        sourceDialect: "POSTGRESQL",
        targetEngine: "POSTGRESQL",
        status: "SUCCESS",
        statementCount: 1,
        completedStatements: 1,
        rowsAffected: 0,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        steps: [],
        error: null,
      };
    else if (path === "/evaluation/test-suites") body = f.page([f.suite]);
    else if (path === "/evaluation/test-suites") body = f.page([f.suite]);
    else if (path === "/evaluation/runs") body = f.page([f.evalRun]);
    else if (path.startsWith("/evaluation/runs/")) body = f.evalRun;
    else if (path === "/evaluation/results") body = f.page([f.evalCase]);
    else if (path.startsWith("/evaluation/results/")) body = f.evalCase;
    else
      throw new Error(
        `Unexpected Java API request in browser test: ${route.request().method()} ${path}`,
      );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}
for (const width of [1728, 1440, 1024, 390]) {
  test(`query layout and navigation at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1280 });
    await javaTestBoundary(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/query");
    await expect(page.getByLabel("Câu hỏi phân tích")).toBeVisible();
    await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
    if (width <= 1100) {
      await page.getByRole("button", { name: "Mở menu" }).click();
      await expect(page.locator(".sidebar.open")).toBeVisible();
      await page
        .locator(".sidebar")
        .getByRole("link", { name: "Data Catalog" })
        .click();
      await expect(page).toHaveURL(/\/catalog\/overview/);
      await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
      await page.goto("/query");
    } else {
      expect(
        await page
          .locator(".sidebar")
          .evaluate((e) => getComputedStyle(e).position),
      ).toBe("fixed");
      await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveText(
        "Truy vấn",
      );
    }
    await page.screenshot({
      path: testInfo.outputPath(`query-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });
}
test("SQL, result tabs, table export and history retain their own navigation", async ({
  page,
}) => {
  await javaTestBoundary(page);
  await page.goto("/query/qry-demo-001/data");
  await expect(
    page.getByRole("heading", { name: "Dữ liệu kết quả" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1.000.000,00", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .locator(".result-table")
    .getByRole("button", { name: "Xuất CSV" })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page.getByRole("link", { name: "SQL", exact: true }).click();
  await expect(page.getByLabel("SQL", { exact: true })).toContainText("SELECT");
  await page.goto("/history/qry-demo-001/technical");
  await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveText(
    "Lịch sử truy vấn",
  );
  await expect(
    page.getByRole("heading", { name: "Thông tin kỹ thuật" }),
  ).toBeVisible();
});
test("compact generated SQL is formatted into readable lines in result details", async ({
  page,
}) => {
  await javaTestBoundary(page);
  const sourceSql =
    "SELECT r.region_name, SUM(o.total_amount) AS revenue FROM orders o JOIN regions r ON o.region_id = r.region_id WHERE o.order_date >= '2024-09-01' AND o.order_date < '2024-10-01' GROUP BY r.region_name ORDER BY revenue DESC;";
  await page.route("**/api/v1/query/qry-demo-001", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...f.query, generatedSql: sourceSql }),
    }),
  );
  await page.goto("/query/qry-demo-001/sql");
  const sqlBlock = page.getByLabel("SQL", { exact: true });
  await expect(sqlBlock).toContainText("GROUP BY r.region_name");
  await expect(sqlBlock.locator(".sql-line")).toHaveCount(9);
  await expect(sqlBlock.locator(".sql-string").first()).toContainText(
    "2024-09-01",
  );
  await expect(sqlBlock.locator(".sql-keyword").first()).toHaveText("SELECT");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1729);
});

for (const width of [1440, 390]) {
  test(`registered source editor fits the ${width}px ingestion layout`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await javaTestBoundary(page);
    await page.goto("/ingestion");
    await page.getByRole("tab", { name: "Nguồn warehouse" }).click();
    await expect(
      page.getByRole("heading", { name: "Nguồn pipeline đã đăng ký" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Đăng ký nguồn/ })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Đăng ký nguồn pipeline" }),
    ).toBeVisible();
    await expect(page.getByLabel("Warehouse đích")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Dataset nguồn" }),
    ).toBeVisible();
    await expect(page.getByLabel("SELECT nguồn")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`ingestion-source-editor-${width}.png`),
      fullPage: true,
    });
  });
}
test("engine switching clears the old question and selects only a matching dataset", async ({
  page,
}) => {
  await javaTestBoundary(page);
  await page.goto("/query");
  await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
  await page.getByLabel("Câu hỏi phân tích").fill("Old context");
  await page.getByRole("button", { name: "Warehouse", exact: true }).click();
  await page.getByRole("option", { name: /Demo MYSQL/ }).click();
  await expect(
    page.getByRole("button", { name: "Warehouse", exact: true }),
  ).toContainText("MySQL");
  await expect(page.getByLabel("Câu hỏi phân tích")).toHaveValue("");
  await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
});
test("system notification menu displays monitoring API data", async ({
  page,
}) => {
  await javaTestBoundary(page);
  await page.goto("/query");
  await page.getByRole("button", { name: "Thông báo hệ thống" }).click();
  const menu = page.locator(".notification-menu");
  await expect(menu).toContainText("Warehouse · Demo POSTGRESQL");
  await expect(menu).toContainText("Lỗi LLM");
  await expect(menu).toContainText("1");
  await expect(menu.getByRole("link", { name: "Mở giám sát" })).toBeVisible();
});
test("SQL Import validates a script and presents a bounded plan for review", async ({
  page,
}) => {
  await javaTestBoundary(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/import/sql");
  await expect(page.getByRole("heading", { name: "Import SQL" })).toBeVisible();
  await page.getByLabel("Schema đích").fill("analytics");
  await page.getByLabel(/File SQL/).setInputFiles({
    name: "warehouse.sql",
    mimeType: "application/sql",
    buffer: Buffer.from("CREATE TABLE imported_rows (id INTEGER PRIMARY KEY);"),
  });
  await page.getByRole("button", { name: "Kiểm tra và xem trước" }).click();
  await expect(
    page.getByRole("heading", { name: "Kế hoạch đã xác thực" }),
  ).toBeVisible();
  await expect(page.locator(".import-schema")).toContainText("imported_rows");
  await expect(
    page.getByRole("button", { name: "Xem lại và xác nhận" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1441);
});
test("offline Java is an error state, not fabricated success", async ({
  page,
}) => {
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        subject: "e2e-admin",
        name: "E2E Admin",
        roles: ["ADMIN"],
        local: true,
      }),
    }),
  );
  await page.route("**/api/v1/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/session")) {
      return route.fallback();
    }
    return route.abort("connectionfailed");
  });
  await page.goto("/query");
  await expect(page.getByRole("alert").first()).toContainText(
    "Không kết nối được Java API",
  );
  await expect(
    page.getByRole("button", { name: "Gửi", exact: true }),
  ).toBeDisabled();
});
for (const path of [
  "/",
  "/catalog/tables/table-sales",
  "/catalog/metrics/total_revenue",
  "/history",
  "/warehouses",
  "/ingestion/ing-001",
  "/evaluation/results/case-result-001?runId=eval-001",
  "/monitoring",
  "/settings",
])
  test(`renders ${path} without browser errors`, async ({ page }, testInfo) => {
    await javaTestBoundary(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1728, height: 1280 });
    await page.goto(path);
    await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
    await expect(page.locator(".loading")).toHaveCount(0);
    await expect(page.getByText("Không thể hiển thị ứng dụng")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("page.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });

for (const width of [1024, 390]) {
  test(`field-heavy screens stay inside the viewport at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1100 });
    await javaTestBoundary(page);
    for (const path of [
      "/warehouses",
      "/ingestion/ing-001",
      "/evaluation/results/case-result-001?runId=eval-001",
      "/settings",
    ]) {
      await page.goto(path);
      await expect(page.locator(".loading")).toHaveCount(0);
      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflowing, `${path} overflows at ${width}px`).toBe(false);
    }
  });
}

for (const width of [1440, 390]) {
  test(`file upload entry fits the ${width}px ingestion layout`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await javaTestBoundary(page);
    await page.goto("/ingestion");
    await expect(
      page.getByRole("heading", { name: "Nạp file dữ liệu" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Nạp file" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByLabel("Chọn file dữ liệu", { exact: true }),
    ).toBeAttached();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

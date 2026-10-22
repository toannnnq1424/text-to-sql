#!/usr/bin/env node
/** Actual recorded UI/accessibility audit. No response interception or online model calls. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium, expect } = require("@playwright/test");
const axePath = require.resolve("axe-core/axe.min.js");
const origin = "http://127.0.0.1:4173";
const api = "http://127.0.0.1:8085/api/v1";
const output = path.join(
  root,
  ".local/compose-app/readiness-browser",
  process.env.NLA_AUDIT_LABEL || "current",
);
await mkdir(output, { recursive: true });
const token = execFileSync(
  "python3",
  [
    "-c",
    'import sys;sys.path.insert(0,"infra/local");import compose;print(compose.service_token())',
  ],
  { cwd: root, encoding: "utf8" },
).trim();
const claims = JSON.parse(
  Buffer.from(token.split(".")[1], "base64url").toString(),
);
const user = JSON.stringify({
  access_token: token,
  token_type: "Bearer",
  scope: "openid profile email",
  expires_at: claims.exp,
  profile: {
    ...claims,
    name: claims.name || "Local Admin",
    roles: claims.realm_access?.roles || claims.roles || [],
  },
});
async function backend(endpoint) {
  const response = await fetch(api + endpoint, {
    headers: { Authorization: "Bearer " + token },
  });
  const body = await response.json();
  assert.ok(
    response.ok,
    `API setup HTTP${response.status} ${body.error?.code || ""}`,
  );
  return body;
}
const warehouseId = process.env.NLA_AUDIT_WAREHOUSE_ID || "";
const datasetId = process.env.NLA_AUDIT_DATASET_ID || "";
const extraQueryIds = (process.env.NLA_AUDIT_QUERY_IDS || "")
  .split(",")
  .filter(Boolean);
const history = await backend("/query/history?pageSize=100&status=SUCCESS");
const query = history.items.find((item) => item.status === "SUCCESS");
assert.ok(
  query,
  "A real successful query is required for result-route evidence",
);
const routes = [
  "/",
  "/query",
  "/history",
  "/catalog/overview",
  "/catalog/tables",
  "/catalog/metrics",
  "/catalog/dimensions",
  "/catalog/relationships",
  "/catalog/examples",
  "/semantic",
  "/knowledge",
  "/pipelines",
  "/quality",
  "/evaluation",
  "/ingestion",
  "/import/sql",
  "/warehouses",
  "/monitoring",
  "/settings",
  ...[
    "overview",
    "data",
    "visualization",
    "sql",
    "explanation",
    "technical",
  ].map((tab) => `/query/${query.queryId}/${tab}`),
  `/history/${query.queryId}/technical`,
  ...extraQueryIds.flatMap((id) =>
    ["overview", "data", "visualization", "sql", "technical"].map(
      (tab) => `/query/${id}/${tab}`,
    ),
  ),
  "/query/readiness-missing-query/data",
  "/readiness-missing-page",
];
if (datasetId) {
  const [tables, metrics, dimensions, ingestions, evaluations, imports] =
    await Promise.all([
      backend(`/datasets/${datasetId}/tables?pageSize=1`),
      backend(`/datasets/${datasetId}/metrics?pageSize=1`),
      backend(`/datasets/${datasetId}/dimensions?pageSize=1`),
      backend("/warehouse/ingestion/runs?pageSize=1"),
      backend("/evaluation/results?pageSize=1"),
      backend("/import/sql/runs?pageSize=1"),
    ]);
  if (tables.items[0])
    routes.push(
      `/catalog/tables/${encodeURIComponent(tables.items[0].tableId)}`,
    );
  if (metrics.items[0])
    routes.push(
      `/catalog/metrics/${encodeURIComponent(metrics.items[0].name)}`,
    );
  if (dimensions.items[0])
    routes.push(
      `/catalog/dimensions/${encodeURIComponent(dimensions.items[0].name)}`,
    );
  if (ingestions.items[0])
    routes.push(`/ingestion/${ingestions.items[0].runId}`);
  if (evaluations.items[0])
    routes.push(`/evaluation/results/${evaluations.items[0].resultId}`);
  if (imports.items[0]) routes.push(`/import/sql/${imports.items[0].runId}`);
}
const browser = await chromium.launch();
const report = {
  mocked: false,
  requestedContext: { warehouseId, datasetId },
  authentication:
    "Actual signed local OIDC service identity seeded outside browser UI; no password entry or token shown in video",
  onlineProviderTested: false,
  modelRequests: 0,
  routes: [],
  keyboards: {},
  videos: [],
  errors: [],
};
const contexts = [];
async function recorded(width, label) {
  const context = await browser.newContext({
    viewport: { width, height: 1100 },
    recordVideo: {
      dir: path.join(output, "videos"),
      size: { width: 1440, height: 1100 },
    },
  });
  contexts.push({ context, label });
  await context.addInitScript(
    ({ user, warehouseId, datasetId, subject }) => {
      if (location.origin === "http://127.0.0.1:4173") {
        if (warehouseId && datasetId)
          sessionStorage.setItem(
            `nla-context:${encodeURIComponent(subject)}`,
            JSON.stringify({ warehouseId, datasetId }),
          );
        sessionStorage.setItem(
          "oidc.user:http://127.0.0.1:8180/realms/nla:nla-web",
          user,
        );
      }
    },
    { user, warehouseId, datasetId, subject: claims.sub },
  );
  await context.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.__qaResponses = [];
    window.fetch = async (...args) => {
      const response = await original(...args);
      const request = args[0];
      const url = new URL(
        typeof request === "string" ? request : request.url || String(request),
        location.href,
      );
      const method = args[1]?.method || request.method || "GET";
      if (
        method === "POST" &&
        /\/api\/v1\/(warehouses|datasets|warehouse\/ingestion|import\/sql|pipelines)(\/|$)/.test(
          url.pathname,
        )
      )
        response
          .clone()
          .json()
          .then((body) =>
            window.__qaResponses.push({
              receivedAt: Date.now(),
              path: url.pathname,
              status: response.status,
              body,
            }),
          )
          .catch(() => {});
      return response;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(error.name));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/v1\/(query|datasets\/[^/]+\/semantic-assist)$/.test(
        new URL(request.url()).pathname,
      )
    )
      report.modelRequests++;
  });
  return page;
}
async function audit(page, route, width, navigate = true) {
  if (navigate) await page.goto(origin + route);
  await expect(
    page.getByRole("button", { name: "Đăng xuất", exact: true }),
  ).toBeVisible();
  await page.locator("main h1").waitFor();
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      helpUrl: v.helpUrl,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    }));
  });
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    h1Count: document.querySelectorAll("main h1").length,
  }));
  const file =
    route.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_/, "") || "home";
  await page.screenshot({
    path: path.join(output, `${file}-${width}.png`),
    fullPage: false,
    animations: "disabled",
  });
  report.routes.push({ route, viewport: width, ...dimensions, violations });
  assert.ok(
    dimensions.documentWidth <= width + 1,
    `Page overflow ${route}: ${dimensions.documentWidth}/${width}`,
  );
  assert.equal(dimensions.h1Count, 1, `Expected one main heading on ${route}`);
}
async function apiResponse(response, phase) {
  const body = await response.json();
  assert.ok(
    response.ok(),
    `${phase}: HTTP${response.status()} ${body.error?.code || ""}`,
  );
  return body;
}
function responseFor(page, suffix, method = "POST", readBody = true) {
  const startedAt = Date.now();
  return page
    .waitForResponse(
      (response) =>
        response.request().method() === method &&
        new URL(response.url()).pathname.endsWith(suffix),
      { timeout: 60000 },
    )
    .then(async (response) => {
      let body;
      if (readBody) {
        await page.waitForFunction(
          (suffix) =>
            window.__qaResponses?.some(
              (item) =>
                item.path.endsWith(suffix.path) &&
                item.receivedAt >= suffix.startedAt,
            ),
          { path: suffix, startedAt },
        );
        body = await page.evaluate(
          (suffix) =>
            window.__qaResponses
              .filter(
                (item) =>
                  item.path.endsWith(suffix.path) &&
                  item.receivedAt >= suffix.startedAt,
              )
              .at(-1).body,
          { path: suffix, startedAt },
        );
      }
      return {
        ok: () => response.ok(),
        status: () => response.status(),
        json: async () => body,
      };
    });
}
async function registerSources(page) {
  const definitions = [
    {
      engine: "POSTGRESQL",
      label: "PostgreSQL",
      host: "postgres",
      port: "5432",
      schema: "analytics",
      ref: "PG",
    },
    {
      engine: "MYSQL",
      label: "MySQL",
      host: "mysql",
      port: "3306",
      schema: "nla_adventureworks_dw",
      ref: "MYSQL",
    },
    {
      engine: "SQL_SERVER",
      label: "SQL Server",
      host: "sqlserver",
      port: "1433",
      schema: "analytics",
      ref: "MSSQL",
    },
  ];
  report.registration = [];
  const manifestPath = path.join(
    root,
    ".local/compose-app/readiness-ui-registry.json",
  );
  let manifest = [];
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const definition of definitions) {
    const name = `AdventureWorksDW / ${definition.label} / official subset`;
    let entry = manifest.find((item) => item.engine === definition.engine);
    await page.goto(origin + "/warehouses");
    if (!entry) {
      await page
        .getByRole("button", { name: "Thêm warehouse", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Đăng ký warehouse",
        exact: true,
      });
      await dialog.locator('[name="name"]').fill(name);
      await dialog
        .getByRole("combobox", { name: "Engine", exact: true })
        .selectOption(definition.engine);
      await dialog.locator('[name="host"]').fill(definition.host);
      await dialog
        .getByRole("spinbutton", { name: "Port", exact: true })
        .fill(definition.port);
      await dialog.locator('[name="database"]').fill("nla_adventureworks_dw");
      await dialog.locator('[name="defaultSchema"]').fill(definition.schema);
      await dialog.locator('[name="username"]').fill("nla_awdw_reader");
      await dialog
        .locator('[name="credentialReference"]')
        .fill(`env:NLA_SAMPLE_AWDW_${definition.ref}_PASSWORD`);
      await audit(
        page,
        `/warehouses#register-${definition.engine}`,
        1440,
        false,
      );
      const created = responseFor(page, "/warehouses");
      await dialog
        .getByRole("button", { name: "Đăng ký warehouse", exact: true })
        .click();
      const warehouse = await apiResponse(
        await created,
        "register warehouse " + definition.engine,
      );
      entry = {
        engine: definition.engine,
        warehouseId: warehouse.warehouseId,
        name,
      };
      manifest.push(entry);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
        mode: 0o600,
      });
      await expect(dialog).not.toBeVisible();
    } else {
      await page
        .getByRole("textbox", { name: "Tìm kiếm", exact: true })
        .fill(name);
      await page.getByRole("button", { name: "Áp dụng", exact: true }).click();
      await page.getByRole("button", { name, exact: true }).click();
    }
    const connection = responseFor(
      page,
      `/warehouses/${entry.warehouseId}/test`,
      "POST",
      false,
    );
    await page
      .getByRole("button", { name: "Test Connection", exact: true })
      .click();
    const test = await connection;
    assert.ok(
      test.ok(),
      `Test connection ${definition.engine} HTTP${test.status()}`,
    );
    await expect(
      page.getByText("Kết nối thành công", { exact: false }),
    ).toBeVisible();
    const discovery = responseFor(
      page,
      `/warehouses/${entry.warehouseId}/discover`,
    );
    await page
      .getByRole("button", { name: "Discover Metadata", exact: true })
      .click();
    const accepted = await apiResponse(
      await discovery,
      "discover warehouse " + definition.engine,
    );
    entry.discoveryRunId = accepted.runId;
    await expect(
      page.getByRole("button", { name: "Đăng ký dataset", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await audit(
      page,
      `/warehouses#discovered-${definition.engine}`,
      1440,
      false,
    );
    if (!entry.datasetId) {
      await page
        .getByRole("button", { name: "Đăng ký dataset", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Đăng ký dataset",
        exact: true,
      });
      await dialog
        .locator('[name="name"]')
        .fill(`AdventureWorksDW sales / ${definition.label}`);
      await dialog
        .locator('[name="description"]')
        .fill(
          "Official Microsoft AdventureWorksDW2019: twelve fact/dimension source tables with all rows, ported for the current engine. Reader-only analytical dataset; provenance and source checksums are recorded in repository documentation.",
        );
      await dialog.locator('[name="semanticVersion"]').fill("1.0.0");
      await dialog.locator('[name="schemaVersion"]').fill("1.0.0");
      const checkboxes = dialog.getByRole("checkbox", {
        name: new RegExp(`^${definition.schema}\\.`),
      });
      entry.tableCount = await checkboxes.count();
      assert.equal(entry.tableCount, 12);
      for (const checkbox of await checkboxes.all()) await checkbox.check();
      await audit(
        page,
        `/warehouses#dataset-allowlist-${definition.engine}`,
        1440,
        false,
      );
      const created = responseFor(page, "/datasets");
      await dialog
        .getByRole("button", { name: "Đăng ký dataset", exact: true })
        .click();
      const dataset = await apiResponse(
        await created,
        "register dataset " + definition.engine,
      );
      entry.datasetId = dataset.datasetId;
      entry.datasetName = dataset.name;
      await expect(dialog).not.toBeVisible();
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
        mode: 0o600,
      });
    }
    await page.getByRole("button", { name: "Warehouse", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Tìm Warehouse", exact: true })
      .fill(name);
    await page
      .getByRole("listbox", { name: "Danh sách Warehouse", exact: true })
      .getByRole("option")
      .filter({ hasText: name })
      .click();
    await page.getByRole("button", { name: "Dataset", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Tìm Dataset", exact: true })
      .fill(entry.datasetName);
    await page
      .getByRole("listbox", { name: "Danh sách Dataset", exact: true })
      .getByRole("option")
      .filter({ hasText: entry.datasetName })
      .click();
    await audit(page, "/catalog/tables", 1440);
    await page.getByRole("button", { name: "Dataset", exact: true }).click();
    await expect(
      page
        .getByRole("listbox", { name: "Danh sách Dataset", exact: true })
        .getByRole("option")
        .filter({ hasText: entry.datasetName }),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    report.registration.push({
      ...entry,
      status: "PASS",
      registrationMethod: "Recorded React UI → Java; no API POST setup",
    });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
  }
}
async function ingestFiles(page) {
  const registry = JSON.parse(
    await readFile(path.join(root, ".local/compose-app/registry.json"), "utf8"),
  );
  const manifestPath = path.join(
    root,
    process.env.NLA_AUDIT_MANIFEST
      ? `.local/compose-app/${path.basename(process.env.NLA_AUDIT_MANIFEST)}`
      : process.env.NLA_AUDIT_BULK === "true"
        ? ".local/compose-app/readiness-ui-bulk-ingestion.json"
        : ".local/compose-app/readiness-ui-ingestion.json",
  );
  let manifest = [];
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  report.ingestion = [];
  if (process.env.NLA_AUDIT_MODE === "formats") {
    await previewFormats(page);
    return;
  }
  const formats = [
    "csv",
    "tsv",
    "txt",
    "json",
    "jsonl",
    "ndjson",
    "xlsx",
    "parquet",
    "feather",
    "arrow",
    "ipc",
    "orc",
    "avro",
  ];
  const bulk = process.env.NLA_AUDIT_BULK === "true";
  const expectedRows = bulk ? 60398 : 606;
  const expectedColumns = bulk ? 17 : 11;
  for (const [index, entry] of registry
    .filter((entry) =>
      process.env.NLA_AUDIT_ENGINE
        ? entry.engine === process.env.NLA_AUDIT_ENGINE
        : !bulk || entry.engine === "POSTGRESQL",
    )
    .entries()) {
    const source = path.join(
      root,
      `.local/adventureworks/ui-files/${path.basename(process.env.NLA_AUDIT_FILE || (bulk ? "FactInternetSales.csv" : "DimProduct.csv"))}`,
    );
    let item = manifest.find(
      (item) => item.engine === entry.engine && item.kind === "file",
    );
    if (item?.status === "SUCCESS") {
      report.ingestion.push({ ...item, status: "ALREADY_RECORDED_SUCCESS" });
      continue;
    }
    const table = `readiness_product_${entry.engine.toLowerCase()}_${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;
    item = {
      engine: entry.engine,
      kind: "file",
      targetTable: table,
      warehouseId: entry.warehouseId,
      sourceFile: source,
    };
    manifest.push(item);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await page.goto(origin + "/ingestion");
    await page.getByRole("button", { name: "Warehouse", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Tìm Warehouse", exact: true })
      .fill(`Chinook / ${entry.engine} / Compose`);
    await page
      .getByRole("listbox", { name: "Danh sách Warehouse", exact: true })
      .getByRole("option")
      .filter({ hasText: `Chinook / ${entry.engine} / Compose` })
      .click();
    await page.getByRole("button", { name: "Dataset", exact: true }).click();
    await page
      .getByRole("listbox", { name: "Danh sách Dataset", exact: true })
      .getByRole("option")
      .filter({ hasText: `Chinook / ${entry.engine}` })
      .first()
      .click();
    const upload = responseFor(page, "/warehouse/ingestion/files");
    await page
      .getByLabel("Chọn file dữ liệu", { exact: true })
      .setInputFiles(source);
    const parsed = await apiResponse(
      await upload,
      "file upload " + entry.engine,
    );
    assert.equal(parsed.rowCount, expectedRows);
    assert.equal(parsed.columnCount, expectedColumns);
    item.uploadId = parsed.id;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await expect(
      page.getByRole("heading", {
        name: "Ánh xạ cột được phát hiện",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Warehouse đích", exact: true })
      .selectOption(entry.warehouseId);
    const namespace = page.getByRole("combobox", {
      name: "Namespace / schema",
      exact: true,
    });
    await expect(namespace).toBeEnabled({ timeout: 60000 });
    await namespace.selectOption("nla_import");
    await page.getByLabel("Bảng đích", { exact: true }).fill(table);
    await page
      .getByLabel("Tên dataset", { exact: true })
      .fill(
        `AdventureWorks ${bulk ? "internet sales fact" : "product"} file / ${entry.engine}`,
      );
    await audit(page, `/ingestion#file-preview-${entry.engine}`, 1440, false);
    const planResponse = responseFor(
      page,
      `/warehouse/ingestion/files/${item.uploadId}/validate`,
    );
    await page
      .getByRole("button", { name: "Kiểm tra và tạo kế hoạch", exact: true })
      .click();
    const plan = await apiResponse(
      await planResponse,
      "file plan " + entry.engine,
    );
    item.planId = plan.id;
    await expect(
      page.getByRole("heading", { name: "Kế hoạch đã xác thực", exact: true }),
    ).toBeVisible();
    await audit(page, `/ingestion#file-plan-${entry.engine}`, 1440, false);
    const runResponse = responseFor(page, "/warehouse/ingestion/files/runs");
    await page
      .getByRole("button", { name: "Xác nhận và nạp dữ liệu", exact: true })
      .click();
    const accepted = await apiResponse(
      await runResponse,
      "file run " + entry.engine,
    );
    item.runId = accepted.id;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await expect(
      page.locator(".file-run-overview").getByText("SUCCESS", { exact: true }),
    ).toBeVisible({ timeout: 300000 });
    await expect(
      page.locator(".file-ingestion-layers .stage-success"),
    ).toHaveCount(4);
    item.datasetId = (
      await page
        .locator(".file-ingestion-dataset-link code")
        .first()
        .textContent()
    ).trim();
    item.status = "SUCCESS";
    await audit(page, `/ingestion#file-success-${entry.engine}`, 1440, false);
    await page
      .locator(".file-ingestion-dataset-link")
      .getByRole("link", { name: "Mở Data Catalog" })
      .click();
    await expect(
      page.getByText(table + "_mart", { exact: true }).first(),
    ).toBeVisible();
    await audit(page, `/catalog#file-dataset-${entry.engine}`, 1440, false);
    report.ingestion.push({
      ...item,
      rows: expectedRows,
      columns: expectedColumns,
      stages: 4,
      method: "Recorded React file input → Java → parser → physical warehouse",
    });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
  }
}

async function previewFormats(page) {
  report.formatPreviews = [];
  for (const extension of [
    "csv",
    "tsv",
    "txt",
    "json",
    "jsonl",
    "ndjson",
    "xlsx",
    "parquet",
    "feather",
    "arrow",
    "ipc",
    "orc",
    "avro",
  ]) {
    await page.goto(origin + "/ingestion");
    const response = responseFor(page, "/warehouse/ingestion/files");
    await page
      .getByLabel("Chọn file dữ liệu", { exact: true })
      .setInputFiles(
        path.join(
          root,
          `.local/adventureworks/ui-files/DimProduct.${extension}`,
        ),
      );
    const preview = await apiResponse(
      await response,
      "format preview " + extension,
    );
    assert.equal(preview.rowCount, 606);
    assert.equal(preview.columnCount, 11);
    await expect(
      page.getByRole("heading", {
        name: "Ánh xạ cột được phát hiện",
        exact: true,
      }),
    ).toBeVisible();
    await audit(page, `/ingestion#preview-${extension}`, 1440, false);
    report.formatPreviews.push({
      extension,
      rows: preview.rowCount,
      columns: preview.columnCount,
      status: "PASS",
      persisted: false,
      uploadId: preview.id,
    });
    const discarded = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith(
          `/warehouse/ingestion/files/${preview.id}`,
        ) && r.request().method() === "DELETE",
    );
    await page
      .getByRole("button", { name: "Đặt lại", exact: true })
      .first()
      .click();
    assert.equal((await discarded).status(), 204);
  }
}

async function importSqlFiles(page) {
  const registry = JSON.parse(
    await readFile(path.join(root, ".local/compose-app/registry.json"), "utf8"),
  );
  const fixtures = JSON.parse(
    await readFile(
      path.join(
        root,
        ".local/adventureworks/ui-files/sql-import-manifest.json",
      ),
      "utf8",
    ),
  );
  const manifestPath = path.join(
    root,
    ".local/compose-app/readiness-ui-sql-import.json",
  );
  let manifest = [];
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  report.sqlImports = [];
  for (const fixture of fixtures.exports) {
    let item = manifest.find((item) => item.engine === fixture.engine);
    if (item?.status === "SUCCESS") {
      report.sqlImports.push({ ...item, status: "ALREADY_RECORDED_SUCCESS" });
      continue;
    }
    const entry = registry.find((entry) => entry.engine === fixture.engine);
    item = {
      engine: fixture.engine,
      warehouseId: entry.warehouseId,
      targetSchema: fixture.schema,
      targetTable: fixture.table,
      sourceFile: fixture.path,
    };
    manifest.push(item);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await page.goto(origin + "/import/sql");
    await page
      .getByRole("combobox", { name: /^Warehouse đích/ })
      .selectOption(entry.warehouseId);
    await page
      .getByRole("combobox", { name: /^Dialect nguồn/ })
      .selectOption(fixture.engine);
    await page
      .getByRole("textbox", { name: "Schema đích", exact: true })
      .fill(fixture.schema);
    await page
      .getByLabel("File SQL (tối đa 2 MiB)")
      .setInputFiles(fixture.path);
    const validateResponse = responseFor(page, "/import/sql/validate");
    await page
      .getByRole("button", { name: "Kiểm tra và xem trước", exact: true })
      .click();
    const plan = await apiResponse(
      await validateResponse,
      "SQL validate " + fixture.engine,
    );
    assert.equal(plan.unsupportedFeatures.length, 0);
    item.planId = plan.planId;
    await expect(
      page.getByRole("heading", { name: "Kế hoạch đã xác thực", exact: true }),
    ).toBeVisible();
    await page.locator(".import-schema details summary").first().click();
    await audit(page, `/import/sql#validated-${fixture.engine}`, 1440, false);
    const confirmation = page.getByRole("button", {
      name: "Xem lại và xác nhận",
      exact: true,
    });
    await confirmation.click();
    const dialog = page.getByRole("alertdialog", {
      name: "Xác nhận thực thi kế hoạch?",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(confirmation).toBeFocused();
    await confirmation.click();
    await audit(page, `/import/sql#confirm-${fixture.engine}`, 1440, false);
    const runResponse = responseFor(page, "/import/sql/runs");
    await dialog
      .getByRole("button", { name: "Xác nhận import", exact: true })
      .click();
    const run = await apiResponse(
      await runResponse,
      "SQL run " + fixture.engine,
    );
    item.runId = run.runId;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await expect(
      page.locator(".dataset-title").getByText("SUCCESS", { exact: true }),
    ).toBeVisible({ timeout: 120000 });
    item.status = "SUCCESS";
    await audit(page, `/import/sql#success-${fixture.engine}`, 1440, false);
    report.sqlImports.push({
      ...item,
      sourceRows: 606,
      confirmationEscapeFocus: "PASS",
      method:
        "Recorded SQL file input → validate → preview → explicit confirmation → import",
    });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
  }
}

async function chooseSelector(page, label, text) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("textbox", { name: `Tìm ${label}`, exact: true })
    .fill(text);
  await page
    .getByRole("listbox", { name: `Danh sách ${label}`, exact: true })
    .getByRole("option")
    .filter({ hasText: text })
    .first()
    .click();
}
async function runWarehousePipeline(page) {
  const sources = JSON.parse(
    await readFile(
      path.join(root, ".local/compose-app/readiness-ui-registry.json"),
      "utf8",
    ),
  );
  const source = sources.find((entry) => entry.engine === "MYSQL");
  assert.ok(
    source?.datasetId,
    "Recorded source registration must finish before warehouse pipeline",
  );
  const manifestPath = path.join(
    root,
    ".local/compose-app/readiness-ui-pipeline.json",
  );
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const name = `AdventureWorks products cross-engine ${suffix}`;
  const item = {
    name,
    sourceWarehouseId: source.warehouseId,
    sourceDatasetId: source.datasetId,
    targetTable: `readiness_aw_product_${suffix}`,
    sourceEngine: "MYSQL",
    targetEngine: "POSTGRESQL",
  };
  await page.goto(origin + "/pipelines");
  await page.getByRole("button", { name: "Tạo pipeline", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tên pipeline", exact: true })
    .fill(name);
  await page
    .getByRole("textbox", { name: "Tên dataset kết quả", exact: true })
    .fill(`AdventureWorks products pipeline ${suffix}`);
  await chooseSelector(
    page,
    "Warehouse đích",
    "Chinook / POSTGRESQL / Compose",
  );
  await chooseSelector(page, "Warehouse nguồn", source.name);
  await chooseSelector(page, "Dataset nguồn", source.datasetName);
  await page.getByRole("button", { name: "Bảng nguồn", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm Bảng nguồn", exact: true })
    .fill("DimProduct");
  await page
    .getByRole("listbox", { name: "Danh sách Bảng nguồn", exact: true })
    .getByRole("option", { name: /\.DimProduct$/ })
    .click();
  await page
    .getByRole("combobox", { name: /^Namespace có quyền tạo bảng/ })
    .selectOption("nla_import");
  await page
    .getByRole("textbox", { name: /^Tiền tố tên bảng mới/ })
    .fill(item.targetTable);
  await page
    .getByRole("spinbutton", { name: "Số dòng tối đa (1–10.000)", exact: true })
    .fill("1000");
  await audit(page, "/pipelines#source-target", 1440, false);
  await page
    .getByRole("button", { name: "Thiết lập chuyển đổi", exact: true })
    .click();
  await audit(page, "/pipelines#real-column-mapping", 1440, false);
  const previewResponse = responseFor(page, "/pipelines/preview");
  await page
    .getByRole("button", { name: "Kiểm tra và xem trước", exact: true })
    .click();
  const preview = await apiResponse(
    await previewResponse,
    "warehouse pipeline preview",
  );
  assert.equal(preview.valid, true);
  await expect(
    page.getByText("Kế hoạch hợp lệ.", { exact: false }),
  ).toBeVisible();
  await audit(page, "/pipelines#preview", 1440, false);
  const saveResponse = responseFor(page, "/pipelines");
  await page.getByRole("button", { name: "Lưu pipeline", exact: true }).click();
  const pipeline = await apiResponse(
    await saveResponse,
    "warehouse pipeline save",
  );
  item.pipelineId = pipeline.pipelineId;
  await writeFile(manifestPath, JSON.stringify(item, null, 2), { mode: 0o600 });
  await page
    .getByRole("searchbox", { name: "Tìm pipeline", exact: true })
    .fill(name);
  const row = page.getByRole("row").filter({ hasText: name });
  const runResponse = responseFor(page, `/pipelines/${item.pipelineId}/run`);
  await row.getByRole("button", { name: "Chạy", exact: true }).click();
  const accepted = await apiResponse(
    await runResponse,
    "warehouse pipeline run",
  );
  item.runId = accepted.runId;
  await writeFile(manifestPath, JSON.stringify(item, null, 2), { mode: 0o600 });
  await expect(
    page.locator(".definition-header").getByText("SUCCESS", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  const result = await backend(`/pipelines/runs/${item.runId}`);
  assert.equal(result.status, "SUCCESS");
  item.datasetId = result.datasetId;
  item.status = result.status;
  item.stages = result.stages;
  assert.ok(
    result.stages.every((stage) => stage.rowsWritten === 606),
    "Every pass-through stage must contain all606 sourceproducts",
  );
  await audit(page, "/pipelines#success", 1440, false);
  await writeFile(manifestPath, JSON.stringify(item, null, 2), { mode: 0o600 });
  report.warehousePipeline = {
    ...item,
    method:
      "Recorded source/target/mapping/preview/save/run React UI; GET-only verification",
  };
}

try {
  const desktop = await recorded(1440, "desktop");
  if (process.env.NLA_AUDIT_MODE === "focus") {
    await desktop.goto(origin + "/ingestion");
    await desktop
      .getByRole("tab", { name: "Nguồn warehouse", exact: true })
      .click();
    await desktop
      .getByRole("button", { name: "Đăng ký nguồn", exact: true })
      .first()
      .click();
    await audit(desktop, "/ingestion#source-wizard-link", 1440, false);
    await desktop.keyboard.press("Escape");
    await desktop.goto(origin + "/ingestion");
    const upload = responseFor(desktop, "/warehouse/ingestion/files");
    await desktop
      .getByLabel("Chọn file dữ liệu", { exact: true })
      .setInputFiles(
        path.join(root, ".local/adventureworks/ui-files/FactInternetSales.csv"),
      );
    const parsed = await apiResponse(await upload, "bulk preview focus");
    assert.equal(parsed.rowCount, 60398);
    await audit(desktop, "/ingestion#wide-bulk-preview", 1440, false);
    const region = desktop.getByRole("region", {
      name: "Dữ liệu file xem trước",
      exact: true,
    });
    await region.focus();
    await expect(region).toBeFocused();
    await desktop
      .getByRole("button", { name: "Đặt lại", exact: true })
      .first()
      .click();
    await desktop.goto(origin + "/query");
    await chooseSelector(
      desktop,
      "Warehouse",
      "Chinook / POSTGRESQL / Compose",
    );
    await desktop.getByRole("button", { name: "Dataset", exact: true }).click();
    await desktop
      .getByRole("textbox", { name: "Tìm Dataset", exact: true })
      .fill("AdventureWorks product file / POSTGRESQL");
    const fileItems = JSON.parse(
      await readFile(
        path.join(root, ".local/compose-app/readiness-ui-ingestion.json"),
        "utf8",
      ),
    );
    const jsonItems = JSON.parse(
      await readFile(
        path.join(root, ".local/compose-app/readiness-ui-json-ingestion.json"),
        "utf8",
      ),
    );
    const csvId = fileItems.find(
      (item) => item.engine === "POSTGRESQL" && item.status === "SUCCESS",
    ).datasetId;
    const jsonId = jsonItems.find(
      (item) => item.engine === "POSTGRESQL" && item.status === "SUCCESS",
    ).datasetId;
    await expect(
      desktop.locator(`[role="option"][data-resource-id="${csvId}"]`),
    ).toBeVisible();
    await expect(
      desktop.locator(`[role="option"][data-resource-id="${jsonId}"]`),
    ).toBeVisible();
    await audit(desktop, "/query#same-name-dataset-identities", 1440, false);
    await desktop
      .locator(`[role="option"][data-resource-id="${jsonId}"]`)
      .click();
    await expect(
      desktop.getByRole("button", { name: "Dataset", exact: true }),
    ).toHaveAttribute("title", new RegExp(jsonId));
    const mobile = await recorded(390, "mobile");
    await audit(mobile, "/query", 390);
    await chooseSelector(mobile, "Warehouse", "Chinook / POSTGRESQL / Compose");
    await mobile.getByRole("button", { name: "Dataset", exact: true }).click();
    await mobile
      .getByRole("textbox", { name: "Tìm Dataset", exact: true })
      .fill("AdventureWorks product file / POSTGRESQL");
    await expect(
      mobile.locator(`[role="option"][data-resource-id="${jsonId}"]`),
    ).toBeVisible();
    await audit(mobile, "/query#same-name-dataset-identities", 390, false);
    await mobile.keyboard.press("Escape");
    report.keyboards.datasetIdentitySelection = "PASS";
    report.keyboards.widePreviewRegion = "PASS";
    report.status =
      report.routes.every((route) => !route.violations.length) &&
      !report.errors.length
        ? "PASS"
        : "FAIL";
  } else if (process.env.NLA_AUDIT_MODE === "register") {
    await registerSources(desktop);
    report.status = "PASS";
  } else if (["ingest", "formats"].includes(process.env.NLA_AUDIT_MODE)) {
    await ingestFiles(desktop);
    report.status = "PASS";
  } else if (process.env.NLA_AUDIT_MODE === "sql") {
    await importSqlFiles(desktop);
    report.status = "PASS";
  } else if (process.env.NLA_AUDIT_MODE === "pipeline") {
    await runWarehousePipeline(desktop);
    report.status = "PASS";
  } else {
    for (const route of routes) await audit(desktop, route, 1440);
    await desktop.goto(origin + "/query");
    const trigger = desktop.getByRole("button", {
      name: "Warehouse",
      exact: true,
    });
    await trigger.focus();
    await desktop.keyboard.press("Enter");
    await desktop
      .getByRole("textbox", { name: "Tìm Warehouse", exact: true })
      .waitFor();
    await desktop
      .getByRole("listbox", { name: "Danh sách Warehouse", exact: true })
      .getByRole("option")
      .first()
      .waitFor();
    await desktop.keyboard.press("ArrowDown");
    await expect(
      desktop
        .getByRole("listbox", { name: "Danh sách Warehouse" })
        .getByRole("option")
        .first(),
    ).toBeFocused();
    await audit(desktop, "/query#warehouse-selector", 1440, false);
    await desktop.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    report.keyboards.selectorEscapeFocus = "PASS";
    const notification = desktop.getByRole("button", {
      name: "Thông báo hệ thống",
      exact: true,
    });
    await notification.click();
    await audit(desktop, "/query#notification", 1440, false);
    await desktop.keyboard.press("Escape");
    report.keyboards.notificationEscape =
      (await notification.getAttribute("aria-expanded")) === "false"
        ? "PASS"
        : "FAIL";
    await desktop.goto(origin + "/warehouses");
    const add = desktop.getByRole("button", {
      name: "Thêm warehouse",
      exact: true,
    });
    await add.click();
    await desktop
      .getByRole("dialog", { name: "Đăng ký warehouse", exact: true })
      .waitFor();
    await audit(desktop, "/warehouses#registration", 1440, false);
    await desktop.keyboard.press("Escape");
    await expect(add).toBeFocused();
    report.keyboards.dialogEscapeFocus = "PASS";
    await desktop.goto(origin + "/quality");
    await desktop
      .getByRole("button", { name: "Thêm quy tắc", exact: true })
      .click();
    await desktop
      .getByRole("dialog", { name: "Thêm quy tắc chất lượng" })
      .waitFor();
    for (const type of [
      "NOT_NULL",
      "UNIQUE",
      "RANGE",
      "ACCEPTED_VALUES",
      "ROW_COUNT",
      "REFERENCE",
    ]) {
      await desktop
        .getByRole("combobox", { name: "Loại kiểm tra", exact: true })
        .selectOption(type);
      await audit(desktop, `/quality#editor-${type}`, 1440, false);
    }
    await desktop.keyboard.press("Escape");
    await desktop.goto(origin + "/ingestion");
    const sourceTab = desktop.getByRole("tab", {
      name: "Nguồn warehouse",
      exact: true,
    });
    await sourceTab.click();
    await audit(desktop, "/ingestion#warehouse", 1440, false);
    await desktop
      .getByRole("button", { name: "Đăng ký nguồn", exact: true })
      .first()
      .click();
    await desktop
      .getByRole("dialog", { name: "Thêm nguồn dữ liệu", exact: true })
      .waitFor();
    await audit(desktop, "/ingestion#source-wizard", 1440, false);
    await desktop.keyboard.press("Escape");
    await desktop.goto(origin + "/pipelines");
    await desktop
      .getByRole("button", { name: "Tạo pipeline", exact: true })
      .click();
    await audit(desktop, "/pipelines#editor", 1440, false);
    await desktop
      .getByRole("button", { name: "Đóng trình tạo pipeline", exact: true })
      .click();
    await desktop.goto(origin + "/semantic");
    const semanticTabs = desktop.getByRole("tablist", {
      name: "Định nghĩa ngữ nghĩa",
      exact: true,
    });
    for (const tab of await semanticTabs.getByRole("tab").all()) {
      await tab.click();
      await audit(desktop, `/semantic#${await tab.textContent()}`, 1440, false);
    }
    const tablet = await recorded(1024, "tablet");
    for (const route of routes) await audit(tablet, route, 1024);
    const mobile = await recorded(390, "mobile");
    for (const route of routes) await audit(mobile, route, 390);
    const menu = mobile.getByRole("button", { name: "Mở menu", exact: true });
    await menu.click();
    await expect(
      mobile.getByRole("button", { name: "Đóng menu", exact: true }),
    ).toBeFocused();
    await mobile.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    report.keyboards.mobileEscapeFocus = "PASS";
    await mobile.goto(origin + "/warehouses");
    await mobile
      .getByRole("button", { name: "Thêm warehouse", exact: true })
      .click();
    await audit(mobile, "/warehouses#registration", 390, false);
    await mobile.keyboard.press("Escape");
    await mobile.goto(origin + "/ingestion");
    await mobile
      .getByRole("tab", { name: "Nguồn warehouse", exact: true })
      .focus();
    await mobile.keyboard.press("Home");
    await expect(
      mobile.getByRole("tab", { name: "Nạp file", exact: true }),
    ).toBeFocused();
    await mobile.keyboard.press("ArrowRight");
    await expect(
      mobile.getByRole("tab", { name: "Nguồn warehouse", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    report.keyboards.ingestionRovingTabs = "PASS";
    await mobile
      .getByRole("button", { name: "Đăng ký nguồn", exact: true })
      .first()
      .click();
    await audit(mobile, "/ingestion#source-wizard", 390, false);
    await mobile.keyboard.press("Escape");
    report.status =
      report.routes.every((route) => route.violations.length === 0) &&
      !report.errors.length &&
      Object.values(report.keyboards).every((v) => v === "PASS")
        ? "PASS"
        : "FAIL";
  }
} catch (error) {
  report.status = "FAIL";
  report.failure = `${error.name}: ${String(error.message).slice(0, 500)}`;
  for (const { context, label } of contexts)
    for (const page of context.pages()) {
      report.failureAlerts = await page
        .getByRole("alert")
        .allTextContents()
        .catch(() => []);
      await page
        .screenshot({
          path: path.join(output, `${label}-failure.png`),
          fullPage: true,
        })
        .catch(() => {});
    }
} finally {
  for (const { context, label } of contexts) {
    const videos = context.pages().map((page) => page.video());
    await context.close();
    for (let i = 0; i < videos.length; i++) {
      const destination = path.join(output, `${label}-${i + 1}.webm`);
      await videos[i]?.saveAs(destination);
      report.videos.push(destination);
    }
  }
  await browser.close();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: report.status,
      routes: report.routes.length,
      violationTypes: [
        ...new Set(report.routes.flatMap((r) => r.violations.map((v) => v.id))),
      ],
      keyboards: report.keyboards,
      videos: report.videos,
      errors: report.errors,
      failure: report.failure,
    }),
  );
  if (report.status !== "PASS") process.exitCode = 1;
}

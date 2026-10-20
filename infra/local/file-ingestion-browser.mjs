#!/usr/bin/env node
/** Packaged OIDC UI → Java → private file parser → physical DB3; no interception. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium, expect } = require("@playwright/test");
const origin = "http://127.0.0.1:4173";
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const registry = JSON.parse(
  await readFile(path.join(root, ".local/compose-app/registry.json"), "utf8"),
);
const manifest = [];
const report = { mocked: false, application: origin, cases: [] };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1280 },
});
const page = await context.newPage();
let errors = 0;
page.on("pageerror", () => errors++);
try {
  await page.goto(origin + "/ingestion");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await page.locator("#username").fill(accounts.users.ADMIN.username);
  await page.locator("#password").fill(accounts.users.ADMIN.password);
  await page.locator("#kc-login").click();
  await page.waitForURL(origin + "/ingestion");
  for (const entry of registry) {
    await page.goto(origin + "/ingestion");
    await page.getByRole("button", { name: "Warehouse", exact: true }).click();
    await page
      .getByRole("option")
      .filter({ hasText: `Chinook / ${entry.engine} / Compose` })
      .click();
    const table =
      "nla_browser_" + crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    const item = { engine: entry.engine, targetTable: table, datasetId: null };
    manifest.push(item);
    await writeFile(
      path.join(root, ".local/compose-app/file-browser-manifest.json"),
      JSON.stringify(manifest),
      { mode: 0o600 },
    );
    const uploaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          "/warehouse/ingestion/files",
        ) && response.request().method() === "POST",
    );
    await page.getByLabel("Chọn file dữ liệu", { exact: true }).setInputFiles({
      name: "browser-observations.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Station,Measurement,Enabled\nNorth,123.4500,true\nSouth,1.0000,false\n",
      ),
    });
    const uploadResponse = await uploaded;
    assert.equal(uploadResponse.status(), 200);
    item.uploadId = (await uploadResponse.json()).id;
    await writeFile(
      path.join(root, ".local/compose-app/file-browser-manifest.json"),
      JSON.stringify(manifest),
      { mode: 0o600 },
    );
    await expect(
      page.getByRole("heading", { name: "Ánh xạ cột được phát hiện" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByLabel("Tên đích cho Station", { exact: true }),
    ).toHaveValue("station");
    await expect(
      page.getByLabel("Kiểu dữ liệu cho Measurement", { exact: true }),
    ).toHaveValue("DECIMAL");
    await page
      .getByRole("combobox", { name: /Namespace \/ schema/ })
      .selectOption("nla_import");
    await page.getByLabel("Bảng đích", { exact: true }).fill(table);
    await page
      .getByLabel("Tên dataset", { exact: true })
      .fill("Browser observation " + entry.engine);
    await page
      .getByRole("button", { name: "Kiểm tra và tạo kế hoạch", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Kế hoạch đã xác thực" }),
    ).toBeVisible({ timeout: 30000 });
    const confirmed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/warehouse/ingestion/files/runs") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Xác nhận và nạp dữ liệu", exact: true })
      .click();
    const response = await confirmed;
    assert.equal(response.status(), 202);
    const accepted = await response.json();
    item.runId = accepted.id;
    await expect(
      page.locator(".file-run-overview").getByText("SUCCESS", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const datasetText = await page
      .locator(".file-ingestion-dataset-link code")
      .first()
      .textContent();
    item.datasetId = datasetText?.trim() || item.datasetId;
    assert.ok(item.datasetId);
    await writeFile(
      path.join(root, ".local/compose-app/file-browser-manifest.json"),
      JSON.stringify(manifest),
      { mode: 0o600 },
    );
    await expect(
      page.locator(".file-ingestion-layers .stage-success"),
    ).toHaveCount(4);
    await page.screenshot({
      path: path.join(root, ".local/compose-app/file-ingestion-desktop.png"),
      fullPage: true,
    });
    await page
      .locator(".file-ingestion-dataset-link")
      .getByRole("link", { name: "Mở Data Catalog" })
      .click();
    await expect(
      page.getByText(table + "_mart", { exact: true }).first(),
    ).toBeVisible({ timeout: 15000 });
    report.cases.push({
      engine: entry.engine,
      status: "PASS",
      columns: 3,
      rows: 2,
      stages: 4,
      catalog: "PASS",
    });
  }
  assert.equal(errors, 0);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure =
    error instanceof assert.AssertionError
      ? error.message
      : String(error.message).slice(0, 1200);
  await page
    .screenshot({
      path: path.join(root, ".local/compose-app/file-browser-failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  try {
    execFileSync(
      "python3",
      [path.join(root, "data/scripts/file_browser_targets.py")],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    report.cleanup = "PASS";
  } catch {
    report.cleanup = "FAIL";
    report.status = "FAIL";
    process.exitCode = 1;
  }
  await writeFile(
    path.join(root, ".local/compose-app/file-browser-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

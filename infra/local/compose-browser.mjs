#!/usr/bin/env node
/** Actual packaged frontend -> Java -> Python -> DB matrix; no fixtures or API interception. */
import assert from "node:assert/strict";
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
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1280 },
});
const page = await context.newPage();
const report = { mocked: false, application: origin, engines: {} };
let browserErrors = 0;
page.on("pageerror", () => browserErrors++);
try {
  await page.goto(origin + "/query");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await page.locator("#username").fill(accounts.users.ADMIN.username);
  await page.locator("#password").fill(accounts.users.ADMIN.password);
  await page.locator("#kc-login").click();
  await page.waitForURL(origin + "/query");
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).waitFor();
  for (const entry of registry) {
    await page.goto(origin + "/query");
    await page.getByRole("button", { name: "Warehouse", exact: true }).click();
    await page
      .getByRole("option")
      .filter({ hasText: `Chinook / ${entry.engine} / Compose` })
      .click();
    await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
    await expect(page.getByLabel("Câu hỏi phân tích")).toBeEnabled();
    await page
      .getByLabel("Câu hỏi phân tích")
      .fill("How many tracks are in the catalog?");
    await page.getByLabel("Chế độ xử lý").selectOption("DETERMINISTIC");
    await page.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "How many tracks are in the catalog?",
      }),
    ).toBeVisible();
    await expect(page.locator(".result-heading .badge")).toHaveText("SUCCESS");
    await page.getByRole("link", { name: "Dữ liệu", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "3.503", exact: true }),
    ).toBeVisible();
    report.engines[entry.engine] = "PASS";
  }
  assert.equal(browserErrors, 0, "Browser raised uncaught application errors");
  assert.equal(Object.keys(report.engines).length, 3);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure =
    error instanceof assert.AssertionError
      ? error.message
      : "Packaged browser matrix failed";
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(
    path.join(root, ".local/compose-app/browser-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

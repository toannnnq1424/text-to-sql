#!/usr/bin/env node
/** Recorded real UI paging check for an existing successful immutable query snapshot. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium, expect } = require("@playwright/test");
const origin = "http://127.0.0.1:4173";
const api = "http://127.0.0.1:8085/api/v1";
const evidence = path.join(
  root,
  ".local/compose-app/readiness-browser/chart-snapshot-ui",
);
await mkdir(evidence, { recursive: true });
const sourceReport = JSON.parse(
  await readFile(
    path.join(evidence, "../feature-demo-snapshot/report.json"),
    "utf8",
  ),
);
const semanticQuery = sourceReport.queries.find(
  (query) => query.executionMode === "SEMANTIC",
);
assert.ok(semanticQuery, "Recorded feature demo must include a semantic query");
const token = execFileSync(
  "python3",
  [
    "-c",
    'import sys;sys.path.insert(0,"infra/local");import compose;print(compose.service_token())',
  ],
  { cwd: root, encoding: "utf8" },
).trim();
const response = await fetch(api + "/query/" + semanticQuery.queryId, {
  headers: { Authorization: "Bearer " + token },
});
assert.ok(response.ok, "Independent read-only query assertion must succeed");
const query = await response.json();
assert.equal(query.status, "SUCCESS");
assert.ok(query.result.returnedRowCount > 20);
const report = {
  mocked: false,
  apiMutations: 0,
  queryId: semanticQuery.queryId,
  executionMode: query.executionMode,
  returnedRowCount: query.result.returnedRowCount,
  browserErrors: [],
  status: "RUNNING",
};
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1100 },
  recordVideo: {
    dir: path.join(evidence, "raw"),
    size: { width: 1728, height: 1100 },
  },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (error) => report.browserErrors.push(error.name));
const video = page.video();
try {
  await page.goto(origin + "/query");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await page.locator("#username").fill(accounts.users.ADMIN.username);
  await page.locator("#password").fill(accounts.users.ADMIN.password);
  assert.equal(
    await page.locator("#password").getAttribute("type"),
    "password",
  );
  await page.locator("#kc-login").click();
  await page.waitForURL(origin + "/query");
  await page.goto(
    origin + "/query/" + semanticQuery.queryId + "/visualization",
  );
  await expect(page.locator("main h1")).toBeVisible();
  await page.getByRole("button", { name: "Bảng", exact: true }).click();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "Phân trang bảng biểu đồ",
  });
  await expect(table.getByRole("row")).toHaveCount(21);
  await expect(navigation.getByText("1 / 2")).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "page-one.png"),
    animations: "disabled",
  });
  await navigation.getByRole("button", { name: "Trang sau" }).click();
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(
    table.getByRole("cell", { name: "21", exact: true }),
  ).toBeVisible();
  await expect(navigation.getByText("2 / 2")).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Trang sau" }),
  ).toBeDisabled();
  await page.screenshot({
    path: path.join(evidence, "page-two.png"),
    animations: "disabled",
  });
  assert.deepEqual(report.browserErrors, []);
  report.uiPages = [20, 4];
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure =
    error instanceof Error ? error.message : "Unknown browser failure";
  throw error;
} finally {
  await context.close();
  if (video) {
    await rename(await video.path(), path.join(evidence, "demo.webm"));
  }
  await browser.close();
  await writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}

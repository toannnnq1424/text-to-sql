#!/usr/bin/env node
/** Actual OIDC UI → Java → native DB3 quality checks. No intercepted API responses. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
const origin = "http://127.0.0.1:4173";
const api = "http://127.0.0.1:8085/api/v1";
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const fixtures = JSON.parse(
  await readFile(
    path.join(root, ".local/compose-app/quality-fixtures.json"),
    "utf8",
  ),
);
const output = path.join(root, ".local/compose-app/quality-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1280 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const report = {
  mocked: false,
  engines: {},
  responsive: [],
  browserErrors: 0,
  modelRequests: 0,
};
let phase = "login";
let grant;
let admin;
const ownedRules = [];
const unique = randomBytes(5).toString("hex");
async function persistOwned() {
  await writeFile(
    path.join(output, "owned.json"),
    JSON.stringify({ rules: ownedRules, grant }, null, 2),
    { mode: 0o600 },
  );
}
page.on("pageerror", () => report.browserErrors++);
page.on("request", (r) => {
  if (
    r.method() === "POST" &&
    /\/api\/v1\/(query|datasets\/[^/]+\/semantic-assist)$/.test(
      new URL(r.url()).pathname,
    )
  )
    report.modelRequests++;
});
const responseFor = (ending, method = "GET") =>
  page.waitForResponse(
    (r) =>
      r.request().method() === method &&
      new URL(r.url()).pathname.endsWith(ending),
  );
async function json(response) {
  const value = await response.json();
  assert.ok(
    response.ok(),
    `HTTP${response.status()} ${value.error?.code || ""}`,
  );
  return value;
}
async function login(target, role) {
  await target.goto(origin + "/quality");
  await target
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await target.locator("#username").fill(accounts.users[role].username);
  await target.locator("#password").fill(accounts.users[role].password);
  await target.locator("#kc-login").click();
  await target.waitForURL(origin + "/quality");
  await target
    .getByRole("button", { name: "Đăng xuất", exact: true })
    .waitFor();
}
async function selectContext(target, entry) {
  await target.getByRole("button", { name: "Warehouse", exact: true }).click();
  await target
    .getByRole("textbox", { name: "Tìm Warehouse", exact: true })
    .fill("Data quality QA / " + entry.engine);
  await target
    .getByRole("option")
    .filter({ hasText: "Data quality QA / " + entry.engine })
    .click();
  await target.getByRole("button", { name: "Dataset", exact: true }).click();
  await target
    .getByRole("textbox", { name: "Tìm Dataset", exact: true })
    .fill("Quality observations / " + entry.engine);
  await target
    .getByRole("option")
    .filter({ hasText: "Quality observations / " + entry.engine })
    .click();
  await expect(
    target.getByRole("button", { name: "Dataset", exact: true }),
  ).toContainText("Quality observations / " + entry.engine);
}
async function screenshot(name, width = 1728, anchor = null) {
  await page.setViewportSize({ width, height: 1280 });
  if (anchor) await anchor.scrollIntoViewIfNeeded();
  else await page.evaluate(() => scrollTo(0, 0));
  const actual = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  assert.ok(actual <= width + 1, `Page overflow ${actual}/${width}`);
  report.responsive.push({ name, width, documentWidth: actual });
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
async function backend(method, endpoint, body) {
  admin ??= execFileSync(
    "python3",
    [
      "-c",
      'import sys;sys.path.insert(0,"infra/local");import compose;print(compose.service_token())',
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const result = await fetch(api + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + admin,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(result.ok, `Backend ${method} HTTP${result.status}`);
  return result.status === 204 ? null : result.json();
}
try {
  await login(page, "ADMIN");
  for (const entry of fixtures) {
    phase = entry.engine + ":context";
    await page.setViewportSize({ width: 1728, height: 1280 });
    await selectContext(page, entry);
    await expect(
      page.getByText("Quality parent-reference", { exact: true }).first(),
    ).toBeVisible();
    phase = entry.engine + ":create-rule";
    await page
      .getByRole("button", { name: "Thêm quy tắc", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const name = "Browser row count / " + entry.engine + " / " + unique;
    await dialog.getByLabel("Tên quy tắc", { exact: true }).fill(name);
    await dialog
      .getByLabel("Loại kiểm tra", { exact: true })
      .selectOption("ROW_COUNT");
    await dialog
      .getByRole("button", { name: "Bảng cần kiểm tra", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Tìm Bảng cần kiểm tra", exact: true })
      .fill(entry.table.name);
    await dialog
      .getByRole("option")
      .filter({ hasText: entry.table.schema + "." + entry.table.name })
      .click();
    await dialog.getByLabel("Giới hạn dưới", { exact: true }).fill("6");
    await dialog.getByLabel("Giới hạn trên", { exact: true }).fill("6");
    await screenshot(entry.engine + "-rule-editor");
    await screenshot(entry.engine + "-rule-editor-390", 390);
    await page.setViewportSize({ width: 1728, height: 1280 });
    await dialog
      .getByRole("button", { name: "Áp dụng vào bản nháp", exact: true })
      .click();
    const suffix = "/datasets/" + entry.datasetId + "/quality";
    const submittedRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname.endsWith(suffix + "/rules"),
    );
    const savedResponse = responseFor(suffix + "/rules", "PUT").then(json);
    await page
      .getByRole("button", { name: "Lưu bộ quy tắc", exact: true })
      .click();
    const submitted = (await submittedRequest).postDataJSON();
    const created = submitted.rules.find((rule) => rule.name === name);
    assert.ok(
      created,
      "Created rule identity is present in submitted configuration",
    );
    // Track before consuming the response, so a body-read failure still has exact cleanup identity.
    ownedRules.push({ datasetId: entry.datasetId, ruleId: created.ruleId });
    await persistOwned();
    const saved = await savedResponse;
    assert.ok(
      saved.rules.some(
        (x) => x.name === name && x.min === "6" && x.max === "6",
      ),
    );
    phase = entry.engine + ":run";
    await expect(
      page.getByRole("button", { name: "Chạy kiểm tra", exact: true }),
    ).toBeEnabled();
    const startedResponse = responseFor(suffix + "/runs", "POST").then(json);
    await page
      .getByRole("button", { name: "Chạy kiểm tra", exact: true })
      .click();
    const started = await startedResponse;
    const terminal = await backend("GET", suffix + "/runs/" + started.runId);
    let run = terminal;
    for (let i = 0; run.status === "RUNNING" && i < 130; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = await backend("GET", suffix + "/runs/" + started.runId);
    }
    assert.equal(run.status, "FAILED");
    assert.equal(
      run.checks.length,
      saved.rules.filter((rule) => rule.enabled).length,
    );
    assert.ok(
      run.checks.some(
        (x) =>
          x.name === name && x.status === "PASSED" && x.observedValue === "6",
      ),
    );
    const result = page.locator(".card").filter({
      has: page.getByRole("heading", {
        name: "Kết quả từng quy tắc",
        exact: true,
      }),
    });
    await expect(result.getByText(name, { exact: true })).toBeVisible();
    await expect(
      result.getByText("Quality parent-reference", { exact: true }),
    ).toBeVisible();
    await screenshot(entry.engine + "-results-1728", 1728, result);
    await screenshot(entry.engine + "-quality-1728");
    await screenshot(entry.engine + "-quality-1024", 1024);
    await screenshot(entry.engine + "-quality-390", 390);
    report.engines[entry.engine] = {
      status: "PASS",
      runId: started.runId,
      checkCount: run.checks.length,
      createdRule: true,
    };
  }
  phase = "viewer";
  const viewerContext = await browser.newContext({
    viewport: { width: 1440, height: 1280 },
  });
  const viewer = await viewerContext.newPage();
  viewer.on("pageerror", () => report.browserErrors++);
  await login(viewer, "VIEWER");
  // OIDC reads the signed identity profile locally; it need not call /session.
  // Return only the subject needed for this exact temporary resource grant.
  const identity = await viewer.evaluate(() => {
    const key = Object.keys(sessionStorage).find((name) =>
      name.startsWith("oidc.user:"),
    );
    return {
      subject: key ? JSON.parse(sessionStorage.getItem(key)).profile.sub : null,
    };
  });
  assert.ok(identity.subject, "OIDC subject unavailable");
  const access = await backend(
    "GET",
    "/warehouses/" + fixtures[0].warehouseId + "/access",
  );
  if (!access.some((item) => item.subject === identity.subject)) {
    grant = { warehouse: fixtures[0].warehouseId, subject: identity.subject };
    await persistOwned();
    await backend("POST", "/warehouses/" + grant.warehouse + "/access", {
      subject: grant.subject,
    });
  }
  await viewer.reload();
  await selectContext(viewer, fixtures[0]);
  await expect(
    viewer.getByText("Quality parent-reference", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Thêm quy tắc", exact: true }),
  ).toHaveCount(0);
  await expect(
    viewer.getByRole("button", { name: "Lưu bộ quy tắc", exact: true }),
  ).toHaveCount(0);
  await expect(
    viewer.getByRole("button", { name: "Chạy kiểm tra", exact: true }),
  ).toHaveCount(0);
  await viewer.screenshot({
    path: path.join(output, "quality-viewer-1440.png"),
    animations: "disabled",
  });
  await viewerContext.close();
  report.viewerReadOnly = "PASS";
  assert.equal(report.browserErrors, 0);
  assert.equal(report.modelRequests, 0);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.phase = phase;
  report.reason = error.name + ": " + String(error.message).slice(0, 400);
  await page
    .screenshot({
      path: path.join(output, "failure.png"),
      animations: "disabled",
    })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  try {
    for (const item of ownedRules) {
      const endpoint = "/datasets/" + item.datasetId + "/quality/rules";
      const current = await backend("GET", endpoint);
      const remaining = current.rules.filter(
        (rule) => rule.ruleId !== item.ruleId,
      );
      if (remaining.length !== current.rules.length)
        await backend("PUT", endpoint, {
          revision: current.revision,
          rules: remaining,
        });
    }
    if (grant)
      await backend(
        "DELETE",
        "/warehouses/" +
          grant.warehouse +
          "/access?subject=" +
          encodeURIComponent(grant.subject),
      );
    report.cleanup = "PASS";
  } catch (cleanupError) {
    report.cleanup = "FAIL: " + cleanupError.name;
    process.exitCode = 1;
  }
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
  await browser.close();
}

#!/usr/bin/env node
/** Real OIDC Settings → Java encrypted profiles → local model. Never calls an online model. */
import assert from "node:assert/strict";
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
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const registry = JSON.parse(
  await readFile(path.join(root, ".local/compose-app/registry.json"), "utf8"),
);
const output = path.join(root, ".local/compose-app/model-provider-browser");
await mkdir(output, { recursive: true });
const origin = "http://127.0.0.1:4173";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1280 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", () => errors.push("Uncaught browser error"));
const owned = [];
let originalDefault;
let initialized = false;
let phase = "login";
let modelRequests = 0;
page.on("request", (request) => {
  if (
    request.method() === "POST" &&
    /\/api\/v1\/(query|datasets\/[^/]+\/semantic-assist)$/.test(
      new URL(request.url()).pathname,
    )
  )
    modelRequests++;
});
const report = {
  mocked: false,
  onlineProviderTested: false,
  keyLogged: false,
  checks: {},
  responsive: [],
};
const suffix = "/settings/model-providers";
const responseFor = (ending, method = "GET", timeout = 30000) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname.endsWith(ending),
    { timeout },
  );
async function json(response) {
  const body = await response.json();
  assert.ok(
    response.ok(),
    `HTTP ${response.status()} ${body.error?.code || ""}`,
  );
  return body;
}
async function track(provider) {
  owned.push({ providerId: provider.providerId, name: provider.name });
  await writeFile(
    path.join(output, "owned.json"),
    JSON.stringify({ originalDefault, owned }, null, 2),
    { mode: 0o600 },
  );
}
async function screenshot(name, width = 1728) {
  await page.setViewportSize({ width, height: 1280 });
  await page.evaluate(() => scrollTo(0, 0));
  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  assert.ok(
    documentWidth <= width + 1,
    `Page overflow: ${documentWidth}/${width}`,
  );
  report.responsive.push({ name, width, documentWidth });
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: false,
    animations: "disabled",
    mask: [page.locator('input[type="password"]')],
  });
}
async function login(target, role, destination = "/settings") {
  await target.goto(origin + destination);
  await target
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await target.locator("#username").fill(accounts.users[role].username);
  await target.locator("#password").fill(accounts.users[role].password);
  await target.locator("#kc-login").click();
  await target.waitForURL(origin + destination);
  await target
    .getByRole("button", { name: "Đăng xuất", exact: true })
    .waitFor();
}
async function createProfile({ name, kind, baseUrl, model, enabled, key }) {
  await page
    .getByRole("button", { name: "Thêm cấu hình model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên cấu hình", { exact: true }).fill(name);
  await dialog.getByLabel(/^Loại provider/).selectOption(kind);
  await dialog
    .getByLabel("Base URL tương thích Chat Completions", { exact: true })
    .fill(baseUrl);
  await dialog.getByLabel("Tên model chính xác", { exact: true }).fill(model);
  if (key) await dialog.getByLabel("API key", { exact: true }).fill(key);
  await dialog
    .getByLabel("Bật cấu hình model", { exact: true })
    .setChecked(enabled);
  const saved = responseFor(suffix, "POST");
  await dialog
    .getByRole("button", { name: "Lưu cấu hình model", exact: true })
    .click();
  const provider = await json(await saved);
  await track(provider);
  assert.ok(!("apiKey" in provider));
  assert.ok(!("ciphertext" in provider));
  await expect(dialog).not.toBeVisible();
  return provider;
}
async function editProfile(providerId, action, verify) {
  await page
    .locator(`[data-provider-id="${providerId}"]`)
    .getByRole("button", { name: "Chỉnh sửa", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[type="password"]')).toHaveValue("");
  await action(dialog);
  const saved = responseFor(`${suffix}/${providerId}`, "PUT");
  await dialog
    .getByRole("button", { name: "Lưu cấu hình model", exact: true })
    .click();
  const response = await saved;
  const provider = await json(response);
  const requestBody = response.request().postDataJSON();
  await verify(requestBody);
  assert.ok(!("apiKey" in provider));
  await expect(dialog).not.toBeVisible();
  return provider;
}
try {
  await login(page, "ADMIN");
  const loaded = responseFor(suffix);
  await page.reload();
  const initial = await json(await loaded);
  originalDefault = initial.defaultProviderId;
  initialized = true;
  const local = initial.items.find(
    (item) =>
      item.kind === "OLLAMA" &&
      item.source === "ENVIRONMENT" &&
      item.configured &&
      item.enabled,
  );
  assert.ok(local, "Requires real configured environment Ollama metadata");
  phase = "save-online-key-without-call";
  const stamp = Date.now().toString(36);
  const online = await createProfile({
    name: `Browser online ${stamp}`,
    kind: "ONLINE",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    enabled: false,
    key: "test-only-unusable-" + randomBytes(20).toString("hex"),
  });
  assert.equal(online.hasApiKey, true);
  assert.equal(modelRequests, 0);
  report.checks.onlineKeySaveWithoutModelCall = "PASS";
  phase = "preserve-rotate-clear";
  phase = "preserve-key";
  const preserved = await editProfile(
    online.providerId,
    async () => {},
    async (body) => {
      assert.ok(!("apiKey" in body));
      assert.ok(!body.clearApiKey);
      assert.equal(body.revision, online.revision);
    },
  );
  assert.equal(preserved.hasApiKey, true);
  phase = "rotate-key";
  const rotated = await editProfile(
    online.providerId,
    async (dialog) => {
      await dialog
        .getByLabel("API key mới", { exact: true })
        .fill("test-only-unusable-" + randomBytes(20).toString("hex"));
    },
    async (body) => {
      assert.ok(body.apiKey);
      assert.equal(body.revision, preserved.revision);
    },
  );
  assert.equal(rotated.hasApiKey, true);
  phase = "clear-key";
  const cleared = await editProfile(
    online.providerId,
    async (dialog) => {
      await dialog.getByLabel("Xóa API key đã lưu", { exact: true }).check();
    },
    async (body) => {
      assert.equal(body.clearApiKey, true);
      assert.ok(!("apiKey" in body));
    },
  );
  assert.equal(cleared.hasApiKey, false);
  report.checks.keyPreserveRotateClear = "PASS";
  phase = "local-profile-default";
  const appLocal = await createProfile({
    name: `Browser local ${stamp}`,
    kind: "OLLAMA",
    baseUrl: local.baseUrl,
    model: local.model,
    enabled: true,
  });
  const changed = responseFor(`${suffix}/default`, "PUT");
  await page
    .getByLabel(/^Chọn cấu hình mặc định/)
    .selectOption(appLocal.providerId);
  await json(await changed);
  await expect(
    page
      .locator(`[data-provider-id="${appLocal.providerId}"]`)
      .getByRole("button", { name: "Xóa", exact: true }),
  ).toBeDisabled();
  await screenshot("settings-admin-1728");
  await screenshot("settings-admin-1024", 1024);
  await screenshot("settings-admin-390", 390);
  await page.setViewportSize({ width: 1728, height: 1280 });
  report.checks.localDefault = "PASS";
  phase = "query-provider-selection";
  await page.goto(origin + "/query");
  const pg = registry.find((entry) => entry.engine === "POSTGRESQL");
  assert.ok(pg);
  await page.getByRole("button", { name: "Warehouse", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm Warehouse", exact: true })
    .fill("Chinook / POSTGRESQL / Compose");
  await page
    .getByRole("option")
    .filter({ hasText: "Chinook / POSTGRESQL / Compose" })
    .click();
  await page.getByRole("button", { name: "Dataset", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm Dataset", exact: true })
    .fill("Chinook");
  await page
    .getByRole("option")
    .filter({ hasText: /Chinook/i })
    .click();
  await expect(
    page.getByRole("option", {
      name: `Tự động · Ollama local · ${local.model}`,
      exact: true,
    }),
  ).toHaveCount(1);
  await page
    .getByLabel("Chế độ xử lý", { exact: true })
    .selectOption("DETERMINISTIC");
  await expect(
    page.getByText(/Offline không gọi AI, Ollama hoặc API/),
  ).toBeVisible();
  await screenshot("offline-explanation-1728");
  await page.getByLabel("Chế độ xử lý", { exact: true }).selectOption("API");
  await page.getByLabel(/^Model sẽ gọi/).selectOption(appLocal.providerId);
  await page
    .getByLabel("Câu hỏi phân tích", { exact: true })
    .fill("Có bao nhiêu bản ghi trong bảng album?");
  await screenshot("query-selected-local-1728");
  await screenshot("query-selected-local-1024", 1024);
  await screenshot("query-selected-local-390", 390);
  await page.setViewportSize({ width: 1728, height: 1280 });
  const generated = responseFor("/query", "POST", 180000);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  const queryResponse = await generated;
  assert.equal(queryResponse.status(), 201);
  const queryInput = queryResponse.request().postDataJSON();
  assert.equal(queryInput.providerId, appLocal.providerId);
  assert.equal(queryInput.mode, "API");
  assert.ok(!("apiKey" in queryInput));
  await page.waitForURL(/\/query\/[^/]+\/overview$/);
  await expect(page.locator(".result-heading .badge")).toHaveText("SUCCESS");
  await expect(page.locator(".metadata-strip")).toContainText(
    `Ollama local · ${local.model}`,
  );
  const queryId = new URL(page.url()).pathname.split("/")[2];
  await page
    .getByRole("link", { name: "Thông tin kỹ thuật", exact: true })
    .click();
  await expect(page.locator(".detail-list")).toContainText(appLocal.name);
  await expect(page.locator(".detail-list")).toContainText(
    "Cấu hình trong ứng dụng",
  );
  await screenshot("result-provider-snapshot-1728");
  report.checks.actualLocalModelQuery = {
    status: "PASS",
    queryId,
    model: local.model,
  };
  report.checks.offlineExplanation = "PASS";
  phase = "viewer-safe-metadata";
  const viewerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const viewer = await viewerContext.newPage();
  await login(viewer, "VIEWER");
  await expect(
    viewer.getByRole("heading", { name: appLocal.name, exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Thêm cấu hình model", exact: true }),
  ).toHaveCount(0);
  await expect(
    viewer.locator('[data-provider-id] input[type="password"]'),
  ).toHaveCount(0);
  await viewer.screenshot({
    path: path.join(output, "settings-viewer-1440.png"),
    fullPage: false,
    animations: "disabled",
  });
  await viewerContext.close();
  report.checks.viewerReadOnly = "PASS";
  assert.equal(errors.length, 0);
  report.status = "PASS";
} catch (failure) {
  report.status = "FAIL";
  report.phase = phase;
  report.failure = failure.message.slice(0, 1400);
  await screenshot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  const failures = [];
  if (initialized) {
    try {
      await page.setViewportSize({ width: 1728, height: 1280 });
      await page.goto(origin + "/settings");
      const control = page.getByLabel(/^Chọn cấu hình mặc định/);
      await control.waitFor();
      if ((await control.inputValue()) !== (originalDefault || "")) {
        const restored = responseFor(`${suffix}/default`, "PUT");
        await control.selectOption(originalDefault || "");
        await json(await restored);
      }
      for (const provider of owned) {
        const card = page.locator(
          `[data-provider-id="${provider.providerId}"]`,
        );
        if (!(await card.count())) continue;
        await expect(
          card.getByRole("heading", { name: provider.name, exact: true }),
        ).toBeVisible();
        await card.getByRole("button", { name: "Xóa", exact: true }).click();
        const removed = responseFor(
          `${suffix}/${provider.providerId}`,
          "DELETE",
        );
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Xóa cấu hình", exact: true })
          .click();
        assert.equal((await removed).status(), 204);
        await expect(card).toHaveCount(0);
      }
    } catch {
      failures.push(
        "Owned profile cleanup needs retry using private owned.json; original environment was not edited.",
      );
    }
  }
  report.cleanup = failures.length ? failures : "PASS";
  if (failures.length) {
    report.status = "FAIL";
    process.exitCode = 1;
  }
  report.browserErrors = errors.length;
  await browser.close();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

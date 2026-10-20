#!/usr/bin/env node
/** Real OIDC → React → Java → source-kit services → three warehouses; no API interception. */
import assert from "node:assert/strict";
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
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const registry = JSON.parse(
  await readFile(path.join(root, ".local/compose-app/registry.json"), "utf8"),
);
const output = path.join(root, ".local/compose-app/workbench-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1280 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", () => errors.push("Uncaught browser error"));
const report = {
  mocked: false,
  origin,
  viewport: { width: 1728, height: 1280 },
  engines: {},
};
const stamp = Date.now().toString(36);
let phase = "login";
async function successfulResponse(response, label) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `${label}: response body unavailable (${response.status()} ${response.request().method()})`,
    );
  }
  if (!response.ok())
    throw new Error(
      `${label}: ${response.status()} ${data.error?.code || "ERROR"} ${data.error?.message || ""}`,
    );
  return data;
}
try {
  await page.goto(origin + "/semantic");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await page.locator("#username").fill(accounts.users.ADMIN.username);
  await page.locator("#password").fill(accounts.users.ADMIN.password);
  await page.locator("#kc-login").click();
  await page.waitForURL(origin + "/semantic");
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).waitFor();
  for (const entry of registry) {
    const engine = entry.engine;
    phase = `${engine}:semantic`;
    await page.goto(origin + "/query");
    await page.getByRole("button", { name: "Warehouse", exact: true }).click();
    await page
      .getByRole("option")
      .filter({ hasText: `Chinook / ${engine} / Compose` })
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
      page.getByRole("button", { name: "Dataset", exact: true }),
    ).toContainText("Chinook");
    await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
    await page.goto(origin + "/semantic");
    await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
    await expect(page.getByLabel(/^Phiên bản ngữ nghĩa/)).not.toHaveValue("");
    const metric = page.getByLabel("Chỉ số (tối đa 10)");
    await metric.waitFor();
    const metricName =
      (await metric.locator("option").first().getAttribute("value")) ||
      (await metric.locator("option").first().textContent());
    const validationResponse = page.waitForResponse(
      (response) =>
        response.request().method() !== "OPTIONS" &&
        response.url().endsWith("/semantic-model/validate"),
    );
    await page
      .getByRole("button", { name: "Kiểm tra cấu hình", exact: true })
      .click();
    const valid = await successfulResponse(
      await validationResponse,
      `${phase}:validate`,
    );
    assert.equal(valid.valid, true);
    await page.screenshot({
      path: path.join(output, `${engine}-semantic.png`),
      fullPage: false,
    });
    assert.ok(metricName);
    await page.getByLabel("Chỉ số (tối đa 10)").selectOption(metricName);
    const queryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/semantic-query"),
    );
    await page
      .getByRole("button", { name: "Chạy phân tích", exact: true })
      .click();
    const queryResponseHeaders = await queryResponse;
    assert.equal(queryResponseHeaders.status(), 200);
    await page.waitForURL(/\/query\/[^/]+\/overview$/);
    const query = { queryId: new URL(page.url()).pathname.split("/")[2] };
    await expect(
      page.getByRole("button", { name: "Mở phân tích nghiệp vụ", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".result-heading .badge")).toHaveText("SUCCESS");
    await expect(
      page.getByText("Compiler ngữ nghĩa", { exact: true }),
    ).toBeVisible();

    let found = { hits: [] };
    if (process.env.NLA_KNOWLEDGE_SKIP !== "true") {
      phase = `${engine}:knowledge`;
      await page.goto(origin + "/knowledge");
      await page
        .getByRole("heading", { name: "Chỉ mục của dataset", exact: true })
        .waitFor();
      const indexResponse = page.waitForResponse(
        (response) =>
          response.request().method() !== "OPTIONS" &&
          response.url().endsWith("/knowledge/index"),
        { timeout: 180000 },
      );
      await page
        .getByRole("button", { name: "Lập lại chỉ mục", exact: true })
        .click();
      const knowledge = await successfulResponse(
        await indexResponse,
        `${phase}:index`,
      );
      assert.equal(knowledge.status, "READY");
      assert.ok(knowledge.schemaItems > 0);
      await expect(
        page.getByRole("button", { name: "Tra cứu", exact: true }),
      ).toBeDisabled();
      await page
        .getByLabel("Câu hỏi cần phân tích")
        .fill("How many artists are present in the artist table?");
      const searchResponse = page.waitForResponse(
        (response) =>
          response.request().method() !== "OPTIONS" &&
          response.url().endsWith("/knowledge/search"),
        { timeout: 120000 },
      );
      await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
      found = await successfulResponse(await searchResponse, `${phase}:search`);
      assert.ok(found.hits.length > 0);
      await expect(
        page.locator(".knowledge-hits article").first(),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(output, `${engine}-knowledge.png`),
        fullPage: false,
      });
    }
    report.engines[engine] = {
      semantic: "PASS",
      semanticQuery: query.queryId,
      knowledge: process.env.NLA_KNOWLEDGE_SKIP === "true" ? "NOT_RUN" : "PASS",
    };
    phase = `${engine}:pipeline`;
    await page.goto(origin + "/pipelines");
    await expect(
      page.getByRole("button", { name: "Dataset", exact: true }),
    ).toContainText("Chinook");
    await page
      .getByRole("button", { name: "Tạo pipeline", exact: true })
      .click();
    const pipelineName = `Browser ${engine} ${stamp}`;
    await page.getByLabel("Tên pipeline", { exact: true }).fill(pipelineName);
    await page
      .getByLabel("Tên dataset kết quả", { exact: true })
      .fill(`Browser ${engine} result ${stamp}`);
    await page.getByRole("button", { name: "Bảng nguồn", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Tìm Bảng nguồn", exact: true })
      .fill("artist");
    await page
      .getByRole("option")
      .filter({ hasText: /\.artist$/i })
      .click();
    await page
      .getByRole("combobox", { name: /^Namespace có quyền tạo bảng/ })
      .selectOption({ index: 1 });
    await page
      .getByLabel(/^Tiền tố tên bảng mới/)
      .fill(`browser_${engine.toLowerCase()}_${stamp}`);
    await page
      .getByRole("button", { name: "Thiết lập chuyển đổi", exact: true })
      .click();
    const layers = page.locator("section.definition-card");
    assert.equal(await layers.count(), 3);
    // Rename the first source field and explicitly rebind the next two stages.
    await layers
      .nth(0)
      .getByLabel("Tên cột 1", { exact: true })
      .fill("artist_key");
    await layers
      .nth(1)
      .getByRole("button", { name: "Dùng cột lớp trước", exact: true })
      .click();
    await layers
      .nth(2)
      .getByRole("button", { name: "Dùng cột lớp trước", exact: true })
      .click();
    const previewResponse = page.waitForResponse(
      (response) =>
        response.request().method() !== "OPTIONS" &&
        response.url().endsWith("/pipelines/preview"),
      { timeout: 120000 },
    );
    await page
      .getByRole("button", { name: "Kiểm tra và xem trước", exact: true })
      .click();
    const preview = await successfulResponse(
      await previewResponse,
      `${phase}:preview`,
    );
    assert.equal(preview.valid, true);
    assert.equal(preview.stages.length, 4);
    assert.ok(
      preview.stages
        .at(-1)
        .columns.some((column) => column.name === "artist_key"),
    );
    await expect(
      page.getByRole("button", { name: "Lưu pipeline", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: path.join(output, `${engine}-pipeline.png`),
      fullPage: false,
    });
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() !== "OPTIONS" &&
        response.url().endsWith("/pipelines") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Lưu pipeline", exact: true })
      .click();
    const saved = await successfulResponse(await saveResponse, `${phase}:save`);
    await page.getByLabel("Tìm pipeline", { exact: true }).fill(pipelineName);
    await page.getByRole("row").filter({ hasText: pipelineName }).waitFor();
    const runResponse = page.waitForResponse(
      (response) =>
        response.request().method() !== "OPTIONS" &&
        response.url().endsWith(`/pipelines/${saved.pipelineId}/run`),
      { timeout: 120000 },
    );
    await page
      .getByRole("row")
      .filter({ hasText: pipelineName })
      .getByRole("button", { name: "Chạy", exact: true })
      .click();
    const run = await successfulResponse(await runResponse, `${phase}:run`);
    await expect(
      page.getByRole("heading", { name: "Chi tiết lần chạy", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Mart đã được đăng ký thành dataset.", { exact: false }),
    ).toBeVisible({ timeout: 120000 });
    await page.screenshot({
      path: path.join(output, `${engine}-pipeline-result.png`),
      fullPage: false,
    });
    report.engines[engine] = {
      semantic: "PASS",
      semanticQuery: query.queryId,
      knowledge: process.env.NLA_KNOWLEDGE_SKIP === "true" ? "NOT_RUN" : "PASS",
      retrievalHits: found.hits.length,
      pipeline: "PASS",
      pipelineId: saved.pipelineId,
      runId: run.runId,
    };
  }
  assert.equal(errors.length, 0);
  report.status =
    process.env.NLA_KNOWLEDGE_SKIP === "true" ? "PARTIAL" : "PASS";
} catch (error) {
  report.status = "FAIL";
  report.phase = phase;
  report.failure = error.message.slice(0, 1000);
  await page.screenshot({
    path: path.join(output, "failure.png"),
    fullPage: false,
  });
  process.exitCode = 1;
} finally {
  report.browserErrors = errors.length;
  await browser.close();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

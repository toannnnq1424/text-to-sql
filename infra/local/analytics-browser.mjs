#!/usr/bin/env node
/** Real OIDC and current-dataset analytics; no route interception or fabricated responses. */
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
const skipModel = process.env.NLA_ANALYTICS_SKIP_MODEL === "true";
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const fixtures = JSON.parse(
  await readFile(
    path.join(root, ".local/compose-app/analytics-fixtures.json"),
    "utf8",
  ),
);
const output = path.join(root, ".local/compose-app/analytics-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1280 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", () => errors.push("Uncaught browser error"));
const report = { mocked: false, origin, engines: {}, responsive: [] };
let phase = "login";
const responseFor = (suffix, method = "GET", timeout = 30000) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname.endsWith(suffix),
    { timeout },
  );
async function json(response, label) {
  const body = await response.json();
  assert.ok(
    response.ok(),
    `${label}: HTTP ${response.status()} ${body.error?.code || ""} ${body.error?.message || ""}`,
  );
  return body;
}
async function screenshot(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
async function selectContext(entry) {
  await page.getByRole("button", { name: "Warehouse", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm Warehouse", exact: true })
    .fill(`Synthetic analytics QA / ${entry.engine}`);
  await page
    .getByRole("option")
    .filter({ hasText: `Synthetic analytics QA / ${entry.engine}` })
    .click();
  await page.getByRole("button", { name: "Dataset", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm Dataset", exact: true })
    .fill(`Synthetic observations / ${entry.engine}`);
  await page
    .getByRole("option")
    .filter({ hasText: `Synthetic observations / ${entry.engine}` })
    .click();
  await expect(
    page.getByRole("button", { name: "Dataset", exact: true }),
  ).toContainText(`Synthetic observations / ${entry.engine}`);
}
async function result(entry, kind, tab = "visualization") {
  assert.ok(
    entry.queries[kind],
    `Fixture query missing: ${entry.engine}/${kind}`,
  );
  await page.goto(`${origin}/query/${entry.queries[kind]}/${tab}`);
  await expect(page.locator(".result-heading .badge")).toHaveText("SUCCESS");
  return page.locator(".visualization");
}
async function noPageOverflow(width) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.document <= width + 1,
    `Page overflow at ${width}px: ${dimensions.document}`,
  );
  return dimensions;
}
try {
  assert.ok(
    fixtures.every((entry) => Object.keys(entry.queries).length >= 4),
    "Wait for actual fixture queries before running browser checks",
  );
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
  for (const entry of fixtures) {
    phase = `${entry.engine}:context-and-suggestions`;
    await page.goto(origin + "/query");
    await page
      .getByLabel("Câu hỏi phân tích")
      .fill("Draft from previous context");
    await selectContext(entry);
    await expect(page.getByLabel("Câu hỏi phân tích")).toHaveValue("");
    const suggestionsResponse = responseFor(
      `/datasets/${entry.datasetId}/question-suggestions`,
    );
    await page.reload();
    const suggestions = await json(await suggestionsResponse, phase);
    assert.ok(suggestions.items.length > 0);
    assert.ok(
      suggestions.items.every((item) =>
        item.tableRefs.every((table) =>
          entry.tables.some(
            (actual) =>
              actual.name === table.name && actual.schema === table.schema,
          ),
        ),
      ),
    );
    assert.ok(
      suggestions.items.every(
        (item) => !/chinook|album|artist|invoice|track/i.test(item.question),
      ),
    );
    await expect(
      page.getByText("Từ schema thực", { exact: true }).first(),
    ).toBeVisible();
    await screenshot(`${entry.engine}-suggestions-1728`);

    phase = `${entry.engine}:scalar`;
    let visualization = await result(entry, "scalar");
    await expect(visualization.locator(".number-chart strong")).toHaveText(
      "12",
    );
    await expect(visualization.getByRole("table")).toHaveCount(0);
    await expect(
      visualization.getByRole("button", { name: "Cột nhóm", exact: true }),
    ).toHaveCount(0);
    const scalarBox = await page.locator(".scalar-result-card").boundingBox();
    assert.ok(scalarBox && scalarBox.width <= 760);
    await screenshot(`${entry.engine}-scalar-1728`);
    await result(entry, "scalar", "data");
    const tableBox = await page.locator(".result-scroll").boundingBox();
    assert.ok(tableBox && tableBox.width < 760);
    await screenshot(`${entry.engine}-scalar-table-1728`);

    phase = `${entry.engine}:bar-pie`;
    visualization = await result(entry, "grouped");
    await expect(visualization.locator(".recharts-bar").first()).toBeVisible();
    await expect(visualization.getByLabel("Cột trục X")).toBeVisible();
    const mainBox = await visualization.locator(".chart-main").boundingBox();
    const inspectorBox = await visualization
      .locator(".chart-inspector")
      .boundingBox();
    assert.ok(
      mainBox && inspectorBox && inspectorBox.x >= mainBox.x + mainBox.width,
    );
    await screenshot(`${entry.engine}-bar-1728`);
    await visualization
      .getByRole("button", { name: "Tròn", exact: true })
      .click();
    await expect(visualization.locator(".recharts-pie")).toBeVisible();
    await screenshot(`${entry.engine}-pie-1728`);

    phase = `${entry.engine}:time-area`;
    visualization = await result(entry, "timeline");
    await expect(visualization.locator(".recharts-line").first()).toBeVisible();
    await screenshot(`${entry.engine}-line-1728`);
    await visualization
      .getByRole("button", { name: "Diện tích", exact: true })
      .click();
    await expect(visualization.locator(".recharts-area").first()).toBeVisible();

    phase = `${entry.engine}:grouped`;
    visualization = await result(entry, "multiple");
    await expect(visualization.locator(".recharts-bar")).toHaveCount(2);
    await expect(
      visualization.locator(".series-options input:checked"),
    ).toHaveCount(2);
    await screenshot(`${entry.engine}-grouped-1728`);
    await visualization
      .locator(".series-options input:checked")
      .last()
      .uncheck();
    await expect(visualization.locator(".recharts-bar")).toHaveCount(1);
    await expect(
      visualization.getByRole("button", { name: "Tròn", exact: true }),
    ).toBeEnabled();

    phase = `${entry.engine}:sql`;
    await result(entry, skipModel ? "scalar" : "natural", "sql");
    await expect(
      page.getByText("SQL đã thực thi", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".sql-code").first()).toBeVisible();
    await screenshot(`${entry.engine}-sql-1728`);
    if (await page.locator(".candidate-sql").count()) {
      await page.locator(".candidate-sql summary").click();
      assert.ok((await page.locator(".candidate-sql .sql-line").count()) > 3);
      await screenshot(`${entry.engine}-sql-proposal-1728`);
    }

    phase = `${entry.engine}:catalog-explore`;
    await page.goto(origin + "/catalog/metrics");
    await page
      .getByRole("link", { name: "Phân tích", exact: true })
      .first()
      .click();
    await page.waitForURL(/\/semantic\?action=explore&metric=/);
    await expect(page.getByLabel("Chỉ số (tối đa 10)")).toHaveValues([
      new URL(page.url()).searchParams.get("metric"),
    ]);
    await page
      .getByLabel("Chiều tương thích (tối đa 5)")
      .selectOption("station");
    const semanticResponse = responseFor(
      `/datasets/${entry.datasetId}/semantic-query`,
      "POST",
      120000,
    );
    await page
      .getByRole("button", { name: "Chạy phân tích", exact: true })
      .click();
    assert.equal((await semanticResponse).status(), 200);
    await page.waitForURL(/\/query\/[^/]+\/overview$/);
    await expect(page.locator(".result-heading .badge")).toHaveText("SUCCESS");
    await expect(page.locator(".result-overview")).toBeVisible();
    await screenshot(`${entry.engine}-overview-1728`);

    phase = `${entry.engine}:evaluation`;
    await page.goto(origin + "/evaluation");
    await page
      .getByRole("button", { name: "Bộ test case", exact: true })
      .click();
    const suite = page
      .getByRole("option")
      .filter({ hasText: "Schema hiện tại" });
    await expect(suite).toHaveCount(1);
    await suite.click();
    await expect(
      page.getByText(/Các câu đếm từ schema kiểm tra tích hợp cơ bản/),
    ).toBeVisible();
    await screenshot(`${entry.engine}-evaluation-1728`);
    report.engines[entry.engine] = {
      status: "PASS",
      suggestions: suggestions.items.length,
      scalar: "PASS",
      bar: "PASS",
      pie: "PASS",
      line: "PASS",
      area: "PASS",
      grouped: "PASS",
      catalogExplore: "PASS",
      evaluationScope: "PASS",
    };
    console.log(JSON.stringify({ engine: entry.engine, status: "PASS" }));
  }
  const entry = fixtures[0];
  await page.goto(origin + "/query");
  await selectContext(entry);
  if (!skipModel) {
    phase = "natural-question-submit";
    await expect(page.getByLabel("Chế độ xử lý")).toHaveValue("AUTO");
    await page
      .getByLabel("Câu hỏi phân tích")
      .fill(
        `Tính nhiệt độ temperature trung bình của mỗi station trong bảng ${entry.targetTable}_mart.`,
      );
    const naturalResponse = responseFor("/query", "POST", 180000);
    await page.getByRole("button", { name: "Gửi", exact: true }).click();
    assert.equal((await naturalResponse).status(), 201);
    await page.waitForURL(/\/query\/[^/]+\/overview$/);
    await expect(page.locator(".result-heading .badge")).toHaveText("SUCCESS");
    await expect(page.locator(".metadata-strip")).toContainText("qwen3:4b");
    await screenshot("natural-question-result-1728");
    report.naturalQuestion = {
      status: "PASS",
      mode: "AUTO",
      model: "qwen3:4b",
      queryId: new URL(page.url()).pathname.split("/")[2],
    };
    phase = "semantic-assist-review";
    await page.goto(origin + "/semantic");
    const instruction =
      "Review the existing definitions. Keep their names and units. Suggest one useful additional COUNT metric for the current table using the name qa_observation_rows; describe its exact meaning. Do not invent columns or business facts.";
    await page.getByLabel("Yêu cầu nghiệp vụ cho AI").fill(instruction);
    const assistanceResponse = responseFor(
      `/datasets/${entry.datasetId}/semantic-assist`,
      "POST",
      180000,
    );
    await page
      .getByRole("button", { name: "Đề xuất ngữ nghĩa bằng AI", exact: true })
      .click();
    const proposal = await json(await assistanceResponse, phase);
    assert.ok(proposal.model);
    assert.ok(proposal.semanticModel.metrics.length > 0);
    await expect(
      page.getByRole("button", { name: "Áp dụng vào bản nháp", exact: true }),
    ).toBeVisible();
    await screenshot("semantic-assist-review-1728");
    await page
      .getByRole("button", { name: "Áp dụng vào bản nháp", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Lưu và kích hoạt", exact: true }),
    ).toBeDisabled();
    report.semanticAssist = {
      status: "PASS",
      activated: false,
      model: proposal.model,
    };
  } else {
    report.semanticAssist = {
      status: "NOT_RUN",
      reason: "Model API validation is running separately",
    };
  }

  phase = "responsive";
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1280 });
    for (const kind of ["scalar", "grouped", "timeline", "multiple"]) {
      await result(entry, kind);
      await expect(
        page.locator(".number-chart,.chart-area").first(),
      ).toBeVisible();
      const dimensions = await noPageOverflow(width);
      await screenshot(`${entry.engine}-${kind}-${width}`);
      report.responsive.push({ width, kind, ...dimensions, status: "PASS" });
    }
    if (width === 390) {
      await page.getByRole("button", { name: "Mở menu", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Đóng menu", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Mở menu", exact: true }),
      ).toBeFocused();
    }
  }
  assert.equal(errors.length, 0);
  report.status = skipModel ? "PARTIAL" : "PASS";
} catch (error) {
  report.status = "FAIL";
  report.phase = phase;
  report.failure = error.message.slice(0, 1400);
  await screenshot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  report.browserErrors = errors.length;
  await browser.close();
  await writeFile(
    path.join(output, skipModel ? "structured-report.json" : "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

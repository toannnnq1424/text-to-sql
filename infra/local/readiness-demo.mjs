#!/usr/bin/env node
/** Recorded actual OIDC login, local model, compiler, knowledge and quality UI. */
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
const origin = "http://127.0.0.1:4173";
const output = path.join(
  root,
  ".local/compose-app/readiness-browser/" +
    (process.env.NLA_DEMO_LABEL || "feature-demo"),
);
await mkdir(output, { recursive: true });
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json")),
);
const registry = JSON.parse(
  await readFile(path.join(root, ".local/compose-app/registry.json")),
);
const ingestions = JSON.parse(
  await readFile(
    path.join(root, ".local/compose-app/readiness-ui-ingestion.json"),
  ),
);
async function get(endpoint) {
  const token = execFileSync(
    "python3",
    [
      "-c",
      'import sys;sys.path.insert(0,"infra/local");import compose;print(compose.service_token())',
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const response = await fetch("http://127.0.0.1:8085/api/v1" + endpoint, {
    headers: { Authorization: "Bearer " + token },
  });
  assert.ok(
    response.ok,
    `Independent read-only assertion HTTP ${response.status}`,
  );
  return response.json();
}
const source = registry.find((entry) => entry.engine === "POSTGRESQL");
const imported = ingestions.find(
  (entry) => entry.engine === "POSTGRESQL" && entry.status === "SUCCESS",
);
assert.ok(source && imported);
const warehouse = await get("/warehouses/" + source.warehouseId);
const dataset = await get("/datasets/" + source.datasetId);
const importedDataset = await get("/datasets/" + imported.datasetId);
const semantics = await get(
  "/datasets/" + source.datasetId + "/semantic-model",
);
const metric = semantics.metrics.find(
  (item) => item.compatibleDimensions.length,
);
assert.ok(metric, "A real active semantic metric is required");
const report = {
  mocked: false,
  onlineProviderTested: false,
  authentication:
    "Actual OIDC authorization-code login via UI; password field remained masked",
  chapters: [],
  queries: [],
  browserErrors: [],
  status: "RUNNING",
};
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1100 },
  recordVideo: {
    dir: path.join(output, "raw"),
    size: { width: 1728, height: 1100 },
  },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (error) => report.browserErrors.push(error.name));
const started = Date.now();
async function chapter(name) {
  report.chapters.push({
    name,
    seconds: Math.round((Date.now() - started) / 1000),
  });
  console.log(JSON.stringify({ chapter: name }));
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(
      output,
      String(report.chapters.length).padStart(2, "0") + ".png",
    ),
    animations: "disabled",
  });
}
async function select(label, name, resourceId) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm " + label, exact: true })
    .fill(name);
  if (resourceId) {
    await page
      .locator('[role="option"][data-resource-id="' + resourceId + '"]')
      .click();
  } else {
    await page.getByRole("option").filter({ hasText: name }).click();
  }
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toContainText(name);
}
async function queryResult() {
  await page.waitForURL(/\/query\/qry-[^/]+\/overview$/, { timeout: 65000 });
  const id = page.url().split("/").at(-2);
  const query = await get("/query/" + id);
  assert.equal(query.status, "SUCCESS", `Actual query ${id} must execute`);
  report.queries.push({
    queryId: id,
    executionMode: query.executionMode,
    model: query.model,
    provider: query.provider,
    returnedRowCount: query.result.returnedRowCount,
  });
  return query;
}
try {
  await page.goto(origin + "/query");
  await chapter("Trang đăng nhập ứng dụng");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await page.locator("#username").fill(accounts.users.ADMIN.username);
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
  await page.locator("#password").fill(accounts.users.ADMIN.password);
  await page.locator("#kc-login").click();
  await page.waitForURL(origin + "/query");
  await expect(
    page.getByRole("button", { name: "Đăng xuất", exact: true }),
  ).toBeVisible();
  await chapter("Đăng nhập OIDC thật hoàn tất");
  await select("Warehouse", warehouse.name);
  await select("Dataset", dataset.name);
  await page.getByLabel("Chế độ xử lý", { exact: true }).selectOption("API");
  await page.getByLabel(/^Model sẽ gọi/).selectOption("environment");
  await page
    .getByLabel("Câu hỏi phân tích", { exact: true })
    .fill("Dem so dong trong bang albummm");
  await chapter("Chọn rõ Ollama local, câu hỏi không dấu có typo");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  const natural = await queryResult();
  assert.equal(natural.model, "qwen3:4b");
  assert.equal(natural.provider.kind, "OLLAMA");
  assert.equal(String(Object.values(natural.result.rows[0])[0]), "347");
  await chapter("Kết quả COUNT từ model và database thật");
  for (const tab of ["sql", "explanation", "technical"]) {
    await page.goto(`${origin}/query/${natural.queryId}/${tab}`);
    await page.locator("main h1").waitFor();
    await chapter("Kết quả: " + tab);
  }
  await page.goto(origin + "/semantic");
  await page.getByLabel(/^Chỉ số \(tối đa 10\)/).selectOption(metric.name);
  await page
    .getByLabel(/^Chiều tương thích \(tối đa 5\)/)
    .selectOption(metric.compatibleDimensions[0]);
  await chapter("Chọn metric/dimension từ semantic active, không gọi LLM");
  await page
    .getByRole("button", { name: "Chạy phân tích", exact: true })
    .click();
  const compiled = await queryResult();
  assert.equal(compiled.executionMode, "SEMANTIC");
  await page.goto(`${origin}/query/${compiled.queryId}/visualization`);
  await expect(page.locator(".recharts-bar").first()).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(
    compiled.result.returnedRowCount,
  );
  report.completeChartRows = compiled.result.returnedRowCount;
  await chapter("Biểu đồ trên kết quả compiler/database");
  const pie = page.getByRole("button", { name: "Tròn", exact: true });
  if (await pie.isVisible()) {
    await pie.click();
    await expect(page.locator(".recharts-pie").first()).toBeVisible();
    await chapter("Đổi biểu đồ tròn, giữ cùng snapshot dữ liệu");
  }
  await page.goto(origin + "/knowledge");
  await page
    .getByRole("button", { name: "Lập lại chỉ mục", exact: true })
    .click();
  await expect(page.getByText("READY", { exact: true }).first()).toBeVisible({
    timeout: 65000,
  });
  await chapter("Lập chỉ mục metadata bằng embeddings local");
  await page
    .getByPlaceholder("Nhập câu hỏi để tìm metadata và ví dụ liên quan…")
    .fill("album artist");
  await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
  await expect(page.locator(".knowledge-hits article").first()).toBeVisible();
  await chapter("Tìm ngữ cảnh trong source-kit MemoryStore");
  await page.goto(origin + "/quality");
  await select("Dataset", importedDataset.name, imported.datasetId);
  await page.getByRole("button", { name: "Thêm quy tắc", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Tên quy tắc", { exact: true })
    .fill("Recorded demo: 606 source products");
  await dialog
    .getByLabel("Loại kiểm tra", { exact: true })
    .selectOption("ROW_COUNT");
  await dialog
    .getByRole("button", { name: "Bảng cần kiểm tra", exact: true })
    .click();
  await dialog.locator('button[role="option"]').first().click();
  await dialog.getByLabel("Giới hạn dưới", { exact: true }).fill("606");
  await dialog.getByLabel("Giới hạn trên", { exact: true }).fill("606");
  await chapter("Tạo quy tắc quality theo metadata dataset vừa nạp");
  await dialog
    .getByRole("button", { name: "Áp dụng vào bản nháp", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lưu bộ quy tắc", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Chạy kiểm tra", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Chạy kiểm tra", exact: true })
    .click();
  await expect(page.getByText("PASSED", { exact: true }).first()).toBeVisible({
    timeout: 65000,
  });
  await chapter("Quality kiểm toàn bảng thật và lưu snapshot");
  await page.goto(origin + "/settings");
  await page.getByRole("heading", { name: /Model và API key/ }).waitFor();
  await chapter("Cấu hình model: metadata an toàn, không hiển thị key");
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Đăng nhập", exact: true }).first(),
  ).toBeVisible();
  await chapter("Đăng xuất, kết thúc phiên");
  assert.equal(report.browserErrors.length, 0);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = `${error.name}: ${String(error.message).slice(0, 600)}`;
  await page.screenshot({ path: path.join(output, "failure.png") });
} finally {
  const video = page.video();
  await context.close();
  report.video = path.join(output, "demo.webm");
  await video.saveAs(report.video);
  await browser.close();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
  if (report.status !== "PASS") process.exitCode = 1;
}

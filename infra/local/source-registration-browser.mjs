#!/usr/bin/env node
/** Real IdP -> React -> Java -> native executor -> DB3; no API interception. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
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
const report = { mocked: false, application: origin, engines: {}, roles: {} };
function fixture(action) {
  const result = spawnSync(
    "python3",
    [path.join(root, "data/scripts/source_registration_fixture.py"), action],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `Disposable database fixture ${action} failed`,
  );
}
fixture("prepare");
const manifest = JSON.parse(
  await readFile(
    path.join(root, ".local/source-registration-fixture.json"),
    "utf8",
  ),
);
report.fixture = manifest.prefix;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const created = [];
let errors = 0;
page.on("pageerror", () => errors++);
async function login(role, actorPage = page) {
  await actorPage.goto(origin + "/ingestion");
  await actorPage
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await actorPage.locator("#username").fill(accounts.users[role].username);
  await actorPage.locator("#password").fill(accounts.users[role].password);
  await actorPage.locator("#kc-login").click();
  await actorPage.waitForURL(origin + "/ingestion");
  await actorPage
    .getByRole("button", { name: "Đăng xuất", exact: true })
    .waitFor();
}
async function select(label, option) {
  await page.getByRole("button", { name: label, exact: true }).click();
  if (typeof option === "string") {
    await page
      .getByRole("textbox", { name: `Tìm ${label}`, exact: true })
      .fill(option);
  }
  await page
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
}
async function api(method, route, body, actorPage = page) {
  return actorPage.evaluate(
    async ({ method, route, body }) => {
      const recordKey = Object.keys(sessionStorage).find((key) =>
        key.startsWith("oidc.user:"),
      );
      const token = JSON.parse(
        sessionStorage.getItem(recordKey) || "{}",
      ).access_token;
      const response = await fetch("/api/v1" + route, {
        method,
        headers: {
          Authorization: "Bearer " + token,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, route, body },
  );
}
try {
  await login("ADMIN");
  for (const entry of registry) {
    await page.goto(origin + "/ingestion");
    await select(
      "Warehouse",
      new RegExp(`Chinook / ${entry.engine} / Compose`),
    );
    await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
    await page.getByRole("tab", { name: "Nguồn warehouse" }).click();
    await page
      .getByRole("button", { name: "Đăng ký nguồn", exact: true })
      .first()
      .click();
    await expect(page.getByLabel("SELECT nguồn", { exact: true })).toHaveCount(
      0,
    );
    const fixtureEntry = manifest.engines[entry.engine];
    const schema = fixtureEntry.tables[0].schema;
    const album = entry.engine === "POSTGRESQL" ? "album" : "Album";
    await select("Bảng cần lấy dữ liệu", `${schema}.${album}`);
    await page.getByText(/^Chọn cột cần lấy/).click();
    const columns = page.locator(".source-column-picker label");
    for (const column of await columns.all()) {
      if (!(await column.innerText()).startsWith(fixtureEntry.column))
        await column.getByRole("checkbox").uncheck();
    }
    await page.screenshot({
      path: path.join(root, `.local/source-wizard-${entry.engine}-step1.png`),
    });
    await page.getByRole("button", { name: "Xem trước và tiếp tục" }).click();
    await page
      .getByLabel("Tên nguồn", { exact: true })
      .fill(`Source UI acceptance ${manifest.prefix} ${entry.engine}`);
    for (const [index, label] of [
      "Raw",
      "Staging",
      "Warehouse",
      "Mart",
    ].entries()) {
      await select(
        `Bảng ${label}`,
        `${schema}.${fixtureEntry.tables[index].name}`,
      );
    }
    await page.screenshot({
      path: path.join(root, `.local/source-wizard-${entry.engine}-step2.png`),
    });
    await page.getByRole("button", { name: "Xem lại cấu hình" }).click();
    await expect(
      page.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Kiểm tra nguồn và bảng đích" })
      .click();
    await expect(
      page.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
    ).toBeEnabled({ timeout: 60000 });
    await page.screenshot({
      path: path.join(root, `.local/source-wizard-${entry.engine}-step3.png`),
    });
    await page.getByRole("button", { name: "Lưu nguồn dữ liệu" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await api(
      "GET",
      `/warehouse/ingestion/sources?search=${encodeURIComponent(manifest.prefix)}&pageSize=100`,
    );
    assert.equal(saved.status, 200);
    const source = saved.body.items.find(
      (item) =>
        item.name === `Source UI acceptance ${manifest.prefix} ${entry.engine}`,
    );
    assert.ok(source?.sourceId);
    created.push(source.sourceId);
    await expect(
      page.getByRole("button", { name: "Nguồn dữ liệu", exact: true }),
    ).toContainText(manifest.prefix);
    await page.getByRole("button", { name: "Chạy pipeline mới" }).click();
    await expect(page).toHaveURL(/\/ingestion\/[^/]+$/, { timeout: 60000 });
    await expect(page.getByText("SUCCESS", { exact: true }).last()).toBeVisible(
      { timeout: 60000 },
    );
    report.engines[entry.engine] = {
      status: "PASS",
      inferredColumn: fixtureEntry.column,
      expectedRows: 347,
    };
  }
  fixture("verify");
  // Disable only these disposable definitions before changing test identities.
  for (const id of created.splice(0)) {
    const disabled = await api(
      "PATCH",
      `/warehouse/ingestion/sources/${encodeURIComponent(id)}`,
      { status: "DISABLED" },
    );
    assert.equal(disabled.status, 200);
  }
  for (const role of ["VIEWER", "ANALYST", "OPERATOR"]) {
    const roleContext = await browser.newContext();
    const actorPage = await roleContext.newPage();
    try {
      await login(role, actorPage);
      for (const route of ["preview", "validate"]) {
        const denied = await api(
          "POST",
          `/warehouse/ingestion/sources/${route}`,
          {},
          actorPage,
        );
        assert.equal(
          denied.status,
          403,
          `${role} must not ${route} source definitions`,
        );
      }
      const deniedTargets = await api(
        "GET",
        "/warehouse/ingestion/sources/targets?warehouseId=unknown&datasetId=unknown",
        undefined,
        actorPage,
      );
      assert.equal(deniedTargets.status, 403);
      report.roles[role] = "PASS: preview/validate/targets forbidden";
    } finally {
      await roleContext.close();
    }
  }
  assert.equal(errors, 0);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure =
    error instanceof assert.AssertionError
      ? error.message
      : "Source registration browser acceptance failed; inspect private screenshot/report.";
  await writeFile(
    path.join(root, ".local/source-wizard-error.txt"),
    String(error?.stack || error),
    { mode: 0o600 },
  );
  await page
    .screenshot({ path: path.join(root, ".local/source-wizard-failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  for (const id of created)
    await api(
      "PATCH",
      `/warehouse/ingestion/sources/${encodeURIComponent(id)}`,
      { status: "DISABLED" },
    ).catch(() => {});
  await browser.close();
  fixture("cleanup");
  await writeFile(
    path.join(root, ".local/source-registration-browser-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

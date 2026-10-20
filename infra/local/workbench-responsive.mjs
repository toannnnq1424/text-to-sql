#!/usr/bin/env node
/** Read-only responsive checks against the packaged app and live OIDC/API. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium, expect } = require("@playwright/test");
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const origin = "http://127.0.0.1:4173";
const output = path.join(root, ".local/compose-app/workbench-responsive");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1728, height: 1280 },
});
const page = await context.newPage();
let errors = 0;
page.on("pageerror", () => errors++);
const report = {
  mocked: false,
  mutatingRequests: false,
  application: origin,
  checks: [],
};
let phase = "login";
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
  await page.getByRole("button", { name: "Warehouse", exact: true }).click();
  await page
    .getByRole("option")
    .filter({ hasText: "Chinook / SQL_SERVER / Compose" })
    .click();
  await page.getByRole("button", { name: "Dataset", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tìm Dataset", exact: true })
    .fill("Chinook");
  await page
    .getByRole("option")
    .filter({ hasText: /Chinook/i })
    .click();
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [route, title, ready] of [
      ["semantic", "Ngữ nghĩa nghiệp vụ", "Cấu hình đang hoạt động"],
      ["knowledge", "Tri thức AI", "Chỉ mục của dataset"],
      ["pipelines", "Pipelines dữ liệu", "Pipelines đã lưu"],
    ]) {
      phase = `${viewport.width}:${route}`;
      await page.goto(`${origin}/${route}`);
      await expect(
        page.getByRole("heading", { level: 1, name: title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: ready, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".sidebar-status")).toContainText("ACTIVE");
      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      assert.ok(
        widths.scroll <= widths.client + 1,
        `${phase}: page horizontal overflow ${widths.scroll}/${widths.client}`,
      );
      const screenshot = `${viewport.width}-${route}.png`;
      await page.screenshot({
        path: path.join(output, screenshot),
        fullPage: false,
      });
      let keyboard = "desktop navigation visible";
      if (viewport.width <= 1100) {
        const open = page.getByRole("button", { name: "Mở menu", exact: true });
        await open.click();
        const dialog = page.getByRole("dialog", {
          name: "Điều hướng chính",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "Đóng menu", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await page.screenshot({
          path: path.join(output, `${viewport.width}-${route}-menu.png`),
          fullPage: false,
        });
        await page.keyboard.press("Escape");
        await expect(open).toBeFocused();
        await expect(dialog).not.toBeVisible();
        keyboard = "menu focus / tab / escape / focus return PASS";
      }
      report.checks.push({
        route,
        viewport,
        horizontalOverflow: false,
        keyboard,
        screenshot,
        status: "PASS",
      });
    }
  }
  assert.equal(errors, 0);
  report.status = "PASS";
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
  report.browserErrors = errors;
  await browser.close();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

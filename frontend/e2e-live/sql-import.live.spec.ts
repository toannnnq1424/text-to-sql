import { expect, test } from "@playwright/test";

const apiBase = process.env.VITE_API_BASE_URL;
const token = process.env.LOCAL_API_TOKEN;

test("imports a validated script into each live analytical warehouse", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.NLA_LIVE_E2E !== "true" || !apiBase || !token,
    "Live SQL Import test requires explicit local API configuration.",
  );

  const response = await request.get(
    `${apiBase}/warehouses?page=1&pageSize=100`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok()).toBeTruthy();
  const registry = (await response.json()) as {
    items: Array<{
      warehouseId: string;
      name: string;
      engine: "POSTGRESQL" | "MYSQL" | "SQL_SERVER";
      status: string;
      defaultSchema: string | null;
    }>;
  };
  const warehouses = ["POSTGRESQL", "MYSQL", "SQL_SERVER"].map((engine) => {
    const warehouse = registry.items.find(
      (item) => item.engine === engine && item.status === "ACTIVE",
    );
    expect(warehouse, `active ${engine} warehouse registered`).toBeDefined();
    return warehouse!;
  });

  await page.goto("/import/sql");
  await page.getByLabel("Local API token").fill(token!);
  await page.getByRole("button", { name: "Đăng nhập local" }).click();
  await expect(
    page.getByRole("heading", { name: "Lịch sử SQL Import" }),
  ).toBeVisible();

  for (const warehouse of warehouses) {
    const suffix = `${Date.now()}_${warehouse.engine.toLowerCase()}`;
    const tableName = `fe_live_${suffix}`;
    const indexName = `ix_${tableName}`;
    const script = [
      `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY, label VARCHAR(80) NOT NULL, amount DECIMAL(12,2) DEFAULT 0.00);`,
      `CREATE INDEX ${indexName} ON ${tableName} (id);`,
      `INSERT INTO ${tableName} (id, label, amount) VALUES (1, '${warehouse.engine}', 12.50);`,
    ].join("\n");

    await page.getByLabel("Warehouse đích").selectOption(warehouse.warehouseId);
    await page.getByLabel("Schema đích").fill("nla_import");
    await page.getByLabel("Dialect nguồn").selectOption(warehouse.engine);
    await page.getByLabel("File SQL (tối đa 2 MiB)").setInputFiles({
      name: `${tableName}.sql`,
      mimeType: "text/plain",
      buffer: Buffer.from(script),
    });
    await page.getByRole("button", { name: "Kiểm tra và xem trước" }).click();
    await expect(
      page.getByRole("heading", { name: "Kế hoạch đã xác thực" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("CREATE_INDEX").first()).toBeVisible();
    await page.locator(".import-schema details summary").click();
    await expect(page.getByText("amount").first()).toBeVisible();
    await page.getByRole("button", { name: "Xem lại và xác nhận" }).click();
    await page.getByRole("button", { name: "Xác nhận import" }).click();
    await expect(page).toHaveURL(/\/import\/sql\//, { timeout: 30000 });
    await expect(
      page.locator(".dataset-title").getByText("SUCCESS"),
    ).toBeVisible({
      timeout: 60000,
    });
    const completedRun = page
      .getByRole("row")
      .filter({ hasText: warehouse.name })
      .filter({ hasText: "SUCCESS" })
      .first();
    await expect(completedRun).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Lịch sử SQL Import" }),
    ).toBeVisible();
  }
});

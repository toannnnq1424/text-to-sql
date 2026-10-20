import { expect, test } from "@playwright/test";

const apiBase = process.env.VITE_API_BASE_URL;
const token = process.env.LOCAL_API_TOKEN;
const engineTargets = [
  {
    engine: "POSTGRESQL",
    warehouse: "Chinook POSTGRESQL",
    warehouseId: "wh-chinook-pg",
    sourceId: "chinook-country-sales-pg",
    datasetId: "ds-chinook-pg",
    suffix: "pg",
    schema: "public",
  },
  {
    engine: "MYSQL",
    warehouse: "Chinook MYSQL",
    warehouseId: "wh-chinook-mysql",
    sourceId: "chinook-country-sales-mysql",
    datasetId: "ds-chinook-mysql",
    suffix: "mysql",
    schema: "nla_chinook",
  },
  {
    engine: "SQL_SERVER",
    warehouse: "Chinook SQL_SERVER",
    warehouseId: "wh-chinook-mssql",
    sourceId: "chinook-country-sales-mssql",
    datasetId: "ds-chinook-mssql",
    suffix: "mssql",
    schema: "dbo",
  },
] as const;

test("registers, edits, tests and runs persisted four-layer pipelines on all engines", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.NLA_LIVE_E2E !== "true" || !apiBase || !token,
    "Live ingestion test requires explicit local API configuration.",
  );
  test.setTimeout(300000);

  const baseSuffix = process.env.NLA_LIVE_E2E_SUFFIX || `${Date.now()}`;
  expect(baseSuffix).toMatch(/^[A-Za-z0-9_]{1,32}$/);
  const baseHeaders = { Authorization: `Bearer ${token}` };
  const createdSourceIds: string[] = [];

  try {
    for (const target of engineTargets) {
      const sampleResponse = await request.get(
        `${apiBase}/warehouse/ingestion/sources/${target.sourceId}`,
        { headers: baseHeaders },
      );
      expect(
        sampleResponse.ok(),
        `${target.engine} sample source`,
      ).toBeTruthy();
      const sample = (await sampleResponse.json()) as {
        readSql: string;
        columns: string[];
        columnTypes: Record<string, string>;
        requiredColumns: string[];
        maxStringLengths: Record<string, number>;
      };
      const suffix = `${baseSuffix}_${target.suffix}`;
      const sourceName = `FE live pipeline ${suffix} ${Date.now()}`;
      const editedName = `${sourceName} edited`;
      const tableNames = {
        raw: `fe_raw_${suffix}`,
        stage: `fe_stage_${suffix}`,
        warehouse: `fe_wh_${suffix}`,
        mart: `fe_mart_${suffix}`,
      };

      await page.goto("/ingestion");
      await page.getByLabel("Local API token").fill(token!);
      await page.getByRole("button", { name: "Đăng nhập local" }).click();
      await page.getByRole("tab", { name: "Nguồn warehouse" }).click();
      await expect(
        page.getByRole("heading", { name: "Nguồn dữ liệu đã lưu" }),
      ).toBeVisible();
      await selectLiveOption(
        page,
        "Warehouse",
        new RegExp(target.warehouse),
        true,
      );
      await selectLiveOption(page, "Dataset", /^nla_chinook\b/, true);
      await page.getByRole("button", { name: "Đăng ký nguồn" }).click();
      await expect(
        page.getByRole("heading", { name: "Thêm nguồn dữ liệu" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Dùng SQL nâng cao" }).click();
      await page
        .getByLabel("SELECT nguồn", { exact: true })
        .fill(sample.readSql);
      await page.getByRole("button", { name: "Xem trước và tiếp tục" }).click();
      await page.getByLabel("Tên nguồn", { exact: true }).fill(sourceName);
      for (const [key, label] of [
        ["raw", "Raw"],
        ["stage", "Staging"],
        ["warehouse", "Warehouse"],
        ["mart", "Mart"],
      ] as const) {
        await page
          .getByRole("button", { name: `Bảng ${label}`, exact: true })
          .click();
        await page
          .getByRole("option", {
            name: `${target.schema}.${tableNames[key]}`,
            exact: true,
          })
          .click();
      }
      await page.getByRole("button", { name: "Xem lại cấu hình" }).click();
      await page
        .getByRole("button", { name: "Kiểm tra nguồn và bảng đích" })
        .click();
      await expect(
        page.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Lưu nguồn dữ liệu" }).click();
      await expect(
        page.getByText(sourceName, { exact: true }).last(),
      ).toBeVisible({ timeout: 30000 });

      const registered = await request.get(
        `${apiBase}/warehouse/ingestion/sources?warehouseId=${target.warehouseId}&datasetId=${target.datasetId}&page=1&pageSize=100`,
        { headers: baseHeaders },
      );
      expect(registered.ok()).toBeTruthy();
      const registry = (await registered.json()) as {
        items: Array<{ sourceId: string; name: string }>;
      };
      const created = registry.items
        .filter((item) => item.name === sourceName)
        .at(-1);
      expect(created).toBeDefined();
      createdSourceIds.push(created!.sourceId);
      const detailResponse = await request.get(
        `${apiBase}/warehouse/ingestion/sources/${created!.sourceId}`,
        { headers: baseHeaders },
      );
      expect(detailResponse.ok()).toBeTruthy();
      const createdDetail = (await detailResponse.json()) as {
        raw?: { name: string };
      };
      expect(createdDetail.raw?.name).toBe(tableNames.raw);

      const sourceRow = page
        .getByRole("row")
        .filter({ hasText: sourceName })
        .last();
      await sourceRow
        .getByRole("button", { name: `Sửa ${sourceName}` })
        .click();
      await expect(
        page.getByRole("heading", { name: "Sửa nguồn dữ liệu" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Xem trước và tiếp tục" }).click();
      await page.getByLabel("Tên nguồn", { exact: true }).fill(editedName);
      await page.getByRole("button", { name: "Xem lại cấu hình" }).click();
      await page
        .getByRole("button", { name: "Kiểm tra nguồn và bảng đích" })
        .click();
      await expect(
        page.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Lưu nguồn dữ liệu" }).click();
      await expect(
        page.getByText(editedName, { exact: true }).last(),
      ).toBeVisible({ timeout: 30000 });

      const editedRow = page
        .getByRole("row")
        .filter({ hasText: editedName })
        .last();
      await editedRow
        .getByRole("button", { name: `Kiểm tra ${editedName}` })
        .click();
      await expect(
        page.getByText(/dòng mẫu|Nguồn và đích sẵn sàng/i).first(),
      ).toBeVisible({ timeout: 30000 });

      await page.getByLabel("Nguồn dữ liệu").click();
      await page
        .getByRole("option", { name: new RegExp(`${editedName} · ACTIVE$`) })
        .click();
      await page.getByRole("button", { name: "Chạy pipeline mới" }).click();
      await expect(page).toHaveURL(/\/ingestion\/[^/]+$/, { timeout: 30000 });
      await expect(
        page.getByRole("heading", { name: "Chi tiết lần nạp dữ liệu" }),
      ).toBeVisible();
      await expect(
        page.getByText("SUCCESS", { exact: true }).last(),
      ).toBeVisible({
        timeout: 60000,
      });
      await expect(page.getByText("RAW", { exact: true })).toBeVisible();
      await expect(page.getByText("STAGING", { exact: true })).toBeVisible();
      await expect(page.getByText("WAREHOUSE", { exact: true })).toBeVisible();
      await expect(page.getByText("MART", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Lịch sử nạp dữ liệu" }),
      ).toBeVisible();
    }
  } finally {
    for (const sourceId of createdSourceIds) {
      await request.patch(
        `${apiBase}/warehouse/ingestion/sources/${sourceId}`,
        {
          headers: { ...baseHeaders, "Content-Type": "application/json" },
          data: { status: "DISABLED" },
        },
      );
    }
  }
});

async function selectLiveOption(
  page: import("@playwright/test").Page,
  label: string,
  optionName: RegExp,
  exactLabel = false,
) {
  await page.getByRole("button", { name: label, exact: exactLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

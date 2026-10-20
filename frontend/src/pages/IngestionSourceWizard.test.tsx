import { describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderApp, readyDataset } from "../test/render";
import { server } from "../test/server";
import * as f from "../test/fixtures";

const api = "*/api/v1/warehouse/ingestion/sources";
const preview = {
  readSql: f.ingestionSource.readSql,
  sourceEngine: "POSTGRESQL",
  columns: f.sourceTest.columns,
  columnTypes: f.ingestionSource.columnTypes,
  rows: [{ sale_id: 42 }],
  truncated: false,
  checkedAt: f.sourceTest.checkedAt,
};
const targets = f.sourceTest.targets.map((target, index) => ({
  ...f.table,
  ...target,
  tableId: `target-${index}`,
}));
const { sourceId: _sourceId, ...validation } = f.sourceTest;

async function openWizard() {
  const user = userEvent.setup();
  renderApp("/ingestion");
  await readyDataset();
  await user.click(screen.getByRole("tab", { name: "Nguồn warehouse" }));
  await user.click(screen.getByRole("button", { name: "Đăng ký nguồn" }));
  return {
    user,
    dialog: screen.getByRole("dialog", { name: "Thêm nguồn dữ liệu" }),
  };
}
async function chooseSource() {
  const result = await openWizard();
  await result.user.click(
    within(result.dialog).getByRole("button", {
      name: "Bảng cần lấy dữ liệu",
    }),
  );
  await result.user.click(
    await screen.findByRole("option", {
      name: `${f.table.schema}.${f.table.name}`,
    }),
  );
  await result.user.click(
    screen.getByRole("button", { name: "Xem trước và tiếp tục" }),
  );
  await screen.findByText("Dữ liệu sẽ được đưa tới đâu?");
  await result.user.type(
    screen.getByLabelText("Tên nguồn"),
    "Nguồn đã chọn từ database",
  );
  return result;
}
async function chooseTargets(user: ReturnType<typeof userEvent.setup>) {
  for (const [index, label] of [
    "Raw",
    "Staging",
    "Warehouse",
    "Mart",
  ].entries()) {
    await user.click(screen.getByRole("button", { name: `Bảng ${label}` }));
    await user.click(
      await screen.findByRole("option", {
        name: `${targets[index].schema}.${targets[index].name}`,
      }),
    );
  }
}
function handlers() {
  server.use(
    http.post(`${api}/preview`, () => HttpResponse.json(preview)),
    http.get(`${api}/targets`, () => HttpResponse.json(f.page(targets))),
    http.post(`${api}/validate`, () => HttpResponse.json(validation)),
  );
}

describe("guided database source registration", () => {
  it("chooses actual metadata, infers columns, checks before saving and selects the saved source", async () => {
    handlers();
    const previewRequest = vi.fn();
    const savedRequest = vi.fn();
    server.use(
      http.post(`${api}/preview`, async ({ request }) => {
        previewRequest(await request.json());
        return HttpResponse.json(preview);
      }),
      http.post(api, async ({ request }) => {
        const body = await request.json();
        savedRequest(body);
        return HttpResponse.json(
          { ...f.ingestionSource, ...(body as object) },
          { status: 201 },
        );
      }),
    );
    const { user } = await chooseSource();
    expect(previewRequest).toHaveBeenCalledWith({
      sourceWarehouseId: f.warehouses[0].warehouseId,
      sourceDatasetId: f.datasets[0].datasetId,
      tableId: f.table.tableId,
      columns: f.table.columns.map((column) => column.name),
    });
    expect(screen.queryByLabelText("Alias 1")).not.toBeInTheDocument();
    await chooseTargets(user);
    await user.click(screen.getByRole("button", { name: "Xem lại cấu hình" }));
    expect(
      screen.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
    ).toBeDisabled();
    expect(savedRequest).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Kiểm tra nguồn và bảng đích" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Quay lại" }));
    await user.type(screen.getByLabelText("Tên nguồn"), " sửa");
    await user.click(screen.getByRole("button", { name: "Xem lại cấu hình" }));
    expect(
      screen.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Kiểm tra nguồn và bảng đích" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Lưu nguồn dữ liệu" }));
    await waitFor(() => expect(savedRequest).toHaveBeenCalledOnce());
    expect(savedRequest.mock.calls[0][0]).toMatchObject({
      readSql: preview.readSql,
      columns: ["sale_id"],
      columnTypes: { sale_id: "INTEGER" },
      raw: f.ingestionSource.raw,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Nguồn dữ liệu" }),
    ).toHaveTextContent("Nguồn đã chọn từ database sửa");
  });

  it("starts with table selection, clears the dependent dataset when a connection changes, and exposes SQL only on request", async () => {
    const { user, dialog } = await openWizard();
    expect(
      within(dialog).queryByLabelText("SELECT nguồn"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Dataset đích" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", {
        name: "Kết nối nguồn",
      }),
    );
    await user.click(await screen.findByRole("option", { name: /Demo MYSQL/ }));
    expect(
      within(dialog).getByRole("button", {
        name: "Dataset nguồn",
      }),
    ).not.toHaveTextContent(f.datasets[0].name);
    expect(
      within(dialog).getByRole("button", { name: "Bảng cần lấy dữ liệu" }),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: "Dùng SQL nâng cao" }),
    );
    expect(within(dialog).getByLabelText("SELECT nguồn")).toBeVisible();
  });

  it("keeps failed preview and target validation actionable without saving", async () => {
    handlers();
    const save = vi.fn();
    server.use(
      http.post(`${api}/validate`, () =>
        HttpResponse.json(
          {
            error: {
              code: "INGESTION_TARGET_MISMATCH",
              message: "Bảng đích không khớp cột nguồn.",
              correlationId: "test-target",
              retryable: false,
              details: {},
            },
          },
          { status: 409 },
        ),
      ),
      http.post(api, () => {
        save();
        return HttpResponse.json(f.ingestionSource);
      }),
    );
    const { user } = await chooseSource();
    await chooseTargets(user);
    await user.click(screen.getByRole("button", { name: "Xem lại cấu hình" }));
    await user.click(
      screen.getByRole("button", { name: "Kiểm tra nguồn và bảng đích" }),
    );
    await screen.findByText("Bảng đích không khớp cột nguồn.");
    expect(
      screen.getByRole("button", { name: "Lưu nguồn dữ liệu" }),
    ).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(screen.getByLabelText("Tên nguồn")).toHaveValue(
      "Nguồn đã chọn từ database",
    );
  });
});

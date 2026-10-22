import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderApp, readyDataset } from "../test/render";
import { server } from "../test/server";
import * as fixtures from "../test/fixtures";
import { ingestionApi } from "../api/ingestionApi";
import type { FileUpload } from "../api/schema";

const api = "*/api/v1";
const upload: FileUpload = {
  id: "file-upload-1",
  fileName: "actual-accounts.csv",
  fileType: "text/csv",
  fileSize: 31,
  rowCount: 2,
  columnCount: 2,
  columns: [
    {
      sourceName: "Account Name",
      name: "account_name",
      dataType: "STRING",
      nullable: false,
    },
    {
      sourceName: "Balance",
      name: "balance",
      dataType: "DECIMAL",
      nullable: true,
    },
  ],
  previewRows: [
    ["North", "12.50"],
    ["South", null],
  ],
  warnings: [],
  sheets: [],
  expiresAt: "2099-01-01T00:00:00Z",
};
const plan = {
  id: "file-plan-1",
  uploadId: upload.id,
  warehouseId: "wh-demo-pg",
  targetSchema: "analytics",
  targetTable: "actual_accounts",
  datasetName: "Actual Accounts",
  digest: "sha256:plan-digest",
  status: "VALIDATED",
  fileName: upload.fileName,
  rowCount: upload.rowCount,
  columns: upload.columns,
  previewRows: upload.previewRows,
  layers: [
    { name: "RAW", schema: "analytics", table: "actual_accounts_raw" },
    {
      name: "STAGING",
      schema: "analytics",
      table: "actual_accounts_staging",
    },
    {
      name: "WAREHOUSE",
      schema: "analytics",
      table: "actual_accounts_warehouse",
    },
    { name: "MART", schema: "analytics", table: "actual_accounts" },
  ],
  expiresAt: "2099-01-01T00:00:00Z",
  warnings: [],
};
const run = {
  id: "file-run-1",
  sourceKind: "FILE",
  status: "SUCCESS",
  warehouseId: "wh-demo-pg",
  datasetId: "ds-demo-pg",
  fileName: upload.fileName,
  startedAt: "2026-10-20T10:00:00Z",
  completedAt: "2026-10-20T10:00:02Z",
  rowCount: 2,
  rowsLoaded: 2,
  stages: ["RAW", "STAGING", "WAREHOUSE", "MART"].map((name) => ({
    name,
    status: "SUCCESS",
    rowsLoaded: 2,
  })),
  error: null,
  partialFailure: false,
  createdTables: [
    { schema: "analytics", table: "actual_accounts_raw" },
    { schema: "analytics", table: "actual_accounts_staging" },
    { schema: "analytics", table: "actual_accounts_warehouse" },
    { schema: "analytics", table: "actual_accounts" },
  ],
};

describe("file ingestion workflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("analyzes every detected column, validates the plan and shows completed layers", async () => {
    const user = userEvent.setup();
    const discard = vi.spyOn(ingestionApi, "discardFile").mockResolvedValue();
    vi.spyOn(ingestionApi, "uploadFile").mockResolvedValue(upload);
    server.use(
      http.post(`${api}/warehouse/ingestion/files/:uploadId/validate`, () =>
        HttpResponse.json(plan),
      ),
      http.get(`${api}/warehouse/ingestion/files/runs`, () =>
        HttpResponse.json(fixtures.page([])),
      ),
      http.post(`${api}/warehouse/ingestion/files/runs`, () =>
        HttpResponse.json(run, { status: 202 }),
      ),
      http.get(`${api}/warehouse/ingestion/files/runs/:id`, () =>
        HttpResponse.json(run),
      ),
      http.get(`${api}/datasets/:id`, () =>
        HttpResponse.json(fixtures.datasets[0]),
      ),
    );
    const { unmount } = renderApp("/ingestion");
    await readyDataset();
    await user.upload(
      screen.getByLabelText("Chọn file dữ liệu"),
      new File(
        ["Account Name,Balance\nNorth,12.50\nSouth,"],
        "actual-accounts.csv",
        {
          type: "text/csv",
        },
      ),
    );
    expect(await screen.findByText("Ánh xạ cột được phát hiện")).toBeVisible();
    expect(screen.getByLabelText("Tên đích cho Account Name")).toHaveValue(
      "account_name",
    );
    expect(screen.getByLabelText("Tên đích cho Balance")).toHaveValue(
      "balance",
    );
    expect(screen.getByText("12.50")).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText("Namespace / schema"),
      "analytics",
    );
    await user.click(
      screen.getByRole("button", { name: "Kiểm tra và tạo kế hoạch" }),
    );
    expect(await screen.findByText("sha256:plan-digest")).toBeVisible();
    expect(screen.getByText("analytics.actual_accounts_staging")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Xác nhận và nạp dữ liệu" }),
    );
    expect(await screen.findByText("Dataset đã đăng ký.")).toBeVisible();
    expect(screen.getAllByText("SUCCESS · 2 dòng")).toHaveLength(4);
    expect(
      screen.getAllByRole("link", { name: "Mở Data Catalog" }),
    ).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Đặt câu hỏi" })).toHaveLength(
        2,
      ),
    );
    unmount();
    expect(discard).not.toHaveBeenCalled();
  });

  it("requires Operator permission before validation or running", async () => {
    renderApp("/ingestion", ["VIEWER"]);
    await readyDataset();

    expect(
      screen.getByText("Bạn cần quyền Operator để nạp file vào warehouse."),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("Chọn file dữ liệu"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Đang tải lịch sử…")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Nguồn warehouse" })).toBeVisible();
  });

  it("releases its own abandoned temporary upload when leaving the workflow", async () => {
    const user = userEvent.setup();
    const discard = vi.spyOn(ingestionApi, "discardFile").mockResolvedValue();
    vi.spyOn(ingestionApi, "uploadFile").mockResolvedValue(upload);
    const { unmount } = renderApp("/ingestion");
    await readyDataset();
    await user.upload(
      screen.getByLabelText("Chọn file dữ liệu"),
      new File(["a\n1"], "abandoned.csv", { type: "text/csv" }),
    );
    await screen.findByText("Ánh xạ cột được phát hiện");
    unmount();
    await waitFor(() =>
      expect(discard).toHaveBeenCalledExactlyOnceWith(upload.id),
    );
  });

  it("discards only its own late upload response after navigation", async () => {
    const user = userEvent.setup();
    const discard = vi.spyOn(ingestionApi, "discardFile").mockResolvedValue();
    let finish!: (value: FileUpload) => void;
    const response = new Promise<FileUpload>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(ingestionApi, "uploadFile").mockReturnValue(response);
    const { unmount } = renderApp("/ingestion");
    await readyDataset();
    await user.upload(
      screen.getByLabelText("Chọn file dữ liệu"),
      new File(["a\n1"], "late.csv", { type: "text/csv" }),
    );
    unmount();
    finish({ ...upload, id: "late-owned-upload" });
    await waitFor(() =>
      expect(discard).toHaveBeenCalledExactlyOnceWith("late-owned-upload"),
    );
  });
});

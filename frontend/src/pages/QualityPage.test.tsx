import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "../test/server";
import { readyDataset, renderApp } from "../test/render";
import * as fixture from "../test/fixtures";
import { qualityRule, qualityRun } from "../test/qualityFixtures";
import type { QualityRule, QualityRun } from "../api/qualitySchema";
const base = "*/api/v1/datasets/:id/quality";
const config = (rules: QualityRule[] = [qualityRule], revision = "3") => ({
  datasetId: fixture.datasets[0].datasetId,
  rules,
  revision,
});
function installed(
  rules: QualityRule[] = [qualityRule],
  runs: QualityRun[] = [],
) {
  server.use(
    http.get(base + "/rules", ({ params }) =>
      HttpResponse.json({ ...config(rules), datasetId: params.id }),
    ),
    http.get(base + "/runs", () => HttpResponse.json(fixture.page(runs))),
    http.get(base + "/runs/:runId", () =>
      HttpResponse.json(runs[0] || qualityRun),
    ),
  );
}
async function newRule() {
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: "Thêm quy tắc" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const dialog = screen.getByRole("dialog");
  return { user, dialog };
}
async function selectTable(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  label = "Bảng cần kiểm tra",
) {
  await user.click(within(dialog).getByRole("button", { name: label }));
  await user.click(
    await within(dialog).findByRole("option", {
      name: `${fixture.table.schema}.${fixture.table.name}`,
    }),
  );
}
describe("data quality workbench", () => {
  it.each(["NOT_NULL", "UNIQUE", "ROW_COUNT", "REFERENCE"] as const)(
    "builds %s from authorized metadata for OPERATOR",
    async (type) => {
      let saved: { rules: QualityRule[] } | undefined;
      server.use(
        http.put(base + "/rules", async ({ request }) => {
          saved = (await request.json()) as { rules: QualityRule[] };
          return HttpResponse.json(config(saved.rules, "1"));
        }),
      );
      renderApp("/quality", ["OPERATOR"]);
      await readyDataset();
      const { user, dialog } = await newRule();
      await user.type(
        within(dialog).getByLabelText("Tên quy tắc"),
        `New ${type}`,
      );
      await user.selectOptions(
        within(dialog).getByLabelText("Loại kiểm tra"),
        type,
      );
      await selectTable(user, dialog);
      if (type === "ROW_COUNT") {
        await user.type(within(dialog).getByLabelText("Giới hạn dưới"), "0");
        await user.type(
          within(dialog).getByLabelText("Giới hạn trên"),
          "9223372036854775807",
        );
      } else {
        await user.selectOptions(
          within(dialog).getByLabelText("Cột cần kiểm tra"),
          "sale_id",
        );
        if (type === "REFERENCE") {
          await selectTable(user, dialog, "Bảng tham chiếu");
          await user.selectOptions(
            within(dialog).getByLabelText("Cột tham chiếu"),
            "sale_id",
          );
        }
      }
      await user.click(
        within(dialog).getByRole("button", { name: "Áp dụng vào bản nháp" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: "Lưu bộ quy tắc" }));
      await waitFor(() => expect(saved?.rules[0]?.type).toBe(type));
      expect(saved?.rules[0]?.table).toEqual({
        schema: fixture.table.schema,
        name: fixture.table.name,
      });
      expect(saved?.rules[0]).not.toHaveProperty("sql");
      if (type === "REFERENCE")
        expect(saved?.rules[0]).toHaveProperty("referenceColumn", "sale_id");
      if (type === "ROW_COUNT")
        expect(saved?.rules[0]).not.toHaveProperty("column");
    },
  );

  it("has no fake rules or measurements in empty state", async () => {
    renderApp("/quality");
    await readyDataset();
    expect(await screen.findByText("Chưa có quy tắc")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Chạy kiểm tra" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Chất lượng dữ liệu" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText(qualityRule.name)).not.toBeInTheDocument();
  });
  it("saves a metadata-based rule before running and displays exact measured values", async () => {
    let current: QualityRule[] = [];
    let savedBody: unknown;
    const start = vi.fn();
    const running = {
      ...qualityRun,
      status: "RUNNING",
      completedAt: null,
      checks: [],
    };
    server.use(
      http.get(base + "/rules", () => HttpResponse.json(config(current))),
      http.put(base + "/rules", async ({ request }) => {
        const body = (await request.json()) as {
          revision: string;
          rules: QualityRule[];
        };
        savedBody = body;
        current = body.rules;
        return HttpResponse.json(config(current, "4"));
      }),
      http.post(base + "/runs", () => {
        start();
        return HttpResponse.json(running, { status: 202 });
      }),
      http.get(base + "/runs/:runId", () => HttpResponse.json(qualityRun)),
    );
    renderApp("/quality");
    await readyDataset();
    const { user, dialog } = await newRule();
    await user.type(
      within(dialog).getByLabelText("Tên quy tắc"),
      "Valid amount",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Loại kiểm tra"),
      "RANGE",
    );
    await selectTable(user, dialog);
    await user.selectOptions(
      within(dialog).getByLabelText("Cột cần kiểm tra"),
      "net_amount",
    );
    await user.type(
      within(dialog).getByLabelText("Giới hạn dưới"),
      "9007199254740993.12",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Áp dụng vào bản nháp" }),
    );
    expect(
      screen.getByRole("button", { name: "Chạy kiểm tra" }),
    ).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Lưu bộ quy tắc" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Chạy kiểm tra" }),
      ).toBeEnabled(),
    );
    expect(savedBody).toMatchObject({
      revision: "3",
      rules: [
        {
          name: "Valid amount",
          type: "RANGE",
          min: "9007199254740993.12",
          column: "net_amount",
          table: { schema: fixture.table.schema, name: fixture.table.name },
        },
      ],
    });
    expect(JSON.stringify(savedBody)).not.toContain('"sql"');
    await user.click(screen.getByRole("button", { name: "Chạy kiểm tra" }));
    expect(
      await screen.findByText("9.007.199.254.740.993", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Riêng từng kiểm tra (PER_CHECK)"),
    ).toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(1);
  });
  it.each(["VIEWER", "ANALYST"])(
    "lets %s inspect history while hiding write/run controls",
    async (role) => {
      installed([qualityRule], [qualityRun]);
      renderApp("/quality", [role]);
      await readyDataset();
      expect(
        await screen.findByText(qualityRule.name, { selector: "h3" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("9.007.199.254.740.993", {}, { timeout: 4000 }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Thêm quy tắc" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Lưu bộ quy tắc" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Chạy kiểm tra" }),
      ).not.toBeInTheDocument();
    },
  );
  it("preserves a conflicted draft until explicit reload", async () => {
    installed();
    server.use(
      http.put(base + "/rules", () =>
        HttpResponse.json(
          {
            error: {
              code: "QUALITY_RULE_CONFLICT",
              message: "Revision changed; reload",
              correlationId: "conflict-corr",
              retryable: false,
              details: {},
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderApp("/quality");
    await readyDataset();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: `Bỏ ${qualityRule.name} khỏi bản nháp`,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Lưu bộ quy tắc" }));
    expect(
      await screen.findByText("Revision changed; reload"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(qualityRule.name, { selector: "h3" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Tải lại cấu hình sau xung đột" }),
    );
    expect(
      await screen.findByText(qualityRule.name, { selector: "h3" }),
    ).toBeInTheDocument();
  });
  it("uses frozen rule bounds in history even after active config changes", async () => {
    const current: QualityRule = {
      ...qualityRule,
      type: "ROW_COUNT",
      min: "20",
      column: undefined,
    } as unknown as QualityRule;
    Reflect.deleteProperty(current, "column");
    const historic = { ...current, min: "10" };
    const run: QualityRun = {
      ...qualityRun,
      rules: [historic],
      checks: [
        {
          ...qualityRun.checks[0],
          type: "ROW_COUNT",
          column: undefined,
          observedValue: "9",
        },
      ],
    };
    Reflect.deleteProperty(run.checks[0], "column");
    installed([current], [run]);
    renderApp("/quality");
    await readyDataset();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: qualityRule.name }),
    );
    expect(
      await screen.findByText(/Từ 10 đến không giới hạn/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Từ 20 đến không giới hạn/)).toBeInTheDocument();
  });
  it("shows partial errors without inventing zero measurements", async () => {
    const error = {
      code: "QUERY_TIMEOUT",
      message: "Check deadline exceeded",
      correlationId: "timeout-corr",
      retryable: false,
      details: {},
    };
    const run: QualityRun = {
      ...qualityRun,
      status: "ERROR",
      checks: [
        {
          ...qualityRun.checks[0],
          status: "ERROR",
          checkedRows: null,
          violations: null,
          error,
        },
      ],
      error,
    };
    installed([qualityRule], [run]);
    renderApp("/quality");
    await readyDataset();
    expect(
      await screen.findByText("Check deadline exceeded"),
    ).toBeInTheDocument();
    const result = screen
      .getByRole("heading", { name: "Kết quả từng quy tắc" })
      .closest("section")!;
    expect(within(result).getAllByText("—")).toHaveLength(2);
    expect(within(result).queryByText("0")).not.toBeInTheDocument();
  });
  it("clears editor/draft/history when changing warehouse and ignores old reads", async () => {
    server.use(
      http.get(base + "/rules", async ({ params }) => {
        if (params.id === fixture.datasets[0].datasetId) {
          await delay(100);
          return HttpResponse.json(config());
        }
        return HttpResponse.json({
          datasetId: params.id,
          revision: "0",
          rules: [],
        });
      }),
    );
    renderApp("/quality");
    await readyDataset();
    const { user } = await newRule();
    await user.type(screen.getByLabelText("Tên quy tắc"), "Unsaved old source");
    await user.click(screen.getByRole("button", { name: "Warehouse" }));
    await user.click(await screen.findByRole("option", { name: /Demo MYSQL/ }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("Chưa có quy tắc")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved old source")).not.toBeInTheDocument();
    expect(screen.queryByText(qualityRule.name)).not.toBeInTheDocument();
  });
  it("only offers compatible columns and rejects duplicated accepted values", async () => {
    installed([]);
    renderApp("/quality");
    await readyDataset();
    const { user, dialog } = await newRule();
    await user.type(
      within(dialog).getByLabelText("Tên quy tắc"),
      "Allowed regions",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Loại kiểm tra"),
      "ACCEPTED_VALUES",
    );
    await selectTable(user, dialog);
    const columns = within(dialog).getByLabelText("Cột cần kiểm tra");
    await waitFor(() =>
      expect(
        within(columns).getByRole("option", { name: "region · STRING" }),
      ).toBeInTheDocument(),
    );
    expect(
      within(columns).queryByRole("option", { name: /net_amount/ }),
    ).not.toBeInTheDocument();
    await user.selectOptions(columns, "region");
    await user.type(
      within(dialog).getByLabelText("Giá trị cho phép"),
      "same\nsame",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Áp dụng vào bản nháp" }),
    );
    expect(
      await within(dialog).findByText("Các giá trị cho phép phải khác nhau."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/collation/)).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import semanticFixture from "../../../docs/contracts/examples/ai-request.json" with { type: "json" };
import { LocaleProvider } from "../app/providers";
import { readyDataset, renderApp } from "../test/render";
import { server } from "../test/server";
import * as fixtures from "../test/fixtures";
import { AsyncSelect } from "./ui";

const items = [
  { id: "source-a", name: "Source A" },
  { id: "source-b", name: "Source B" },
  { id: "source-c", name: "Source C" },
];

function renderSelector() {
  const select = vi.fn();
  const load = vi.fn(async () => ({ items, page: 1, totalPages: 2 }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (cacheKey: string) => (
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <AsyncSelect
          label="Nguồn dữ liệu"
          cacheKey={cacheKey}
          onSelect={select}
          load={load}
          getId={(item) => item.id}
          getLabel={(item) => item.name}
        />
      </LocaleProvider>
    </QueryClientProvider>
  );
  const rendered = render(tree("dataset-a"));
  return { ...rendered, select, load, tree };
}

describe("accessible shared controls", () => {
  it("names selector pages and returns focus after keyboard selection", async () => {
    const user = userEvent.setup();
    const { select } = renderSelector();
    const trigger = screen.getByRole("button", {
      name: "Nguồn dữ liệu",
    });
    await user.click(trigger);
    const list = await screen.findByRole("listbox", {
      name: "Danh sách Nguồn dữ liệu",
    });
    expect(trigger).toHaveAttribute("aria-controls", list.id);
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    await user.keyboard("{ArrowDown}");
    expect(options[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(options[2]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(options[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(select).toHaveBeenCalledWith(items[2]);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(
      screen.getByRole("button", { name: "Trang trước Nguồn dữ liệu" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Trang sau Nguồn dữ liệu" }),
    ).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("clears a stale selector search/page when its dataset context changes", async () => {
    const user = userEvent.setup();
    const { rerender, tree, load } = renderSelector();
    const trigger = screen.getByRole("button", {
      name: "Nguồn dữ liệu",
    });
    await user.click(trigger);
    await user.type(
      screen.getByRole("textbox", { name: "Tìm Nguồn dữ liệu" }),
      "old",
    );
    await screen.findByRole("listbox");
    await user.click(
      screen.getByRole("button", { name: "Trang sau Nguồn dữ liệu" }),
    );
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        { search: "old", page: 2, pageSize: 20 },
        expect.any(AbortSignal),
      ),
    );
    rerender(tree("dataset-b"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        { search: "", page: 1, pageSize: 20 },
        expect.any(AbortSignal),
      ),
    );
    expect(
      screen.getByRole("textbox", { name: "Tìm Nguồn dữ liệu" }),
    ).toHaveValue("");
  });

  it("dismisses notifications with Escape/outside pointer and keeps keyboard focus useful", async () => {
    const user = userEvent.setup();
    renderApp("/query");
    await readyDataset();
    const trigger = screen.getByRole("button", {
      name: "Thông báo hệ thống",
    });
    await user.click(trigger);
    const region = screen.getByRole("region", { name: "Trạng thái dịch vụ" });
    expect(trigger).toHaveAttribute("aria-controls", region.id);
    expect(
      within(region).getByRole("link", { name: "Mở giám sát" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(
      screen.getByRole("textbox", { name: "Câu hỏi phân tích" }),
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("textbox", { name: "Câu hỏi phân tích" }),
    ).toHaveFocus();
  });

  it.each([
    ["/ingestion", "Chọn cách nạp dữ liệu"],
    ["/semantic", "Định nghĩa ngữ nghĩa"],
  ])(
    "supports roving tab focus, arrows and Home/End on %s",
    async (route, label) => {
      const user = userEvent.setup();
      if (route === "/semantic")
        server.use(
          http.get("*/api/v1/datasets/:id/semantic-model", () =>
            HttpResponse.json(semanticFixture.semanticContext),
          ),
        );
      renderApp(route);
      await readyDataset();
      const group = await screen.findByRole("tablist", { name: label });
      const tabs = within(group).getAllByRole("tab");
      tabs[0].focus();
      await user.keyboard("{ArrowRight}");
      expect(tabs[1]).toHaveFocus();
      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(tabs[0]).toHaveAttribute("tabindex", "-1");
      const panel = screen.getByRole("tabpanel");
      expect(tabs[1]).toHaveAttribute("aria-controls", panel.id);
      await user.keyboard("{End}");
      expect(tabs[tabs.length - 1]).toHaveFocus();
      await user.keyboard("{ArrowRight}");
      expect(tabs[0]).toHaveFocus();
      await user.keyboard("{End}{Home}");
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    },
  );

  it("keeps an explicit page heading and retry action when a query cannot load", async () => {
    server.use(
      http.get("*/api/v1/query/missing-query", () =>
        HttpResponse.json(
          {
            error: {
              code: "QUERY_NOT_FOUND",
              message: "Không tìm thấy truy vấn.",
              correlationId: "test-query-missing",
              retryable: false,
              details: {},
            },
          },
          { status: 404 },
        ),
      ),
    );
    renderApp("/query/missing-query/data");
    await readyDataset();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Không tải được truy vấn",
      }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Không tìm thấy truy vấn.",
    );
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
  });

  it("distinguishes same-name datasets with live descriptions and stable resource IDs", async () => {
    const sharedName = "Imported products";
    const first = {
      ...fixtures.datasets[0],
      name: sharedName,
      description: "Uploaded CSV source",
    };
    const second = {
      ...first,
      datasetId: "ds-json-other",
      description: "Uploaded JSON source",
    };
    server.use(
      http.get("*/api/v1/datasets", () =>
        HttpResponse.json(fixtures.page([first, second])),
      ),
    );
    renderApp("/query");
    await readyDataset();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Dataset" }));
    const list = await screen.findByRole("listbox", {
      name: "Danh sách Dataset",
    });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("data-resource-id", first.datasetId);
    expect(options[1]).toHaveAttribute("data-resource-id", second.datasetId);
    expect(options[0]).toHaveTextContent("Uploaded CSV source");
    expect(options[1]).toHaveTextContent("Uploaded JSON source");
    expect(options[1]).toHaveAccessibleName(
      expect.stringContaining(second.datasetId),
    );
    expect(options[1]).toHaveAttribute(
      "title",
      expect.stringContaining(second.datasetId),
    );
  });
});

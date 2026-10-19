import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ResultTable } from "./ResultTable";
import { queryClientDefaults } from "../app/providers";
import { server } from "../test/server";
import { query } from "../test/fixtures";
function mount(result = query.result!) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: queryClientDefaults })}
    >
      <ResultTable queryId="q-large" initial={result} />
    </QueryClientProvider>,
  );
}
describe("bounded result table", () => {
  it("keeps decimal strings precise and copies original values", async () => {
    const user = userEvent.setup(),
      copy = vi.spyOn(navigator.clipboard, "writeText");
    mount({
      ...query.result!,
      rows: [{ region: "Bắc", total_revenue: "9007199254740993.123456789" }],
    });
    await user.click(
      screen.getByRole("button", { name: "9.007.199.254.740.993,123456789" }),
    );
    expect(copy).toHaveBeenCalledWith("9007199254740993.123456789");
  });
  it("paginates a large snapshot without mounting every row", async () => {
    const result = {
      ...query.result!,
      rows: Array.from({ length: 20 }, (_, i) => ({
        region: `Region ${i + 1}`,
        total_revenue: String(i + 1),
      })),
      returnedRowCount: 1000,
    };
    let url = "";
    server.use(
      http.get("*/api/v1/query/:id/result", ({ request }) => {
        url = request.url;
        const page = Number(new URL(url).searchParams.get("page"));
        return HttpResponse.json({
          ...result,
          page,
          rows: result.rows.map((r, i) => ({
            ...r,
            region: `Region ${(page - 1) * 20 + i + 1}`,
          })),
        });
      }),
    );
    mount(result);
    expect(screen.getAllByRole("row")).toHaveLength(21);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(
      await screen.findByRole("button", { name: "Region 21" }),
    ).toBeVisible();
    expect(new URL(url).searchParams.get("page")).toBe("2");
    expect(screen.getAllByRole("row")).toHaveLength(21);
  });
  it("warns about truncation and never claims unlimited export", () => {
    mount({ ...query.result!, truncated: true });
    expect(screen.getByText(/Kết quả đã được giới hạn/)).toBeVisible();
    expect(screen.getByText(/CSV chỉ bao gồm snapshot này/)).toBeVisible();
  });
  it("reports expired snapshots instead of rerunning SQL", async () => {
    server.use(
      http.get("*/api/v1/query/:id/result", () =>
        HttpResponse.json(
          {
            error: {
              code: "RESULT_EXPIRED",
              message: "Snapshot đã hết hạn",
              correlationId: "expired",
              retryable: false,
              details: {},
            },
          },
          { status: 410 },
        ),
      ),
    );
    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Tìm trong kết quả"), "none");
    await user.click(screen.getByRole("button", { name: "Tìm" }));
    expect(await screen.findByText("Snapshot đã hết hạn")).toBeVisible();
  });
  it("renders strings as text rather than HTML", () => {
    mount({
      ...query.result!,
      rows: [{ region: "<img src=x onerror=alert(1)>", total_revenue: "1" }],
    });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });
  it("renders zero rows explicitly", () => {
    mount({ ...query.result!, rows: [], returnedRowCount: 0 });
    expect(screen.getByText("Không có dòng dữ liệu")).toBeVisible();
  });
});

import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import source from "../../../docs/contracts/examples/ai-request.json" with { type: "json" };
import { renderApp, readyDataset } from "../test/render";
import { server } from "../test/server";
import * as fixture from "../test/fixtures";

const api = "*/api/v1";
describe("dataset-aware analytics controls", () => {
  it("uses current schema suggestions and clears old questions when the warehouse changes", async () => {
    server.use(
      http.get(`${api}/datasets/:id/question-suggestions`, ({ params }) =>
        HttpResponse.json(
          fixture.page([
            {
              suggestionId: `${params.id}-actual`,
              question: `Analyze current station data ${params.id}`,
              description: "Generated from the authorized schema",
              category: "Station analysis",
              origin: "PHYSICAL_SCHEMA",
              chartType: "bar",
              tableRefs: [],
              selectedMetrics: [],
              selectedDimensions: [],
              sqlDialect: String(params.id).includes("mysql")
                ? "MYSQL"
                : "POSTGRESQL",
            },
          ]),
        ),
      ),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    expect(
      (await screen.findAllByText("Từ schema thực")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/phần gợi ý này không gọi AI/)).toBeVisible();
    expect(
      screen.getByText(/chưa tự xác định ý nghĩa nghiệp vụ/),
    ).toBeVisible();
    await user.type(
      screen.getByLabelText("Câu hỏi phân tích"),
      "Old dataset draft",
    );
    await user.click(screen.getByRole("button", { name: "Warehouse" }));
    await user.click(await screen.findByRole("option", { name: /Demo MYSQL/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Câu hỏi phân tích")).toHaveValue(""),
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByText(/Analyze current station data/)
          .every((element) => !element.textContent?.includes("ds-commerce-pg")),
      ).toBe(true),
    );
  });
  it("keeps AI suggestions as an unactivated reviewed draft", async () => {
    const assist = vi.fn();
    const activate = vi.fn();
    const proposed = {
      ...source.semanticContext,
      metrics: source.semanticContext.metrics.map((metric) => ({
        ...metric,
        description: "AI proposal requiring business review",
      })),
    };
    server.use(
      http.get(`${api}/datasets/:id/semantic-model`, () =>
        HttpResponse.json(source.semanticContext),
      ),
      http.post(`${api}/datasets/:id/semantic-assist`, async ({ request }) => {
        assist(await request.json());
        return HttpResponse.json({
          model: "actual-model-test",
          semanticModel: proposed,
          warnings: ["Review the proposed business meaning"],
        });
      }),
      http.put(`${api}/datasets/:id/semantic-model`, () => {
        activate();
        return HttpResponse.json(fixture.datasets[0]);
      }),
    );
    renderApp("/semantic");
    await readyDataset();
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Yêu cầu nghiệp vụ cho AI"),
      "Propose useful measurements from current metadata",
    );
    await user.click(
      screen.getByRole("button", { name: "Đề xuất ngữ nghĩa bằng AI" }),
    );
    expect(
      await screen.findByText("Review the proposed business meaning"),
    ).toBeVisible();
    expect(
      screen.queryByDisplayValue("AI proposal requiring business review"),
    ).not.toBeInTheDocument();
    expect(activate).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Áp dụng vào bản nháp" }),
    );
    expect(
      screen.getByDisplayValue("AI proposal requiring business review"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Lưu và kích hoạt" }),
    ).toBeDisabled();
    expect(assist).toHaveBeenCalledWith({
      instruction: "Propose useful measurements from current metadata",
    });
    expect(activate).not.toHaveBeenCalled();
  });
  it("opens the selected catalog metric in the structured analysis builder", async () => {
    server.use(
      http.get(`${api}/datasets/:id/semantic-model`, () =>
        HttpResponse.json(source.semanticContext),
      ),
    );
    renderApp(
      `/semantic?action=explore&metric=${encodeURIComponent(fixture.metric.name)}`,
    );
    await readyDataset();
    const control = await screen.findByLabelText("Chỉ số (tối đa 10)");
    expect(control).toHaveValue([fixture.metric.name]);
    expect(
      screen.getByRole("button", { name: "Chạy phân tích" }),
    ).toBeEnabled();
  });
});

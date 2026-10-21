import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { readyDataset, renderApp } from "../test/render";
import * as fixture from "../test/fixtures";
import type { ModelProvider } from "../api/modelProviderSchema";

const api = "*/api/v1/settings/model-providers";
const online: ModelProvider = {
  providerId: "profile-online",
  revision: "7",
  name: "Research online",
  kind: "ONLINE",
  baseUrl: "https://provider.example/v1",
  model: "reasoning-small",
  hasApiKey: true,
  enabled: true,
  configured: true,
  source: "APPLICATION",
  readOnly: false,
  updatedAt: "2026-10-21T00:00:00Z",
};
function installProfiles(items: ModelProvider[] = [online]) {
  server.use(
    http.get(api, () =>
      HttpResponse.json({
        ...fixture.modelProviders,
        items: [...fixture.modelProviders.items, ...items],
      }),
    ),
  );
}
describe("model profiles and credential handling", () => {
  it("sends an entered key once without retaining it in browser or React Query caches", async () => {
    let items: ModelProvider[] = [];
    const create = vi.fn();
    const modelCall = vi.fn();
    server.use(
      http.get(api, () =>
        HttpResponse.json({
          ...fixture.modelProviders,
          items: [...fixture.modelProviders.items, ...items],
        }),
      ),
      http.post(api, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        create(body);
        items = [
          {
            ...online,
            ...body,
            providerId: "new-online",
            revision: "1",
            hasApiKey: true,
          } as ModelProvider,
        ];
        Reflect.deleteProperty(items[0], "apiKey");
        return HttpResponse.json(items[0], { status: 201 });
      }),
      http.post("*/api/v1/query", () => {
        modelCall();
        return HttpResponse.json(fixture.query);
      }),
    );
    const { client } = renderApp("/settings");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Thêm cấu hình model" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Tên cấu hình"),
      "Research online",
    );
    await user.type(
      within(dialog).getByLabelText("Base URL tương thích Chat Completions"),
      online.baseUrl,
    );
    await user.type(
      within(dialog).getByLabelText("Tên model chính xác"),
      online.model,
    );
    const password = within(dialog).getByLabelText(
      "API key",
    ) as HTMLInputElement;
    await user.type(password, "test-only-provider-key");
    await user.click(
      within(dialog).getByRole("button", { name: "Lưu cấu hình model" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].apiKey).toBe("test-only-provider-key");
    expect(password.value).toBe("");
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain("test-only-provider-key");
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state.variables),
      ),
    ).not.toContain("test-only-provider-key");
    expect(JSON.stringify(localStorage)).not.toContain(
      "test-only-provider-key",
    );
    expect(JSON.stringify(sessionStorage)).not.toContain(
      "test-only-provider-key",
    );
    expect(modelCall).not.toHaveBeenCalled();
  });
  it("preserves a blank stored key and requires an explicit clear with the current revision", async () => {
    installProfiles();
    const update = vi.fn();
    server.use(
      http.put(`${api}/:id`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        update(body);
        return HttpResponse.json({
          ...online,
          revision: "8",
          enabled: body.enabled,
          hasApiKey: !body.clearApiKey,
        });
      }),
    );
    renderApp("/settings");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Chỉnh sửa" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Lưu cấu hình model",
      }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({
      revision: "7",
      enabled: true,
    });
    expect(update.mock.calls[0][0]).not.toHaveProperty("apiKey");
    expect(update.mock.calls[0][0]).not.toHaveProperty("clearApiKey");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Chỉnh sửa" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText("Xóa API key đã lưu"));
    await user.click(within(dialog).getByLabelText("Bật cấu hình model"));
    await user.click(
      within(dialog).getByRole("button", { name: "Lưu cấu hình model" }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][0]).toMatchObject({
      clearApiKey: true,
      enabled: false,
    });
    expect(update.mock.calls[1][0]).not.toHaveProperty("apiKey");
  });
  it("requires changing the default before deleting a profile and refreshes safe metadata", async () => {
    let defaultProviderId = "environment";
    let items = [online];
    const remove = vi.fn();
    server.use(
      http.get(api, () =>
        HttpResponse.json({
          ...fixture.modelProviders,
          defaultProviderId,
          items: [...fixture.modelProviders.items, ...items],
        }),
      ),
      http.put(`${api}/default`, async ({ request }) => {
        defaultProviderId = ((await request.json()) as { providerId: string })
          .providerId;
        return HttpResponse.json({
          ...fixture.modelProviders,
          defaultProviderId,
          items: [...fixture.modelProviders.items, ...items],
        });
      }),
      http.delete(`${api}/:id`, ({ params }) => {
        remove(params.id);
        items = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp("/settings");
    const user = userEvent.setup();
    const control = await screen.findByLabelText("Chọn cấu hình mặc định");
    await user.selectOptions(control, online.providerId);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Xóa" })).toBeDisabled(),
    );
    await user.selectOptions(control, "environment");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Xóa" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Xóa" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Xóa cấu hình",
      }),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith(online.providerId));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: online.name }),
      ).not.toBeInTheDocument(),
    );
  });
  it("clears password inputs on failed save and on closing an unsaved form", async () => {
    installProfiles();
    server.use(
      http.put(`${api}/:id`, () =>
        HttpResponse.json(
          {
            error: {
              code: "CONFLICT",
              message: "Revision đã thay đổi; tải lại cấu hình.",
              correlationId: "test-conflict",
              retryable: false,
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderApp("/settings");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Chỉnh sửa" }));
    const dialog = screen.getByRole("dialog");
    const password = within(dialog).getByLabelText(
      /API key mới/,
    ) as HTMLInputElement;
    await user.type(password, "test-only-rotated-key");
    await user.click(
      within(dialog).getByRole("button", { name: "Lưu cấu hình model" }),
    );
    await screen.findByText("Revision đã thay đổi; tải lại cấu hình.");
    expect(password.value).toBe("");
    await user.type(password, "unsaved-test-key");
    await user.click(within(dialog).getByRole("button", { name: "Hủy" }));
    expect(password.value).toBe("");
  });
  it("exposes only safe provider metadata to a non-admin", async () => {
    installProfiles();
    renderApp("/settings", ["VIEWER"]);
    expect(await screen.findByText(online.name)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Thêm cấu hình model" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Chỉnh sửa" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });
});
describe("query model selection", () => {
  it("labels AUTO with the real configured model and sends an explicit API provider selection", async () => {
    installProfiles();
    const run = vi.fn();
    server.use(
      http.post("*/api/v1/query", async ({ request }) => {
        run(await request.json());
        return HttpResponse.json(fixture.query, { status: 201 });
      }),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    expect(
      await screen.findByRole("option", {
        name: "Tự động · Ollama local · test-local:small",
      }),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Chế độ xử lý"), "API");
    expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText("Model sẽ gọi"),
      online.providerId,
    );
    await user.type(
      screen.getByLabelText("Câu hỏi phân tích"),
      "Analyze this dataset",
    );
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0]).toMatchObject({
      mode: "API",
      providerId: online.providerId,
    });
  });
  it("reruns an API result with its original provider identity instead of the new default", async () => {
    const run = vi.fn();
    const query = {
      ...fixture.query,
      executionMode: "API",
      model: "actual-model",
      provider: {
        providerId: online.providerId,
        revision: online.revision,
        name: online.name,
        kind: online.kind,
        model: online.model,
        source: online.source,
      },
    };
    server.use(
      http.get("*/api/v1/query/:id", () => HttpResponse.json(query)),
      http.post("*/api/v1/query", async ({ request }) => {
        run(await request.json());
        return HttpResponse.json(query, { status: 201 });
      }),
    );
    renderApp("/query/test-provider-query/overview");
    await readyDataset();
    expect(
      await screen.findByText(
        "API online · actual-model · cấu hình yêu cầu reasoning-small",
      ),
    ).toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Chạy lại truy vấn" }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0]).toMatchObject({
      mode: "API",
      providerId: online.providerId,
    });
  });
  it("explains that Offline matches examples without AI and sends no provider override", async () => {
    installProfiles();
    const run = vi.fn();
    server.use(
      http.post("*/api/v1/query", async ({ request }) => {
        run(await request.json());
        return HttpResponse.json(
          {
            ...fixture.query,
            executionMode: "DETERMINISTIC",
            model: "deterministic",
          },
          { status: 201 },
        );
      }),
    );
    renderApp("/query");
    await readyDataset();
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Chế độ xử lý"),
      "DETERMINISTIC",
    );
    expect(
      screen.getByText(/Offline không gọi AI, Ollama hoặc API/),
    ).toBeVisible();
    expect(screen.queryByLabelText("Model sẽ gọi")).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Câu hỏi phân tích"),
      "An approved example",
    );
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0]).toMatchObject({ mode: "DETERMINISTIC" });
    expect(run.mock.calls[0][0]).not.toHaveProperty("providerId");
  });
});

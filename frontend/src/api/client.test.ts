import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { z } from "zod";
import { request, setTokenProvider, apiUrl, downloadCsv } from "./client";
import { server } from "../test/server";
describe("Java API client", () => {
  it("forwards bearer + correlation header only to the configured Java API", async () => {
    let headers: Headers | undefined;
    server.use(
      http.get("*/api/v1/header-test", ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ ok: true });
      }),
    );
    setTokenProvider(async () => "test-only");
    await request("/header-test", z.object({ ok: z.boolean() }));
    expect(headers!.get("Authorization")).toBe("Bearer test-only");
    expect(headers!.get("X-Correlation-ID")).toMatch(/[\w-]{20,}/);
  });
  it("encodes filters and rejects nonlocal endpoint paths", () => {
    expect(
      apiUrl("/query/history", { search: "a & b", page: 2, status: "" }),
    ).toContain("search=a+%26+b");
    expect(() => apiUrl("//untrusted.example")).toThrow();
    expect(() => apiUrl("/../secret")).toThrow();
  });
  it("rejects malformed JSON instead of treating it as an empty resource", async () => {
    server.use(
      http.get(
        "*/api/v1/bad-json",
        () => new HttpResponse("<html>proxy error</html>"),
      ),
    );
    await expect(
      request("/bad-json", z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects a contract mismatch", async () => {
    server.use(
      http.get("*/api/v1/bad-contract", () => HttpResponse.json({ ok: "yes" })),
    );
    await expect(
      request("/bad-contract", z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });
  it("preserves controlled errors and query correlation", async () => {
    server.use(
      http.post("*/api/v1/error", () =>
        HttpResponse.json(
          {
            error: {
              code: "SQL_SECURITY_ERROR",
              message: "Rejected",
              correlationId: "corr-001",
              retryable: false,
              details: { queryId: "q-001" },
            },
          },
          { status: 422 },
        ),
      ),
    );
    await expect(
      request("/error", z.unknown(), { method: "POST" }),
    ).rejects.toMatchObject({
      code: "SQL_SECURITY_ERROR",
      status: 422,
      correlationId: "corr-001",
      details: { queryId: "q-001" },
    });
  });
  it.each([401, 403, 410, 429, 504])(
    "handles HTTP %s without a JSON error body",
    async (status) => {
      server.use(
        http.get(
          "*/api/v1/plain-error",
          () => new HttpResponse("error", { status }),
        ),
      );
      await expect(request("/plain-error", z.unknown())).rejects.toMatchObject({
        status,
        code: `HTTP_${status}`,
      });
    },
  );
  it("times out without retrying a billable POST", async () => {
    let attempts = 0;
    server.use(
      http.post("*/api/v1/slow", async () => {
        attempts++;
        await delay(200);
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(
      request("/slow", z.unknown(), { method: "POST", timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: "QUERY_TIMEOUT" });
    expect(attempts).toBe(1);
  });
  it("cancels stale reads without rewriting them into network errors", async () => {
    server.use(
      http.get("*/api/v1/cancel", async () => {
        await delay(200);
        return HttpResponse.json({ ok: true });
      }),
    );
    const c = new AbortController();
    const pending = request("/cancel", z.unknown(), { signal: c.signal });
    c.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
  });
  it("handles an offline API", async () => {
    server.use(http.get("*/api/v1/offline", () => HttpResponse.error()));
    await expect(request("/offline", z.unknown())).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
  it("rejects non-CSV export responses", async () => {
    server.use(
      http.get("*/api/v1/query/q/export.csv", () =>
        HttpResponse.json({ result: "not csv" }),
      ),
    );
    await expect(downloadCsv("q")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("downloads using an authorized API request, not a token in a URL", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await downloadCsv("q/001");
    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});

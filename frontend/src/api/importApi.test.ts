import { afterEach, describe, expect, it, vi } from "vitest";
import { importApi } from "./importApi";

describe("SQL import API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts multipart validation fields without overriding the browser boundary", async () => {
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestInit = init;
        return Response.json({
          planId: "plan-1",
          planDigest: "sha256:digest",
          warehouseId: "warehouse-1",
          targetSchema: "analytics",
          sourceDialect: "AUTO_DETECT",
          detectedDialect: "POSTGRESQL",
          targetEngine: "POSTGRESQL",
          mode: "NATIVE",
          statementCount: 1,
          objectCount: 1,
          supportedActions: ["CREATE_TABLE"],
          warnings: [],
          unsupportedFeatures: [],
          preview: {
            statements: [],
            schemas: [],
          },
          expiresAt: "2099-01-01T00:00:00Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["CREATE TABLE t (id INTEGER);"], "schema.sql", {
      type: "text/plain",
    });
    const plan = await importApi.validate({
      file,
      sourceDialect: "AUTO_DETECT",
      warehouseId: "warehouse-1",
      targetSchema: "analytics",
    });

    expect(plan.planId).toBe("plan-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestInit?.method).toBe("POST");
    expect(
      (requestInit?.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
    expect(requestInit?.body).toBeInstanceOf(FormData);
    const form = requestInit?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("sourceDialect")).toBe("AUTO_DETECT");
    expect(form.get("warehouseId")).toBe("warehouse-1");
    expect(form.get("targetSchema")).toBe("analytics");
  });
});

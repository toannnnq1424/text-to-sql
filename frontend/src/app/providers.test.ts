import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { queryClientDefaults, retryApiRead } from "./providers";

describe("Java API read retry policy", () => {
  it("retries only explicitly retryable API errors and stops after two retries", () => {
    const retryable = new ApiError(
      "NETWORK_ERROR",
      "Network unavailable",
      "corr-1",
      0,
      {},
      true,
    );
    const rejected = new ApiError("SQL_SECURITY_ERROR", "Rejected");

    expect(retryApiRead(0, retryable)).toBe(true);
    expect(retryApiRead(1, retryable)).toBe(true);
    expect(retryApiRead(2, retryable)).toBe(false);
    expect(retryApiRead(0, rejected)).toBe(false);
    expect(retryApiRead(0, new DOMException("Aborted", "AbortError"))).toBe(
      false,
    );
  });

  it("keeps automatic retries disabled for mutations", () => {
    expect(queryClientDefaults.mutations.retry).toBe(false);
  });
});

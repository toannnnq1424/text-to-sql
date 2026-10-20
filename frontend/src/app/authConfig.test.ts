import { describe, expect, it } from "vitest";
import { isOidcAuthorityAllowed } from "./auth";

describe("OIDC authority transport", () => {
  it("accepts HTTPS authorities", () => {
    expect(
      isOidcAuthorityAllowed(
        "https://idp.example/realm",
        false,
        false,
        "app.example",
      ),
    ).toBe(true);
  });
  it("allows loopback HTTP only for explicit local applications", () => {
    expect(
      isOidcAuthorityAllowed(
        "http://127.0.0.1:8180/realm",
        false,
        true,
        "127.0.0.1",
      ),
    ).toBe(true);
    expect(
      isOidcAuthorityAllowed(
        "http://localhost:8180/realm",
        true,
        false,
        "localhost",
      ),
    ).toBe(true);
    expect(
      isOidcAuthorityAllowed(
        "http://127.0.0.1:8180/realm",
        false,
        false,
        "127.0.0.1",
      ),
    ).toBe(false);
    expect(
      isOidcAuthorityAllowed(
        "http://127.0.0.1:8180/realm",
        false,
        true,
        "app.example",
      ),
    ).toBe(false);
  });
  it.each([
    "http://idp.example/realm",
    "http://localhost.attacker.example/realm",
    "http://127.0.0.2/realm",
    "ftp://localhost/realm",
    "https://user:password@idp.example/realm",
    "not a URL",
  ])("rejects unsafe authority %s despite local flags", (value) => {
    expect(isOidcAuthorityAllowed(value, true, true, "localhost")).toBe(false);
  });
});

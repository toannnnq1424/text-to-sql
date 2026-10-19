import { describe, it, expect } from "vitest";
import { hasRole, type Role } from "./permissions";
describe("UI role checks without inventing browser privileges", () => {
  it.each(["VIEWER", "ANALYST", "OPERATOR", "ADMIN"] as Role[])(
    "ADMIN can act as %s",
    (role) => expect(hasRole({ roles: ["ADMIN"] }, role)).toBe(true),
  );
  it("does not grant mutation capabilities to VIEWER", () => {
    expect(hasRole({ roles: ["VIEWER"] }, "VIEWER")).toBe(true);
    expect(hasRole({ roles: ["VIEWER"] }, "ANALYST")).toBe(false);
    expect(hasRole({ roles: ["VIEWER"] }, "ADMIN")).toBe(false);
  });
  it("does not conflate operator and analyst permissions", () => {
    expect(hasRole({ roles: ["OPERATOR"] }, "VIEWER")).toBe(true);
    expect(hasRole({ roles: ["OPERATOR"] }, "ANALYST")).toBe(false);
    expect(hasRole({ roles: ["ANALYST"] }, "OPERATOR")).toBe(false);
  });
  it("supports an explicit nested identity-provider claim", () =>
    expect(
      hasRole(
        { realm_access: { roles: ["OPERATOR"] } },
        "OPERATOR",
        "realm_access.roles",
      ),
    ).toBe(true));
  it.each([
    null,
    {},
    { roles: "ADMIN" },
    { roles: [{ ADMIN: true }] },
    { roles: ["admin"] },
  ])("fails closed for missing or malformed roles", (profile) =>
    expect(hasRole(profile, "ADMIN")).toBe(false),
  );
});

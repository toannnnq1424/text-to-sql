export type Role = "VIEWER" | "ANALYST" | "OPERATOR" | "ADMIN";
/** UI capabilities only. Java must authorize every request independently. */
export function hasRole(
  profile: Record<string, unknown> | null,
  required: Role,
  claim = "roles",
): boolean {
  if (!profile) return false;
  let value: unknown = profile;
  for (const key of claim.split(".")) {
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  const roles = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
  const allowed: Record<Role, Role[]> = {
    VIEWER: ["VIEWER", "ANALYST", "OPERATOR", "ADMIN"],
    ANALYST: ["ANALYST", "ADMIN"],
    OPERATOR: ["OPERATOR", "ADMIN"],
    ADMIN: ["ADMIN"],
  };
  return allowed[required].some((role) => roles.includes(role));
}

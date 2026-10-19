import { expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { User } from "oidc-client-ts";
import { AuthContext, type AuthState } from "../app/auth";
import {
  LocaleProvider,
  WarehouseProvider,
  queryClientDefaults,
} from "../app/providers";
import { AppRoutes } from "../App";
export function testAuth(roles = ["ADMIN"]): AuthState {
  return {
    user: new User({
      access_token: "test-only-token",
      token_type: "Bearer",
      profile: {
        iss: "https://test-issuer.invalid",
        aud: "test-client",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        sub: "test-user",
        name: "Test user",
        roles,
      },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }),
    ready: true,
    configured: true,
    error: null,
    can: (role) => roles.includes("ADMIN") || roles.includes(role),
    login: async () => {},
    logout: async () => {},
  };
}
export function renderApp(path = "/", roles = ["ADMIN"]) {
  const client = new QueryClient({ defaultOptions: queryClientDefaults });
  const rendered = render(
    <QueryClientProvider client={client}>
      <AuthContext value={testAuth(roles)}>
        <LocaleProvider>
          <WarehouseProvider>
            <MemoryRouter initialEntries={[path]}>
              <AppRoutes />
            </MemoryRouter>
          </WarehouseProvider>
        </LocaleProvider>
      </AuthContext>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}
export async function readyDataset() {
  await waitFor(() =>
    expect(document.querySelector(".sidebar-status")).toHaveTextContent(
      "ACTIVE",
    ),
  );
}

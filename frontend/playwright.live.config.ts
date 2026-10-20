import { defineConfig, devices } from "@playwright/test";

const liveEnabled = process.env.NLA_LIVE_E2E === "true";
const apiBase = process.env.VITE_API_BASE_URL;
const localApiToken = process.env.LOCAL_API_TOKEN;
const proxyTarget = apiBase?.replace(/\/api\/v1\/?$/, "");

if (liveEnabled && (!apiBase || !localApiToken)) {
  throw new Error(
    "Live E2E requires VITE_API_BASE_URL and LOCAL_API_TOKEN from the ignored local environment.",
  );
}

export default defineConfig({
  testDir: "./e2e-live",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5187",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-live", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 5187",
    url: "http://127.0.0.1:5187",
    reuseExistingServer: false,
    env: {
      VITE_ALLOW_ANONYMOUS_DEV: "true",
      VITE_LOCAL_AUTH: "true",
      VITE_OIDC_AUTHORITY: "",
      VITE_OIDC_CLIENT_ID: "",
      VITE_API_BASE_URL: "/api/v1",
      API_PROXY_TARGET: proxyTarget || "http://127.0.0.1:8086",
    },
    timeout: 30000,
  },
  globalSetup: liveEnabled
    ? undefined
    : async () => {
        throw new Error(
          "Set NLA_LIVE_E2E=true to run against live Java and warehouses.",
        );
      },
  timeout: 120000,
});

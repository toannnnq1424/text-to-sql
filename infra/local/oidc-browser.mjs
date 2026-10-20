#!/usr/bin/env node
/** Actual browser -> Keycloak -> React -> Java check. Never writes token/password artifacts. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("@playwright/test");
const origin = process.env.OIDC_TEST_APP_URL || "http://127.0.0.1:5175";
const api = process.env.OIDC_TEST_API_URL || "http://127.0.0.1:8083/api/v1";
for (const value of [origin, api]) {
  const url = new URL(value);
  assert(
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      !url.username &&
      !url.password,
    "Local OIDC acceptance requires loopback URLs without embedded credentials",
  );
}
const issuer = "http://127.0.0.1:8180/realms/nla";
const accounts = JSON.parse(
  await readFile(path.join(root, ".local/oidc/accounts.json"), "utf8"),
);
const report = {
  mocked: false,
  issuer,
  application: origin,
  api,
  roles: {},
  checks: {},
};
const browser = await chromium.launch({ headless: true });

function boundedFetch(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
}

async function request(route, token, method = "GET") {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return boundedFetch(`${api}${route}`, { headers, method });
}

async function session(page) {
  return page.evaluate((key) => {
    const serialized = sessionStorage.getItem(key);
    return serialized ? JSON.parse(serialized) : null;
  }, `oidc.user:${issuer}:nla-web`);
}

async function login(page, role, wrongPassword = false) {
  await page.goto(`${origin}/query`);
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  const account = accounts.users[role];
  await page.locator("#username").fill(account.username);
  await page
    .locator("#password")
    .fill(wrongPassword ? "deliberately-invalid" : account.password);
  await page.locator("#kc-login").click();
  if (wrongPassword) {
    await page.locator("#input-error-username").waitFor();
    report.checks.invalidPasswordRejected = true;
    await page.locator("#password").fill(account.password);
    await page.locator("#kc-login").click();
  }
  await page.waitForURL(`${origin}/query`);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).waitFor();
  const user = await session(page);
  assert(
    user?.access_token && user?.id_token,
    "OIDC callback did not save a session",
  );
  assert(user.profile.roles.includes(role), "ID token role mapping failed");
  const response = await request("/session", user.access_token);
  assert.equal(
    response.status,
    200,
    "Java did not accept the actual IdP access token",
  );
  const identity = await response.json();
  assert.equal(
    identity.local,
    false,
    "Java unexpectedly enabled local token mode",
  );
  assert(
    typeof identity.subject === "string" && identity.subject.length > 0,
    "Java accepted an access token without a usable subject",
  );
  assert.equal(
    identity.subject,
    user.profile.sub,
    "Browser and Java principal identity differ",
  );
  assert(
    identity.roles.includes(role),
    "Java access-token role mapping failed",
  );
  return user;
}

async function logout(page) {
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.waitForURL(origin + "/");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .waitFor();
  assert.equal(
    await session(page),
    null,
    "Browser retained its OIDC session after signout",
  );
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .first()
    .click();
  await page.locator("#username").waitFor();
}

async function verifyMissingSubjectRejected() {
  const idp = new URL(issuer).origin;
  const credentials = accounts.admin;
  const adminResponse = await boundedFetch(
    `${idp}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        username: credentials.username,
        password: credentials.password,
      }),
    },
  );
  assert.equal(
    adminResponse.status,
    200,
    "Cannot provision isolated negative-test IdP client",
  );
  const administrator = await adminResponse.json();
  const headers = {
    Authorization: `Bearer ${administrator.access_token}`,
    "Content-Type": "application/json",
  };
  const realm = JSON.parse(
    await readFile(
      path.join(root, ".local/oidc/import/nla-realm.json"),
      "utf8",
    ),
  );
  const client = realm.clients[0];
  client.clientId = `nla-negative-${randomUUID()}`;
  client.redirectUris = [`${origin}/oidc-negative-test`];
  client.defaultClientScopes = client.defaultClientScopes.filter(
    (scope) => scope !== "basic",
  );
  const collection = `${idp}/admin/realms/nla/clients`;
  const created = await boundedFetch(collection, {
    method: "POST",
    headers,
    body: JSON.stringify(client),
  });
  assert.equal(created.status, 201, "Negative-test IdP client was not created");
  const resource = created.headers.get("location");
  assert(resource?.startsWith(collection + "/"));
  const context = await browser.newContext();
  try {
    const assignedResponse = await boundedFetch(
      resource + "/default-client-scopes",
      {
        headers,
      },
    );
    assert.equal(assignedResponse.status, 200);
    for (const scope of await assignedResponse.json()) {
      if (scope.name === "basic") {
        const removed = await boundedFetch(
          `${resource}/default-client-scopes/${scope.id}`,
          {
            method: "DELETE",
            headers,
          },
        );
        assert.equal(removed.status, 204);
      }
    }
    const verifier = randomBytes(32).toString("base64url");
    const state = randomUUID();
    const authorization = new URL(`${issuer}/protocol/openid-connect/auth`);
    authorization.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: client.redirectUris[0],
      response_type: "code",
      scope: "openid profile email",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      state,
    }).toString();
    const page = await context.newPage();
    await page.goto(authorization.toString());
    await page.locator("#username").fill(accounts.users.ADMIN.username);
    await page.locator("#password").fill(accounts.users.ADMIN.password);
    await page.locator("#kc-login").click();
    await page.waitForURL((url) => url.pathname === "/oidc-negative-test");
    const callback = new URL(page.url());
    assert.equal(callback.searchParams.get("state"), state);
    const code = callback.searchParams.get("code");
    assert(code, "Negative-test authorization code missing");
    const exchange = await boundedFetch(
      `${issuer}/protocol/openid-connect/token`,
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.clientId,
          redirect_uri: client.redirectUris[0],
          code,
          code_verifier: verifier,
        }),
      },
    );
    assert.equal(exchange.status, 200);
    const tokens = await exchange.json();
    const claims = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url").toString(),
    );
    assert(!claims.sub, "Negative-test token unexpectedly has a subject");
    assert.equal((await request("/session", tokens.access_token)).status, 401);
    report.checks.missingSubjectRejected = true;
  } finally {
    await context.close();
    const removed = await boundedFetch(resource, { method: "DELETE", headers });
    assert.equal(
      removed.status,
      204,
      "Negative-test IdP client cleanup failed",
    );
  }
}

try {
  assert.equal((await request("/session")).status, 401);
  report.checks.anonymousRejected = true;
  for (const role of ["VIEWER", "ANALYST", "OPERATOR", "ADMIN"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const user = await login(page, role, role === "VIEWER");
    assert.equal((await request("/session", user.id_token)).status, 401);
    assert.equal(
      (await request("/session", user.access_token + "tampered")).status,
      401,
    );
    const mutation = await request(
      "/warehouses/wh-chinook-pg/test",
      user.access_token,
      "POST",
    );
    if (role === "ADMIN") {
      assert.equal(
        mutation.status,
        200,
        "Admin cannot test the real registered warehouse",
      );
      const result = await mutation.json();
      assert.equal(result.reachable, true);
      const warehouses = await request("/warehouses", user.access_token);
      assert.equal(warehouses.status, 200);
      report.checks.adminWarehouseConnection = true;
      const originalToken = user.access_token;
      await page.waitForFunction(
        ({ key, token }) => {
          const value = sessionStorage.getItem(key);
          return value && JSON.parse(value).access_token !== token;
        },
        { key: `oidc.user:${issuer}:nla-web`, token: originalToken },
        { timeout: 100_000 },
      );
      const renewed = await session(page);
      assert.equal(
        (await request("/session", renewed.access_token)).status,
        200,
      );
      report.checks.automaticTokenRenewal = true;
      const expiry = JSON.parse(
        Buffer.from(originalToken.split(".")[1], "base64url").toString(),
      ).exp;
      const wait = Math.max(0, expiry * 1000 - Date.now() + 61_000);
      await new Promise((resolve) => setTimeout(resolve, wait));
      assert.equal((await request("/session", originalToken)).status, 401);
      report.checks.expiredAccessTokenRejected = true;
    } else {
      assert.equal(
        mutation.status,
        403,
        `${role} unexpectedly has an admin capability`,
      );
      const scoped = await request(
        "/datasets/ds-chinook-pg/catalog",
        user.access_token,
      );
      assert.equal(
        scoped.status,
        403,
        `${role} unexpectedly has an unassigned dataset grant`,
      );
    }
    await logout(page);
    report.roles[role] = "PASS";
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/callback?error=access_denied&state=invalid`);
  await page
    .getByText(
      "Không thể hoàn tất đăng nhập OIDC. Kiểm tra cấu hình và thử lại.",
    )
    .waitFor();
  assert.equal(await session(page), null);
  report.checks.callbackFailure = true;
  await context.close();
  report.checks.wrongAudienceRejected = true;
  report.checks.tamperedSignatureRejected = true;
  report.checks.realIdpSignout = true;
  await verifyMissingSubjectRejected();
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  // Assertions describe checks only; request bodies/tokens/passwords never enter the report.
  report.failure =
    error instanceof assert.AssertionError
      ? error.message
      : "Browser OIDC check failed";
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(path.join(root, ".local"), { recursive: true });
  await writeFile(
    path.join(root, ".local/oidc-browser-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}

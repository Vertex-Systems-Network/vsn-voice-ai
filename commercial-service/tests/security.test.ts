import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { signEntitlement } from "../lib/crypto";
import { configurationProblems } from "../lib/env";
import { idempotencyKeyFrom, readJsonBody, requestIdFrom, RequestInputError } from "../lib/http";
import { marketplacePlanMap, organizationSeatCapacity } from "../lib/plans";
import {
  consumeOAuthFlowState,
  createGithubSessionCookie,
  createOAuthFlowState,
  githubSessionFromRequest,
} from "../lib/session";

const entitlementKeys = generateKeyPairSync("ed25519");
const entitlementPrivateKey = entitlementKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();

const MANAGED_ENV = [
  "DATABASE_URL", "GITHUB_WEBHOOK_SECRET",
  "GITHUB_MARKETPLACE_APP_ID", "GITHUB_MARKETPLACE_APP_PRIVATE_KEY",
  "GITHUB_MARKETPLACE_CLIENT_ID", "GITHUB_MARKETPLACE_CLIENT_SECRET",
  "GITHUB_VENDOR_APP_ID", "GITHUB_VENDOR_APP_PRIVATE_KEY",
  "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY",
  "ANPOS_ENTITLEMENT_PRIVATE_KEY", "ANPOS_ENTITLEMENT_KEY_ID", "ANPOS_ENTITLEMENT_ISSUER",
  "ANPOS_OPERATOR_TOKEN", "ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID", "ANPOS_MARKETPLACE_PLAN_MAP", "ANPOS_ORG_SEAT_LIMITS",
  "GITHUB_VENDOR_INSTALLATION_ID", "ANPOS_PRIVATE_TEMPLATE_REPO", "ANPOS_COMMERCIAL_RELEASE_REF",
  "ANPOS_PRIVATE_PREMIUM_REPO", "ANPOS_PREMIUM_RELEASE_REF",
  "ANPOS_PREMIUM_MANIFEST_SHA256", "ANPOS_PREMIUM_CONTENT_SET_SHA256",
  "ANPOS_PUBLIC_BASE_URL", "ANPOS_SESSION_SECRET",
] as const;

function configure() {
  process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/anpos";
  process.env.GITHUB_WEBHOOK_SECRET = "w".repeat(48);
  process.env.GITHUB_MARKETPLACE_APP_ID = "123456";
  process.env.GITHUB_MARKETPLACE_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nmarketplace-placeholder\n-----END RSA PRIVATE KEY-----";
  process.env.GITHUB_MARKETPLACE_CLIENT_ID = "Iv1.test-client-123456";
  process.env.GITHUB_MARKETPLACE_CLIENT_SECRET = "c".repeat(48);
  process.env.GITHUB_VENDOR_APP_ID = "654321";
  process.env.GITHUB_VENDOR_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nvendor-placeholder\n-----END RSA PRIVATE KEY-----";
  process.env.ANPOS_ENTITLEMENT_PRIVATE_KEY = entitlementPrivateKey;
  process.env.ANPOS_ENTITLEMENT_KEY_ID = "test-key-1";
  process.env.ANPOS_ENTITLEMENT_ISSUER = "https://license.example.test";
  process.env.ANPOS_OPERATOR_TOKEN = "o".repeat(48);
  process.env.ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID = "1000";
  process.env.ANPOS_MARKETPLACE_PLAN_MAP = JSON.stringify({ "1001": "developer", "1002": "pro", "1003": "team", "1004": "enterprise" });
  process.env.ANPOS_ORG_SEAT_LIMITS = JSON.stringify({ developer: 1, pro: 2, team: 10, enterprise: 100 });
  process.env.GITHUB_VENDOR_INSTALLATION_ID = "12345678";
  process.env.ANPOS_PRIVATE_TEMPLATE_REPO = "Vertex-Systems-Network/anpos-commercial-template";
  process.env.ANPOS_COMMERCIAL_RELEASE_REF = "a".repeat(40);
  process.env.ANPOS_PRIVATE_PREMIUM_REPO = "Vertex-Systems-Network/anpos-premium-pro";
  process.env.ANPOS_PREMIUM_RELEASE_REF = "b".repeat(40);
  process.env.ANPOS_PREMIUM_MANIFEST_SHA256 = "c".repeat(64);
  process.env.ANPOS_PREMIUM_CONTENT_SET_SHA256 = "d".repeat(64);
  process.env.ANPOS_PUBLIC_BASE_URL = "https://license.example.test";
  process.env.ANPOS_SESSION_SECRET = "s".repeat(48);
}

function clearManagedEnv() {
  for (const key of MANAGED_ENV) delete process.env[key];
}

test("plan mapping and organization capacities fail closed", () => {
  clearManagedEnv();
  configure();
  assert.equal(marketplacePlanMap()["1003"], "team");
  assert.equal(organizationSeatCapacity("team", null), 10);
  assert.equal(organizationSeatCapacity("team", 27), 27);

  process.env.ANPOS_MARKETPLACE_PLAN_MAP = JSON.stringify({ "1003": "unknown-plan" });
  assert.throws(() => marketplacePlanMap(), /Invalid ANPOS_MARKETPLACE_PLAN_MAP/);
  process.env.ANPOS_ORG_SEAT_LIMITS = JSON.stringify({ team: 0 });
  assert.throws(() => organizationSeatCapacity("team", null), /ORGANIZATION_SEAT_CAPACITY_NOT_CONFIGURED/);
});

test("user entitlement is v1 and organization seat entitlement is principal-bound v2", () => {
  clearManagedEnv();
  configure();
  const common = {
    issuer: "https://license.example.test",
    license_id: "11111111-1111-4111-8111-111111111111",
    plan_id: "pro",
    seats: 1,
    entitlements: ["private_template_access"],
    issued_at: "2026-09-03T00:00:00.000Z",
    not_before: "2026-09-03T00:00:00.000Z",
    expires_at: "2026-09-04T00:00:00.000Z",
  };
  const personal = signEntitlement({
    ...common,
    subject: { github_account_id: 101, github_account_type: "User", github_login: "alice" },
  });
  assert.equal(personal.format_version, 1);
  assert.equal("principal" in personal, false);
  assert.ok(personal.signature.length > 40);

  const organization = signEntitlement({
    ...common,
    subject: { github_account_id: 202, github_account_type: "Organization", github_login: "acme" },
    principal: { github_user_id: 303, github_login: "bob" },
  });
  assert.equal(organization.format_version, 2);
  assert.deepEqual(organization.principal, { github_user_id: 303, github_login: "bob" });
  assert.ok(organization.signature.length > 40);
});

test("configuration rejects weak missing or mutable production controls", () => {
  clearManagedEnv();
  configure();
  assert.deepEqual(configurationProblems(), []);
  process.env.GITHUB_WEBHOOK_SECRET = "short";
  process.env.ANPOS_OPERATOR_TOKEN = "tiny";
  process.env.GITHUB_MARKETPLACE_CLIENT_SECRET = "tiny";
  process.env.ANPOS_SESSION_SECRET = "tiny";
  process.env.ANPOS_PUBLIC_BASE_URL = "http://license.example.test";
  process.env.ANPOS_COMMERCIAL_RELEASE_REF = "main";
  const problems = configurationProblems();
  assert.ok(problems.includes("weak:GITHUB_WEBHOOK_SECRET"));
  assert.ok(problems.includes("weak:ANPOS_OPERATOR_TOKEN"));
  assert.ok(problems.includes("weak:GITHUB_MARKETPLACE_CLIENT_SECRET"));
  assert.ok(problems.includes("weak:ANPOS_SESSION_SECRET"));
  assert.ok(problems.includes("invalid:ANPOS_PUBLIC_BASE_URL"));
  assert.ok(problems.includes("invalid:ANPOS_COMMERCIAL_RELEASE_REF"));
  delete process.env.ANPOS_ORG_SEAT_LIMITS;
  assert.ok(configurationProblems().includes("missing:ANPOS_ORG_SEAT_LIMITS"));
});

test("Marketplace and vendor GitHub App roles cannot collapse", () => {
  clearManagedEnv();
  configure();
  process.env.GITHUB_VENDOR_APP_ID = process.env.GITHUB_MARKETPLACE_APP_ID;
  assert.ok(configurationProblems().includes("unsafe:GITHUB_APP_ROLE_SEPARATION"));

  process.env.GITHUB_VENDOR_APP_ID = "654321";
  process.env.GITHUB_VENDOR_APP_PRIVATE_KEY = process.env.GITHUB_MARKETPLACE_APP_PRIVATE_KEY;
  assert.ok(configurationProblems().includes("unsafe:GITHUB_APP_PRIVATE_KEY_REUSE"));
});

test("legacy single-app credentials do not satisfy split configuration", () => {
  clearManagedEnv();
  configure();
  delete process.env.GITHUB_MARKETPLACE_APP_ID;
  delete process.env.GITHUB_MARKETPLACE_APP_PRIVATE_KEY;
  delete process.env.GITHUB_VENDOR_APP_ID;
  delete process.env.GITHUB_VENDOR_APP_PRIVATE_KEY;
  process.env.GITHUB_APP_ID = "123456";
  process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nlegacy-placeholder\n-----END RSA PRIVATE KEY-----";
  const problems = configurationProblems();
  assert.ok(problems.includes("missing:GITHUB_MARKETPLACE_APP_ID"));
  assert.ok(problems.includes("missing:GITHUB_VENDOR_APP_ID"));
});

test("Community OAuth state uses PKCE and encrypted short-lived state", () => {
  clearManagedEnv();
  configure();
  const flow = createOAuthFlowState(12345678);
  assert.match(flow.state, /^[A-Za-z0-9_-]+$/);
  assert.match(flow.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.match(flow.stateCookie, /__Host-anpos_oauth_state=/);
  assert.match(flow.stateCookie, /HttpOnly/);
  assert.match(flow.stateCookie, /Secure/);
  assert.match(flow.stateCookie, /SameSite=Lax/);

  const cookie = flow.stateCookie.split(";", 1)[0];
  const request = new Request("https://license.example.test/api/auth/github/callback", { headers: { cookie } });
  const consumed = consumeOAuthFlowState(request, flow.state);
  assert.equal(consumed.installationId, 12345678);
  assert.match(consumed.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(() => consumeOAuthFlowState(request, `${flow.state}x`), /OAUTH_STATE_INVALID/);
});

test("Community browser session is encrypted, HttpOnly, installation-bound and short-lived", () => {
  clearManagedEnv();
  configure();
  const cookieHeader = createGithubSessionCookie({
    accessToken: "ghu_test_access_token_value",
    expiresInSeconds: 3600,
    githubUserId: 303,
    githubLogin: "alice",
    installationId: 12345678,
  });
  assert.match(cookieHeader, /__Host-anpos_session=/);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Lax/);
  assert.equal(cookieHeader.includes("ghu_test_access_token_value"), false);

  const cookie = cookieHeader.split(";", 1)[0];
  const request = new Request("https://license.example.test/community", { headers: { cookie } });
  const session = githubSessionFromRequest(request);
  assert.equal(session?.github_user_id, 303);
  assert.equal(session?.github_login, "alice");
  assert.equal(session?.installation_id, 12345678);
  assert.equal(session?.access_token, "ghu_test_access_token_value");
});

test("request parser bounds bodies and sanitizes caller-controlled identifiers", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "not valid spaces", "idempotency-key": "safe-key_123" },
    body: JSON.stringify({ value: 7 }),
  });
  assert.deepEqual(await readJsonBody<{ value: number }>(request, 1024), { value: 7 });
  assert.match(requestIdFrom(request), /^[0-9a-f-]{36}$/i);
  assert.equal(idempotencyKeyFrom(request), "safe-key_123");

  const oversized = new Request("https://example.test/api", { method: "POST", body: "x".repeat(2048) });
  await assert.rejects(() => readJsonBody(oversized, 128), (error: unknown) => {
    return error instanceof RequestInputError && error.status === 413 && error.code === "request_body_too_large";
  });
});

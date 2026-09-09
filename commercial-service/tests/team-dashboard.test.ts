import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { buildTeamDashboardSummary } from "../lib/team-dashboard";
import { parseTeamInstallationAccount, resolveUserInstallationAccount } from "../lib/team-installation";

process.env.ANPOS_ORG_SEAT_LIMITS = JSON.stringify({ developer: 1, pro: 2, team: 5, enterprise: 100 });

test("Team dashboard exposes reconciled seat capacity without activating support SLA", () => {
  const summary = buildTeamDashboardSummary({
    github_account_id: 9001,
    github_login: "example-org",
    github_account_type: "Organization",
    plan_id: "team",
    marketplace_plan_id: 1003,
    seats: null,
    state: "active",
    features: ["private_template_access", "organization_team_features", "commercial_support"],
    billing_cycle: "monthly",
    billing_updated_at: "2026-09-04T18:00:00Z",
    updated_at: "2026-09-04T18:01:00Z",
  }, [
    { github_user_id: 1, github_login: "alpha", status: "active", assigned_at: "2026-09-01T10:00:00Z" },
    { github_user_id: 2, github_login: "beta", status: "active", assigned_at: "2026-09-02T10:00:00Z" },
    { github_user_id: 3, github_login: "gamma", status: "revoked", assigned_at: "2026-09-03T10:00:00Z", revoked_at: "2026-09-04T10:00:00Z" },
    { github_user_id: "bad", github_login: "ignored", status: "active" },
  ]);

  assert.equal(summary.account.id, 9001);
  assert.equal(summary.plan.id, "team");
  assert.equal(summary.plan.billing_cycle, "monthly");
  assert.equal(summary.plan.billing_authority, "github_marketplace");
  assert.equal(summary.seats.capacity, 5);
  assert.equal(summary.seats.active, 2);
  assert.equal(summary.seats.available, 3);
  assert.equal(summary.seats.assignments.length, 3);
  assert.equal(summary.support.contractual_support_activated_by_source, false);
});

test("Team dashboard refuses non-organization and non-Team-feature entitlements", () => {
  assert.throws(() => buildTeamDashboardSummary({
    github_account_id: 1,
    github_login: "person",
    github_account_type: "User",
    plan_id: "team",
    state: "active",
    features: ["organization_team_features"],
  }, []), /ORGANIZATION_ACCOUNT_REQUIRED/);

  assert.throws(() => buildTeamDashboardSummary({
    github_account_id: 2,
    github_login: "example-org",
    github_account_type: "Organization",
    plan_id: "pro",
    state: "active",
    features: ["private_template_access"],
  }, []), /ORGANIZATION_TEAM_FEATURES_REQUIRED/);
});

test("installation parser binds the expected installation and rejects suspended or malformed accounts", () => {
  const account = parseTeamInstallationAccount({
    id: 44,
    suspended_at: null,
    account: { id: 9001, login: "example-org", type: "Organization" },
  }, 44);
  assert.deepEqual(account, {
    installation_id: 44,
    github_account_id: 9001,
    github_login: "example-org",
    github_account_type: "Organization",
  });

  assert.throws(() => parseTeamInstallationAccount({
    id: 45,
    suspended_at: null,
    account: { id: 9001, login: "example-org", type: "Organization" },
  }, 44), /IDENTITY_MISMATCH/);
  assert.throws(() => parseTeamInstallationAccount({
    id: 44,
    suspended_at: "2026-09-04T00:00:00Z",
    account: { id: 9001, login: "example-org", type: "Organization" },
  }, 44), /INSTALLATION_SUSPENDED/);
  assert.throws(() => parseTeamInstallationAccount({ id: 44, account: { id: 0, login: "", type: "Organization" } }, 44), /ACCOUNT_INVALID/);
});

test("user installation lookup paginates and returns only the authenticated accessible installation", async () => {
  const calls: string[] = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    account: { id: index + 1000, login: `org-${index + 1}`, type: "Organization" },
    suspended_at: null,
  }));
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer user-token");
    if (url.endsWith("page=1")) return Response.json({ total_count: 101, installations: firstPage });
    if (url.endsWith("page=2")) return Response.json({ total_count: 101, installations: [{
      id: 500,
      account: { id: 9500, login: "target-org", type: "Organization" },
      suspended_at: null,
    }] });
    return Response.json({}, { status: 500 });
  });

  const account = await resolveUserInstallationAccount("user-token", 500);
  assert.equal(account.github_account_id, 9500);
  assert.equal(account.github_login, "target-org");
  assert.equal(calls.length, 2);
  mock.reset();
});

test("user installation lookup fails closed when the session cannot access the installation", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ total_count: 0, installations: [] }));
  await assert.rejects(resolveUserInstallationAccount("user-token", 999), /MARKETPLACE_INSTALLATION_USER_ACCESS_REQUIRED/);
  mock.reset();
});

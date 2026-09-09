import { requireGithubOrganizationAdmin } from "@/lib/auth";
import { reconcileEntitlement } from "@/lib/entitlements";
import { requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { listSeats } from "@/lib/seats";
import { githubSessionFromRequest } from "@/lib/session";
import { buildTeamDashboardSummary, loadTeamEntitlementRecord, ORGANIZATION_TEAM_FEATURE } from "@/lib/team-dashboard";
import { resolveUserInstallationAccount } from "@/lib/team-installation";

export const runtime = "nodejs";

function errorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : "TEAM_DASHBOARD_UNAVAILABLE";
  const status = code === "UNAUTHORIZED_GITHUB" ? 401
    : code.includes("ADMIN_REQUIRED") || code.includes("USER_ACCESS_REQUIRED") ? 403
    : code === "ORGANIZATION_ACCOUNT_REQUIRED" || code === "ORGANIZATION_TEAM_FEATURES_REQUIRED" ? 403
    : code === "ENTITLEMENT_NOT_ACTIVE" ? 403
    : code.includes("INVALID_INSTALLATION") || code.includes("IDENTITY_MISMATCH") ? 400
    : code.includes("NOT_FOUND") ? 404
    : 503;
  return Response.json({ ok: false, error: code.toLowerCase() }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const session = githubSessionFromRequest(request);
  if (!session) return errorResponse(new Error("UNAUTHORIZED_GITHUB"));

  try {
    const installation = await resolveUserInstallationAccount(session.access_token, session.installation_id);
    if (installation.github_account_type !== "Organization") throw new Error("ORGANIZATION_ACCOUNT_REQUIRED");

    const target = {
      github_account_id: installation.github_account_id,
      github_login: installation.github_login,
      github_account_type: installation.github_account_type,
    };
    const context = await requireGithubOrganizationAdmin(request, target);
    const rate = await consumeRateLimit(
      "team_dashboard_read",
      `${installation.github_account_id}:${context.user.id}`,
      30,
      60,
    );
    if (!rate.allowed) return rateLimitResponse(rate);

    const requestId = requestIdFrom(request);
    const refreshed = await reconcileEntitlement(installation.github_account_id, requestId);
    if (!["active", "trial", "grace"].includes(refreshed.state)) throw new Error("ENTITLEMENT_NOT_ACTIVE");
    if (
      refreshed.github_account_id !== installation.github_account_id
      || refreshed.github_account_type !== "Organization"
      || refreshed.github_login?.toLowerCase() !== installation.github_login.toLowerCase()
    ) throw new Error("MARKETPLACE_INSTALLATION_ENTITLEMENT_IDENTITY_MISMATCH");
    if (!refreshed.entitlements.includes(ORGANIZATION_TEAM_FEATURE)) {
      throw new Error("ORGANIZATION_TEAM_FEATURES_REQUIRED");
    }

    const [entitlement, seats] = await Promise.all([
      loadTeamEntitlementRecord(installation.github_account_id),
      listSeats(installation.github_account_id),
    ]);
    const summary = buildTeamDashboardSummary(entitlement, seats);

    return Response.json({
      ok: true,
      installation_id: session.installation_id,
      viewer: { github_user_id: context.user.id, github_login: context.user.login, organization_role: "admin" },
      ...summary,
    }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

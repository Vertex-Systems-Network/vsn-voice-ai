import { requireGithubAccountAccess } from "@/lib/auth";
import { getEntitlement, issueEntitlementForPrincipal, reconcileEntitlement } from "@/lib/entitlements";
import { requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accountId = Number(request.headers.get("x-anpos-account-id") ?? "0");
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    return Response.json({ ok: false, error: "x-anpos-account-id_required" }, { status: 400 });
  }
  const current = await getEntitlement(accountId);
  if (!current) return Response.json({ ok: false, error: "entitlement_not_found" }, { status: 404 });

  let user;
  try { user = await requireGithubAccountAccess(request, current); }
  catch (error) {
    const code = error instanceof Error ? error.message : "UNAUTHORIZED_GITHUB";
    return Response.json({ ok: false, error: code.toLowerCase() }, { status: code.startsWith("FORBIDDEN") ? 403 : 401 });
  }

  const decision = await consumeRateLimit("entitlement_refresh", `${accountId}:${user.id}`, 30, 60);
  if (!decision.allowed) return rateLimitResponse(decision);

  const requestId = requestIdFrom(request);
  try {
    const refreshed = await reconcileEntitlement(accountId, requestId);
    if (!["active", "trial", "grace"].includes(refreshed.state)) {
      return Response.json({ ok: false, error: "entitlement_not_active" }, { status: 403 });
    }
    const issued = await issueEntitlementForPrincipal(accountId, user, requestId);
    return Response.json({ ok: true, ...issued }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_RECONCILIATION_UNAVAILABLE";
    if (code === "ORGANIZATION_SEAT_REQUIRED") {
      return Response.json({ ok: false, error: "organization_seat_required" }, { status: 403 });
    }
    return Response.json({ ok: false, error: "billing_reconciliation_unavailable", request_id: requestId }, { status: 503 });
  }
}

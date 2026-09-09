import { db } from "@/lib/db";
import { requireGithubAccountAccess } from "@/lib/auth";
import { getEntitlement, reconcileEntitlement } from "@/lib/entitlements";
import { templateArchiveRedirect, templateReleaseManifest } from "@/lib/github";
import { requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requireActiveSeat } from "@/lib/seats";

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

  const decision = await consumeRateLimit("template_archive", `${accountId}:${user.id}`, 10, 3600);
  if (!decision.allowed) return rateLimitResponse(decision);

  const requestId = requestIdFrom(request);
  try {
    const refreshed = await reconcileEntitlement(accountId, requestId);
    if (!["active", "trial", "grace"].includes(refreshed.state) || !refreshed.entitlements?.includes("private_template_access")) {
      return Response.json({ ok: false, error: "private_template_not_entitled" }, { status: 403 });
    }
    if (refreshed.github_account_type === "Organization") await requireActiveSeat(accountId, user.id);

    const release = await templateReleaseManifest();
    const archive = await templateArchiveRedirect();
    if (archive.release_ref !== release.release_ref) throw new Error("COMMERCIAL_RELEASE_REF_MISMATCH");

    await db().query(
      "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,'template_archive_issued',$2,$3::jsonb)",
      [requestId, accountId, JSON.stringify({
        github_user_id: user.id,
        github_login: user.login,
        repository: archive.repository,
        release_ref: archive.release_ref,
        canonical_source_revision: release.source_revision,
        canonical_source_tree: release.source_tree,
      })],
    );
    return new Response(null, {
      status: 307,
      headers: {
        Location: archive.location,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "archive_delivery_failed";
    if (code === "ORGANIZATION_SEAT_REQUIRED") {
      return Response.json({ ok: false, error: "organization_seat_required" }, { status: 403 });
    }
    return Response.json({ ok: false, error: "archive_delivery_failed", request_id: requestId }, { status: 503 });
  }
}

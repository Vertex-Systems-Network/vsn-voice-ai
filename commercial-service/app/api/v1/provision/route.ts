import { requireGithubAccountAccess } from "@/lib/auth";
import { db, ensureSchema, transaction } from "@/lib/db";
import { getEntitlement, reconcileEntitlement } from "@/lib/entitlements";
import { inviteTemplateCollaborator } from "@/lib/github";
import { idempotencyKeyFrom, inputErrorResponse, readJsonBody, requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requireActiveSeat } from "@/lib/seats";
import { recordTemplateAccessGrant } from "@/lib/template-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (String(process.env.ANPOS_COLLABORATOR_PROVISIONING_ENABLED ?? "false").toLowerCase() !== "true") {
    return Response.json({
      ok: false,
      error: "collaborator_provisioning_disabled",
      recommended: "/api/v1/template/archive",
    }, { status: 409 });
  }

  const idempotencyKey = idempotencyKeyFrom(request);
  if (!idempotencyKey) {
    return Response.json({ ok: false, error: "valid_idempotency-key_required" }, { status: 400 });
  }

  let body: { account_id?: number };
  try { body = await readJsonBody(request); }
  catch (error) { return inputErrorResponse(error) ?? Response.json({ ok: false, error: "invalid_request" }, { status: 400 }); }
  const accountId = Number(body.account_id ?? 0);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    return Response.json({ ok: false, error: "valid_account_id_required" }, { status: 400 });
  }

  await ensureSchema();
  const current = await getEntitlement(accountId);
  if (!current) return Response.json({ ok: false, error: "entitlement_not_found" }, { status: 404 });
  let user;
  try { user = await requireGithubAccountAccess(request, current); }
  catch (error) {
    const code = error instanceof Error ? error.message : "UNAUTHORIZED_GITHUB";
    return Response.json({ ok: false, error: code.toLowerCase() }, { status: code.startsWith("FORBIDDEN") ? 403 : 401 });
  }

  const decision = await consumeRateLimit("collaborator_provision", `${accountId}:${user.id}`, 10, 3600);
  if (!decision.allowed) return rateLimitResponse(decision);

  const requestId = requestIdFrom(request);
  const refreshed = await reconcileEntitlement(accountId, requestId).catch(() => null);
  if (!refreshed || !["active", "trial", "grace"].includes(refreshed.state) || !refreshed.entitlements?.includes("private_template_access")) {
    return Response.json({ ok: false, error: "private_template_not_entitled" }, { status: 403 });
  }
  if (refreshed.github_account_type === "Organization") {
    try { await requireActiveSeat(accountId, user.id); }
    catch { return Response.json({ ok: false, error: "organization_seat_required" }, { status: 403 }); }
  }

  const inserted = await db().query(
    `INSERT INTO provisioning_requests(idempotency_key,github_account_id,target_github_user_id,action,status)
     VALUES ($1,$2,$3,'private_template_collaborator','processing')
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`,
    [idempotencyKey, accountId, user.id],
  );
  if (!inserted.rowCount) {
    const existing = await db().query(
      "SELECT github_account_id,target_github_user_id,status,result FROM provisioning_requests WHERE idempotency_key=$1",
      [idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || Number(row.github_account_id) !== accountId || Number(row.target_github_user_id) !== user.id) {
      return Response.json({ ok: false, error: "idempotency_key_conflict" }, { status: 409 });
    }
    if (row.status === "processing") {
      return Response.json({ ok: false, error: "request_in_progress", replay: true }, { status: 409 });
    }
    return Response.json({ ok: row.status === "completed", replay: true, result: row.result }, { status: row.status === "completed" ? 200 : 503 });
  }

  try {
    const result = await inviteTemplateCollaborator(user.login);
    await recordTemplateAccessGrant(accountId, { id: user.id, login: user.login }, requestId);
    await transaction(async (client) => {
      await client.query(
        "UPDATE provisioning_requests SET status='completed',result=$2::jsonb,completed_at=NOW() WHERE idempotency_key=$1",
        [idempotencyKey, JSON.stringify({ repository: result.repository, invitation_status: result.status })],
      );
      await client.query(
        "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,'private_template_collaborator_provisioned',$2,$3::jsonb)",
        [requestId, accountId, JSON.stringify({ github_user_id: user.id, github_login: user.login, repository: result.repository })],
      );
    });
    return Response.json({ ok: true, provisioned: true, repository: result.repository, invitation_status: result.status }, {
      status: result.status === 201 ? 202 : 200,
    });
  } catch {
    await db().query(
      "UPDATE provisioning_requests SET status='failed',result=$2::jsonb,completed_at=NOW() WHERE idempotency_key=$1",
      [idempotencyKey, JSON.stringify({ error: "provisioning_failed" })],
    );
    return Response.json({ ok: false, error: "provisioning_failed", request_id: requestId }, { status: 503 });
  }
}

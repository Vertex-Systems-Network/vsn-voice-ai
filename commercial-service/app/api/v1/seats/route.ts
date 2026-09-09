import { requireGithubOrganizationAdmin, resolveActiveOrganizationMember } from "@/lib/auth";
import { getEntitlement, reconcileEntitlement } from "@/lib/entitlements";
import { inputErrorResponse, readJsonBody, requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { assignSeat, listSeats, revokeSeat } from "@/lib/seats";
import { processTemplateAccessForUser } from "@/lib/template-access";

export const runtime = "nodejs";

async function organizationAdmin(request: Request, accountId: number) {
  const current = await getEntitlement(accountId);
  if (!current) throw new Error("ENTITLEMENT_NOT_FOUND");
  const context = await requireGithubOrganizationAdmin(request, current);
  const decision = await consumeRateLimit("organization_seat_admin", `${accountId}:${context.user.id}`, 60, 60);
  if (!decision.allowed) return { response: rateLimitResponse(decision) } as const;

  const refreshed = await reconcileEntitlement(accountId, requestIdFrom(request));
  if (!["active", "trial", "grace"].includes(refreshed.state)) throw new Error("ENTITLEMENT_NOT_ACTIVE");
  const verified = await getEntitlement(accountId);
  if (!verified || verified.github_account_type !== "Organization") throw new Error("ORGANIZATION_ACCOUNT_REQUIRED");
  return { context, verified } as const;
}

function accountIdFrom(request: Request): number {
  const accountId = Number(request.headers.get("x-anpos-account-id") ?? "0");
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("VALID_ACCOUNT_ID_REQUIRED");
  return accountId;
}

function errorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const status = code === "ENTITLEMENT_NOT_FOUND" ? 404
    : code.includes("ADMIN_REQUIRED") || code.includes("MEMBERS_PERMISSION_REQUIRED") ? 403
    : code.includes("UNAUTHORIZED") ? 401
    : code === "SEAT_CAPACITY_EXCEEDED" ? 409
    : code.includes("NOT_ACTIVE") ? 403
    : code.includes("INVALID") || code.includes("VALID_ACCOUNT") ? 400
    : code.includes("NOT_FOUND") ? 404
    : 409;
  return Response.json({ ok: false, error: code.toLowerCase() }, { status });
}

export async function GET(request: Request) {
  let accountId: number;
  try { accountId = accountIdFrom(request); }
  catch (error) { return errorResponse(error); }
  try {
    const auth = await organizationAdmin(request, accountId);
    if ("response" in auth) return auth.response;
    return Response.json({ ok: true, account_id: accountId, seats: await listSeats(accountId) }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let body: { account_id?: number; username?: string };
  try { body = await readJsonBody(request); }
  catch (error) { return inputErrorResponse(error) ?? errorResponse(error); }
  const accountId = Number(body.account_id ?? 0);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return errorResponse(new Error("VALID_ACCOUNT_ID_REQUIRED"));
  const username = String(body.username ?? "").trim();
  if (!username) return Response.json({ ok: false, error: "username_required" }, { status: 400 });

  try {
    const auth = await organizationAdmin(request, accountId);
    if ("response" in auth) return auth.response;
    const target = await resolveActiveOrganizationMember(auth.context.token, auth.verified.github_login, username);
    const result = await assignSeat(accountId, target, auth.context.user.id, requestIdFrom(request));
    return Response.json({ ok: true, account_id: accountId, ...result }, { status: result.assigned ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  let body: { account_id?: number; user_id?: number };
  try { body = await readJsonBody(request); }
  catch (error) { return inputErrorResponse(error) ?? errorResponse(error); }
  const accountId = Number(body.account_id ?? 0);
  const userId = Number(body.user_id ?? 0);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return errorResponse(new Error("VALID_ACCOUNT_ID_REQUIRED"));
  if (!Number.isSafeInteger(userId) || userId <= 0) return Response.json({ ok: false, error: "valid_user_id_required" }, { status: 400 });

  try {
    const auth = await organizationAdmin(request, accountId);
    if ("response" in auth) return auth.response;
    const requestId = requestIdFrom(request);
    const result = await revokeSeat(accountId, userId, auth.context.user.id, requestId);
    if (result.revoked && result.github_login) {
      await processTemplateAccessForUser({ id: userId, login: result.github_login }, requestId);
    }
    return Response.json({ ok: true, account_id: accountId, ...result }, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

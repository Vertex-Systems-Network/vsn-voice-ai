import { requireOperator } from "@/lib/auth";
import { reconcileEntitlement } from "@/lib/entitlements";
import { inputErrorResponse, readJsonBody, requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { requireOperator(request); }
  catch { return Response.json({ ok: false, error: "unauthorized" }, { status: 401 }); }

  const decision = await consumeRateLimit("operator_billing_reconcile", "operator", 60, 60);
  if (!decision.allowed) return rateLimitResponse(decision);

  let body: { account_id?: number };
  try { body = await readJsonBody(request, 4096); }
  catch (error) { return inputErrorResponse(error) ?? Response.json({ ok: false, error: "invalid_request" }, { status: 400 }); }
  const accountId = Number(body.account_id ?? 0);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    return Response.json({ ok: false, error: "valid_account_id_required" }, { status: 400 });
  }
  const requestId = requestIdFrom(request);
  try {
    const result = await reconcileEntitlement(accountId, requestId);
    return Response.json({ ok: true, ...result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "reconciliation_failed", request_id: requestId }, { status: 503 });
  }
}

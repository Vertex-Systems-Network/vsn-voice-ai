import { requireOperator } from "@/lib/auth";
import { inputErrorResponse, readJsonBody, requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { processPendingTemplateAccessJobs } from "@/lib/template-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { requireOperator(request); }
  catch { return Response.json({ ok: false, error: "unauthorized" }, { status: 401 }); }

  const decision = await consumeRateLimit("operator_access_reconcile", "operator", 30, 60);
  if (!decision.allowed) return rateLimitResponse(decision);

  let body: { limit?: number };
  try { body = await readJsonBody(request, 4096); }
  catch (error) { return inputErrorResponse(error) ?? Response.json({ ok: false, error: "invalid_request" }, { status: 400 }); }
  const limit = body.limit == null ? 20 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return Response.json({ ok: false, error: "limit_must_be_1_to_50" }, { status: 400 });
  }
  const requestId = requestIdFrom(request);
  try {
    const results = await processPendingTemplateAccessJobs(limit, requestId);
    return Response.json({ ok: true, processed: results.length, results }, { status: 200 });
  } catch {
    return Response.json({ ok: false, error: "access_reconciliation_failed", request_id: requestId }, { status: 503 });
  }
}

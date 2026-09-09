import { db, ensureSchema } from "@/lib/db";
import { sha256, verifyGithubWebhook } from "@/lib/crypto";
import { reconcileEntitlement } from "@/lib/entitlements";
import { inputErrorResponse, readRawBody, requestIdFrom } from "@/lib/http";

export const runtime = "nodejs";

function webhookBodyLimit(): number {
  const configured = Number(process.env.ANPOS_MAX_WEBHOOK_BYTES ?? "1048576");
  if (!Number.isFinite(configured)) return 1_048_576;
  return Math.min(Math.max(Math.trunc(configured), 65_536), 2_097_152);
}

export async function POST(request: Request) {
  let raw: Buffer;
  try { raw = await readRawBody(request, webhookBodyLimit()); }
  catch (error) { return inputErrorResponse(error) ?? Response.json({ ok: false, error: "invalid_webhook_body" }, { status: 400 }); }

  const signature = request.headers.get("x-hub-signature-256");
  const deliveryId = request.headers.get("x-github-delivery")?.trim() ?? "";
  const eventName = request.headers.get("x-github-event")?.trim() ?? "";
  const requestId = requestIdFrom(request);

  if (!/^[A-Za-z0-9-]{8,100}$/.test(deliveryId) || !eventName || eventName.length > 100 || !verifyGithubWebhook(raw, signature)) {
    return Response.json({ ok: false, error: "invalid_webhook" }, { status: 401 });
  }
  if (eventName !== "marketplace_purchase") {
    return Response.json({ ok: true, ignored: true }, { status: 200 });
  }

  let payload: any;
  try { payload = JSON.parse(raw.toString("utf8")); }
  catch { return Response.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const action = String(payload?.action ?? "");
  if (!new Set(["purchased", "changed", "cancelled"]).has(action)) {
    return Response.json({ ok: true, ignored: true, action: action.slice(0, 100) }, { status: 200 });
  }
  const accountId = Number(payload?.marketplace_purchase?.account?.id ?? 0);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    return Response.json({ ok: false, error: "missing_account_id" }, { status: 422 });
  }

  await ensureSchema();
  const digest = sha256(raw);
  const claimed = await db().query(
    `INSERT INTO marketplace_deliveries(
       delivery_id,event_name,action,github_account_id,payload_sha256,status,attempts,processing_started_at
     ) VALUES ($1,$2,$3,$4,$5,'processing',1,NOW())
     ON CONFLICT (delivery_id) DO UPDATE SET
       status='processing',attempts=COALESCE(marketplace_deliveries.attempts,0)+1,
       processing_started_at=NOW(),error=NULL
     WHERE marketplace_deliveries.payload_sha256=EXCLUDED.payload_sha256
       AND (
         marketplace_deliveries.status IN ('received','error')
         OR (marketplace_deliveries.status='processing' AND marketplace_deliveries.processing_started_at < NOW() - interval '15 minutes')
       )
     RETURNING delivery_id,status,attempts`,
    [deliveryId, eventName, action, accountId, digest],
  );

  if (!claimed.rowCount) {
    const existing = await db().query(
      "SELECT payload_sha256,status FROM marketplace_deliveries WHERE delivery_id=$1",
      [deliveryId],
    );
    const row = existing.rows[0];
    if (!row || row.payload_sha256 !== digest) {
      return Response.json({ ok: false, error: "delivery_id_payload_mismatch", request_id: requestId }, { status: 409 });
    }
    if (row.status === "completed") return Response.json({ ok: true, duplicate: true }, { status: 200 });
    return Response.json({ ok: true, already_processing: true }, { status: 202 });
  }

  try {
    const result = await reconcileEntitlement(accountId, requestId);
    await db().query(
      "UPDATE marketplace_deliveries SET status='completed',processed_at=NOW(),result=$2,error=NULL WHERE delivery_id=$1",
      [deliveryId, JSON.stringify(result.state)],
    );
    return Response.json({ ok: true, account_id: accountId, state: result.state }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
    await db().query(
      "UPDATE marketplace_deliveries SET status='error',processed_at=NOW(),result='error',error=$2 WHERE delivery_id=$1",
      [deliveryId, message],
    );
    return Response.json({ ok: false, error: "reconciliation_failed", request_id: requestId }, { status: 503 });
  }
}

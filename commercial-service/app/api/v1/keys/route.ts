import { publicSigningKey } from "@/lib/crypto";
import { missingConfig } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const missing = missingConfig();
  if (missing.includes("ANPOS_ENTITLEMENT_PRIVATE_KEY") || missing.includes("ANPOS_ENTITLEMENT_KEY_ID")) {
    return Response.json({ ok: false, error: "signing_key_not_configured" }, { status: 503 });
  }
  try {
    return Response.json({ keys: [publicSigningKey()] }, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  } catch {
    return Response.json({ ok: false, error: "signing_key_invalid" }, { status: 503 });
  }
}

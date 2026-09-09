import { createPrivateKey } from "node:crypto";
import { db, ensureSchema } from "@/lib/db";
import { configurationProblems, serviceConfig } from "@/lib/env";
import { marketplacePlanMap, organizationSeatCapacity, PLAN_FEATURES } from "@/lib/plans";

export const runtime = "nodejs";

export async function GET() {
  const problems = configurationProblems();
  if (problems.length) {
    return Response.json({ ok: false, status: "not_configured", problems }, { status: 503 });
  }
  try {
    const cfg = serviceConfig();
    const marketplaceKey = createPrivateKey(cfg.githubMarketplaceAppPrivateKeyPem);
    if (marketplaceKey.asymmetricKeyType !== "rsa") throw new Error("github_marketplace_app_key_must_be_rsa");
    const vendorKey = createPrivateKey(cfg.githubVendorAppPrivateKeyPem);
    if (vendorKey.asymmetricKeyType !== "rsa") throw new Error("github_vendor_app_key_must_be_rsa");
    const entitlementKey = createPrivateKey(cfg.entitlementPrivateKeyPem);
    if (entitlementKey.asymmetricKeyType !== "ed25519") throw new Error("entitlement_key_must_be_ed25519");

    marketplacePlanMap();
    for (const planId of Object.keys(PLAN_FEATURES)) organizationSeatCapacity(planId, null);

    await ensureSchema();
    await db().query("SELECT 1");
    return Response.json({ ok: true, status: "ready" }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "readiness_check_failed";
    return Response.json({ ok: false, status: "not_ready", detail }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

import { createPrivateKey } from "node:crypto";
import { db, ensureSchema } from "@/lib/db";
import { communityLaunchConfigurationProblems, marketplaceAppConfig } from "@/lib/env";
import { communityMarketplacePlanId } from "@/lib/plans";

export const runtime = "nodejs";

export async function GET() {
  const problems = communityLaunchConfigurationProblems();
  if (problems.length) {
    return Response.json(
      { ok: false, status: "not_configured", mode: "community", problems },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const cfg = marketplaceAppConfig();
    const marketplaceKey = createPrivateKey(cfg.githubMarketplaceAppPrivateKeyPem);
    if (marketplaceKey.asymmetricKeyType !== "rsa") throw new Error("github_marketplace_app_key_must_be_rsa");
    communityMarketplacePlanId();
    await ensureSchema();
    await db().query("SELECT 1");
    return Response.json(
      { ok: true, status: "ready", mode: "community" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "community_readiness_check_failed";
    return Response.json(
      { ok: false, status: "not_ready", mode: "community", detail },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

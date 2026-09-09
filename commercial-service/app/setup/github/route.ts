import { marketplaceAppConfig } from "@/lib/env";
import { createOAuthFlowState } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = Number(url.searchParams.get("installation_id") ?? "0");
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return Response.json(
      { ok: false, error: "valid_installation_id_required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const cfg = marketplaceAppConfig();
    const flow = createOAuthFlowState(installationId);
    const callbackUrl = `${cfg.publicBaseUrl}/api/auth/github/callback`;
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", cfg.githubMarketplaceClientId);
    authorize.searchParams.set("redirect_uri", callbackUrl);
    authorize.searchParams.set("state", flow.state);
    authorize.searchParams.set("code_challenge", flow.codeChallenge);
    authorize.searchParams.set("code_challenge_method", "S256");

    return new Response(null, {
      status: 302,
      headers: {
        Location: authorize.toString(),
        "Set-Cookie": flow.stateCookie,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: "community_oauth_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

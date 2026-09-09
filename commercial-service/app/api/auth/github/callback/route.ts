import { githubUserFromToken } from "@/lib/auth";
import { marketplaceAppConfig } from "@/lib/env";
import { verifyMarketplaceUserInstallationAccess } from "@/lib/github";
import {
  clearCookie,
  consumeOAuthFlowState,
  createGithubSessionCookie,
  OAUTH_STATE_COOKIE_NAME,
} from "@/lib/session";

export const runtime = "nodejs";

type OAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
};

function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!code || code.length > 4096 || !state || state.length > 512) {
    return Response.json(
      { ok: false, error: "oauth_callback_parameters_required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let flow;
  try {
    flow = consumeOAuthFlowState(request, state);
  } catch {
    return Response.json(
      { ok: false, error: "oauth_state_invalid_or_expired" },
      { status: 400, headers: { "Cache-Control": "no-store", "Set-Cookie": clearCookie(OAUTH_STATE_COOKIE_NAME) } },
    );
  }

  try {
    const cfg = marketplaceAppConfig();
    const callbackUrl = `${cfg.publicBaseUrl}/api/auth/github/callback`;
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.githubMarketplaceClientId,
        client_secret: cfg.githubMarketplaceClientSecret,
        code,
        redirect_uri: callbackUrl,
        code_verifier: flow.codeVerifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error("GITHUB_OAUTH_TOKEN_EXCHANGE_FAILED");
    const token = await tokenResponse.json() as OAuthTokenResponse;
    if (token.error || !token.access_token || token.access_token.length > 4096) {
      throw new Error("GITHUB_OAUTH_TOKEN_EXCHANGE_FAILED");
    }
    if ((token.token_type ?? "bearer").toLowerCase() !== "bearer") {
      throw new Error("GITHUB_OAUTH_TOKEN_TYPE_INVALID");
    }

    const user = await githubUserFromToken(token.access_token);
    await verifyMarketplaceUserInstallationAccess(token.access_token, flow.installationId);
    const expiresIn = Number.isSafeInteger(token.expires_in) && Number(token.expires_in) >= 60
      ? Number(token.expires_in)
      : 8 * 60 * 60;
    const sessionCookie = createGithubSessionCookie({
      accessToken: token.access_token,
      expiresInSeconds: expiresIn,
      githubUserId: user.id,
      githubLogin: user.login,
      installationId: flow.installationId,
    });

    // Community v1 deliberately does not persist GitHub refresh_token values.
    return redirectWithCookies(
      `${cfg.publicBaseUrl}/community?installation_id=${flow.installationId}`,
      [sessionCookie, clearCookie(OAUTH_STATE_COOKIE_NAME)],
    );
  } catch {
    return Response.json(
      { ok: false, error: "github_oauth_authorization_failed" },
      { status: 401, headers: { "Cache-Control": "no-store", "Set-Cookie": clearCookie(OAUTH_STATE_COOKIE_NAME) } },
    );
  }
}

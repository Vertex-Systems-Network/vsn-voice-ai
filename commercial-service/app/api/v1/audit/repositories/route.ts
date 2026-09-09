import { authenticatedGithubContext } from "@/lib/auth";
import { listMarketplaceUserInstallationRepositories } from "@/lib/github";
import { githubSessionFromRequest } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedInstallationId = Number(url.searchParams.get("installation_id") ?? "0");
  if (!Number.isSafeInteger(requestedInstallationId) || requestedInstallationId <= 0) {
    return Response.json(
      { ok: false, error: "valid_installation_id_required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const browserSession = githubSessionFromRequest(request);
  if (browserSession && browserSession.installation_id !== requestedInstallationId) {
    return Response.json(
      { ok: false, error: "installation_session_mismatch" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  let context;
  try { context = await authenticatedGithubContext(request); }
  catch {
    return Response.json(
      { ok: false, error: "unauthorized_github" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await listMarketplaceUserInstallationRepositories(
      context.token,
      requestedInstallationId,
      1,
      100,
    );
    return Response.json(
      {
        ok: true,
        installation_id: requestedInstallationId,
        github_user: { id: context.user.id, login: context.user.login },
        total_count: result.total_count,
        repositories: result.repositories,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: "marketplace_installation_user_access_required" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
}

import { authenticatedGithubContext } from "@/lib/auth";
import { verifyMarketplaceRepositoryAuditInstallation } from "@/lib/github";
import { inputErrorResponse, readJsonBody, requestIdFrom } from "@/lib/http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  auditRepository,
  COMMUNITY_AUDIT_PATHS,
  normalizeRepositorySlug,
  RepositoryAuditError,
} from "@/lib/repository-audit";
import { githubSessionFromRequest } from "@/lib/session";

export const runtime = "nodejs";

type AuditRequestBody = { repository?: unknown };

function githubAuthError(error: unknown): Response {
  const code = error instanceof Error ? error.message : "UNAUTHORIZED_GITHUB";
  const status = code.startsWith("FORBIDDEN") ? 403 : 401;
  return Response.json({ ok: false, error: code.toLowerCase() }, { status });
}

function auditErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof RepositoryAuditError) {
    return Response.json(
      { ok: false, error: error.code, request_id: requestId },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const code = error instanceof Error ? error.message : "REPOSITORY_AUDIT_FAILED";
  const customerSetupErrors = new Set([
    "MARKETPLACE_APP_NOT_INSTALLED_FOR_REPOSITORY",
    "MARKETPLACE_APP_INSTALLATION_SUSPENDED",
    "MARKETPLACE_APP_SINGLE_FILE_READ_REQUIRED",
    "MARKETPLACE_APP_AUDIT_PATHS_NOT_GRANTED",
  ]);
  if (customerSetupErrors.has(code)) {
    return Response.json(
      { ok: false, error: code.toLowerCase(), request_id: requestId },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { ok: false, error: "repository_audit_unavailable", request_id: requestId },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);

  let context;
  try {
    context = await authenticatedGithubContext(request);
  } catch (error) {
    return githubAuthError(error);
  }

  let body: AuditRequestBody;
  try {
    body = await readJsonBody<AuditRequestBody>(request, 4096);
  } catch (error) {
    return inputErrorResponse(error) ?? Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const browserSession = githubSessionFromRequest(request);
  if (browserSession) {
    try {
      const normalized = normalizeRepositorySlug(body.repository);
      const [owner, repo] = normalized.split("/", 2);
      const installationId = await verifyMarketplaceRepositoryAuditInstallation(owner, repo, COMMUNITY_AUDIT_PATHS);
      if (installationId !== browserSession.installation_id) {
        return Response.json(
          { ok: false, error: "installation_session_mismatch", request_id: requestId },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
    } catch (error) {
      return auditErrorResponse(error, requestId);
    }
  }

  let decision;
  try {
    decision = await consumeRateLimit("community_repository_audit", String(context.user.id), 10, 60);
  } catch {
    return Response.json(
      { ok: false, error: "repository_audit_rate_limit_unavailable", request_id: requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!decision.allowed) return rateLimitResponse(decision);

  try {
    const result = await auditRepository(body.repository, context.token);
    return Response.json(
      { ok: true, request_id: requestId, ...result },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Limit": String(decision.limit),
          "X-RateLimit-Remaining": String(decision.remaining),
        },
      },
    );
  } catch (error) {
    return auditErrorResponse(error, requestId);
  }
}

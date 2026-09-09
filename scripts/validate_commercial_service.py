#!/usr/bin/env python3
"""Static safety checks for the vendor-only ANPOS commercial backend."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "commercial-service"
ERRORS: list[str] = []

REQUIRED = [
    "package.json", "tsconfig.json", "next.config.ts", ".env.example", "README.md",
    "lib/env.ts", "lib/db.ts", "lib/crypto.ts", "lib/github.ts", "lib/auth.ts", "lib/session.ts", "lib/entitlements.ts",
    "lib/http.ts", "lib/rate-limit.ts", "lib/plans.ts", "lib/seats.ts", "lib/template-access.ts", "lib/repository-audit.ts", "lib/releases.ts",
    "migrations/001_baseline.sql", "scripts/migrate.ts", "tests/security.test.ts", "tests/repository-audit.test.ts",
    "tests/community-launch.test.ts", "tests/release-channel.test.ts",
    "app/api/health/route.ts", "app/api/ready/route.ts", "app/api/ready/community/route.ts",
    "app/api/webhooks/github/marketplace/route.ts",
    "app/api/auth/github/callback/route.ts", "app/setup/github/route.ts", "app/community/page.tsx", "app/community/CommunityClient.tsx",
    "app/api/v1/keys/route.ts", "app/api/v1/entitlements/current/route.ts", "app/api/v1/reconcile/route.ts",
    "app/api/v1/provision/route.ts", "app/api/v1/seats/route.ts", "app/api/v1/template/archive/route.ts", "app/api/v1/releases/current/route.ts",
    "app/api/v1/access/reconcile/route.ts", "app/api/v1/audit/repository/route.ts", "app/api/v1/audit/repositories/route.ts",
]


def fail(message: str) -> None:
    ERRORS.append(message)


def text(relative: str) -> str:
    path = SERVICE / relative
    if not path.is_file():
        fail(f"missing commercial service file: commercial-service/{relative}")
        return ""
    return path.read_text(encoding="utf-8")


def require_markers(relative: str, markers: tuple[str, ...], label: str) -> None:
    source = text(relative)
    for marker in markers:
        if marker not in source:
            fail(f"{label} missing marker: {marker}")


def main() -> int:
    for relative in REQUIRED:
        text(relative)

    package = json.loads(text("package.json") or "{}")
    if package.get("private") is not True:
        fail("commercial-service/package.json must remain private:true")
    for script in ("build", "typecheck", "test:unit", "migrate", "certify"):
        if script not in (package.get("scripts") or {}):
            fail(f"commercial service missing npm script: {script}")
    if package.get("devDependencies", {}).get("tsx") != "4.23.13":
        fail("commercial service test/migration TypeScript runner must remain explicitly pinned")

    env_example = text(".env.example")
    for name in (
        "DATABASE_URL", "GITHUB_WEBHOOK_SECRET",
        "GITHUB_MARKETPLACE_APP_ID", "GITHUB_MARKETPLACE_APP_PRIVATE_KEY",
        "GITHUB_MARKETPLACE_CLIENT_ID", "GITHUB_MARKETPLACE_CLIENT_SECRET",
        "ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID",
        "GITHUB_VENDOR_APP_ID", "GITHUB_VENDOR_APP_PRIVATE_KEY",
        "ANPOS_MARKETPLACE_PLAN_MAP", "ANPOS_ORG_SEAT_LIMITS", "ANPOS_ENTITLEMENT_PRIVATE_KEY",
        "ANPOS_ENTITLEMENT_KEY_ID", "ANPOS_OPERATOR_TOKEN", "GITHUB_VENDOR_INSTALLATION_ID",
        "ANPOS_PRIVATE_TEMPLATE_REPO", "ANPOS_COMMERCIAL_RELEASE_REF", "ANPOS_COLLABORATOR_PROVISIONING_ENABLED", "ANPOS_MAX_WEBHOOK_BYTES",
        "ANPOS_PUBLIC_BASE_URL", "ANPOS_SESSION_SECRET",
    ):
        if name not in env_example:
            fail(f"commercial service environment contract missing {name}")
    if "GITHUB_APP_ID=" in env_example or "GITHUB_APP_PRIVATE_KEY=" in env_example:
        fail("commercial service environment contract must not advertise legacy single-App credentials")
    if "ANPOS_COLLABORATOR_PROVISIONING_ENABLED=false" not in env_example:
        fail("collaborator provisioning must be off by default in the environment example")
    if "Keep Community outside ANPOS_MARKETPLACE_PLAN_MAP" not in env_example:
        fail("environment example must keep Community identity outside the paid Marketplace plan map")
    if "ANPOS_TEMPLATE_REF=" in env_example:
        fail("paid delivery must not advertise a mutable template branch ref")

    all_source = "\n".join(path.read_text(encoding="utf-8") for path in SERVICE.rglob("*.ts") if path.is_file())
    for forbidden in ("BEGIN PRIVATE KEY-----\\nMII", "ghp_", "github_pat_", "postgresql://postgres:"):
        if forbidden in all_source:
            fail(f"commercial service source appears to contain a committed secret marker: {forbidden}")

    require_markers(
        "lib/env.ts",
        (
            "GITHUB_MARKETPLACE_APP_ID", "GITHUB_MARKETPLACE_APP_PRIVATE_KEY",
            "GITHUB_MARKETPLACE_CLIENT_ID", "GITHUB_MARKETPLACE_CLIENT_SECRET",
            "ANPOS_PUBLIC_BASE_URL", "ANPOS_SESSION_SECRET", "ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID",
            "communityLaunchConfigurationProblems", "marketplaceAppConfig", "databaseConfig", "webhookConfig",
            "GITHUB_VENDOR_APP_ID", "GITHUB_VENDOR_APP_PRIVATE_KEY", "ANPOS_COMMERCIAL_RELEASE_REF", "commercialReleaseRef",
            "unsafe:GITHUB_APP_ROLE_SEPARATION", "unsafe:GITHUB_APP_PRIVATE_KEY_REUSE",
            "weak:GITHUB_MARKETPLACE_CLIENT_SECRET", "weak:ANPOS_SESSION_SECRET",
        ),
        "commercial configuration",
    )
    require_markers(
        "lib/plans.ts",
        (
            "communityMarketplacePlanId", "resolveMarketplacePlan", 'planId: "community"', "paid: false",
            "ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID", "marketplacePlanMap", "marketplaceId === communityId",
            'developer: ["private_template_access", "protocol_update_channel"]',
        ),
        "Marketplace plan resolution",
    )
    require_markers(
        "app/api/webhooks/github/marketplace/route.ts",
        (
            "x-hub-signature-256", "x-github-delivery", "marketplace_purchase", "readRawBody",
            "delivery_id_payload_mismatch", "already_processing", "processing_started_at", "status='error'",
            "payload?.marketplace_purchase?.account?.id",
        ),
        "Marketplace webhook",
    )
    require_markers(
        "lib/releases.ts",
        (
            "parseTemplateReleaseManifest", "canonical-minus-vendor-only-paths", "committed_git_blobs_at_head",
            "tracked_source_only", "contains_secrets", "COMMERCIAL_RELEASE_FILE_COUNT_MISMATCH",
            "COMMERCIAL_RELEASE_TOTAL_BYTES_MISMATCH", "INVALID_COMMERCIAL_RELEASE_FILE_DIGEST",
        ),
        "certified release manifest verifier",
    )
    require_markers(
        "lib/github.ts",
        (
            "marketplace_listing/accounts", "2026-03-10", "RSA-SHA256", "access_tokens", "permissions",
            'githubAppJwt("marketplace")', 'githubAppJwt("vendor")', "marketplaceAppConfig", "serviceConfig",
            "githubMarketplaceAppId", "githubVendorAppId",
            'contents: "read"', 'administration: "write"', "zipball", "redirect: \"manual\"",
            "removeTemplateCollaborator", "codeload.github.com", "verifyMarketplaceRepositoryAuditInstallation",
            "MARKETPLACE_APP_SINGLE_FILE_READ_REQUIRED", "MARKETPLACE_APP_AUDIT_PATHS_NOT_GRANTED",
            "/user/installations/", "listMarketplaceUserInstallationRepositories", "verifyMarketplaceUserInstallationAccess",
            "templateReleaseManifest", "EXPORT-MANIFEST.json", "application/vnd.github.raw+json", "commercialReleaseRef",
        ),
        "GitHub client",
    )
    require_markers(
        "lib/session.ts",
        (
            "marketplaceAppConfig", "aes-256-gcm", "__Host-anpos_session", "__Host-anpos_oauth_state", "HttpOnly", "Secure", "SameSite=Lax",
            "createOAuthFlowState", "codeChallenge", "code_verifier", "consumeOAuthFlowState", "createGithubSessionCookie",
            "MAX_SESSION_TTL_SECONDS", "githubSessionFromRequest",
        ),
        "Community OAuth/session protection",
    )
    require_markers(
        "lib/crypto.ts",
        ("webhookConfig", "timingSafeEqual", "Ed25519", "base64url", "principal?", "claims.principal ? 2 : 1"),
        "entitlement/webhook cryptography",
    )
    require_markers(
        "lib/auth.ts",
        ("githubSessionTokenFromRequest", "githubUserFromToken", "authenticatedGithubContext"),
        "GitHub authentication",
    )
    require_markers(
        "app/setup/github/route.ts",
        (
            "marketplaceAppConfig", "installation_id", "createOAuthFlowState", "https://github.com/login/oauth/authorize",
            "code_challenge", "code_challenge_method", "S256", "Set-Cookie", "no-store",
        ),
        "Marketplace Setup OAuth handoff",
    )
    require_markers(
        "app/api/auth/github/callback/route.ts",
        (
            "marketplaceAppConfig", "consumeOAuthFlowState", "https://github.com/login/oauth/access_token", "code_verifier",
            "githubUserFromToken", "verifyMarketplaceUserInstallationAccess", "createGithubSessionCookie",
            "does not persist GitHub refresh_token", "Set-Cookie",
        ),
        "Marketplace OAuth callback",
    )
    require_markers(
        "lib/repository-audit.ts",
        (
            "COMMUNITY_AUDIT_PATHS", "MAX_CONTROL_FILE_BYTES", "source_code_read: false",
            "not_persisted_by_repository_audit", "uninitialized_child", "active_child", "partial_or_malformed",
            "verifyMarketplaceRepositoryAuditInstallation", "repositoryMetadata", "control_files_present",
            "userToken",
        ),
        "Community repository audit engine",
    )
    require_markers(
        "app/api/v1/audit/repository/route.ts",
        (
            "authenticatedGithubContext", "community_repository_audit", "10, 60", "auditRepository",
            "MARKETPLACE_APP_NOT_INSTALLED_FOR_REPOSITORY", "githubSessionFromRequest", "installation_session_mismatch",
            "Cache-Control", "no-store",
        ),
        "Community repository audit API",
    )
    require_markers(
        "app/api/v1/audit/repositories/route.ts",
        (
            "githubSessionFromRequest", "installation_session_mismatch", "authenticatedGithubContext",
            "listMarketplaceUserInstallationRepositories", "marketplace_installation_user_access_required", "no-store",
        ),
        "Community repository discovery API",
    )
    require_markers(
        "app/community/CommunityClient.tsx",
        ("Repository Readiness Audit", "/api/v1/audit/repositories", "/api/v1/audit/repository", "Application source read"),
        "Community audit customer UI",
    )
    require_markers(
        "lib/entitlements.ts",
        (
            "resolveMarketplacePlan", "resolvedPlan.paid", "requireActiveSeat", "issueEntitlementForPrincipal", "principal:",
            'accountType === "Organization"', "signed_entitlement: envelope", "revokeAllTemplateGrantsForSource", "revoked > 0",
        ),
        "entitlement engine",
    )

    database_runtime = text("lib/db.ts")
    for marker in ("databaseConfig", "commercial_schema_migrations", "001_baseline.sql", "to_regclass", "query_timeout", "COMMERCIAL_DATABASE_MIGRATION_REQUIRED"):
        if marker not in database_runtime:
            fail(f"commercial database runtime gate missing marker: {marker}")
    if "CREATE TABLE" in database_runtime.upper():
        fail("normal commercial request runtime must not execute CREATE TABLE migrations")

    require_markers(
        "migrations/001_baseline.sql",
        ("marketplace_deliveries", "rate_limit_windows", "organization_seat_assignments", "template_access_grants", "access_reconciliation_jobs", "commercial_audit_log"),
        "commercial baseline migration",
    )
    require_markers(
        "scripts/migrate.ts",
        ("pg_advisory_lock", "checksum_sha256", "CREATE TABLE IF NOT EXISTS commercial_schema_migrations", "BEGIN", "ROLLBACK", "Applied migration checksum changed"),
        "commercial migration runner",
    )
    require_markers(
        "lib/rate-limit.ts",
        ("ON CONFLICT (scope,subject,window_start)", "request_count=rate_limit_windows.request_count + 1", "Retry-After"),
        "rate limiter",
    )
    require_markers(
        "app/api/v1/seats/route.ts",
        ("requireGithubOrganizationAdmin", "resolveActiveOrganizationMember", "assignSeat", "revokeSeat", "organization_seat_admin"),
        "organization seat API",
    )
    require_markers(
        "app/api/v1/releases/current/route.ts",
        (
            "protocol_update_channel", "reconcileEntitlement", "requireActiveSeat", "templateReleaseManifest",
            "protocol_release_metadata_issued", "certified_protocol_updates", "archive_endpoint", "private, no-store",
        ),
        "certified protocol update channel",
    )
    require_markers(
        "app/api/v1/template/archive/route.ts",
        (
            "templateArchiveRedirect", "templateReleaseManifest", "requireActiveSeat", "template_archive", "release_ref",
            "canonical_source_revision", "Cache-Control", "307",
        ),
        "template archive delivery",
    )
    require_markers(
        "app/api/v1/provision/route.ts",
        ("ANPOS_COLLABORATOR_PROVISIONING_ENABLED", "idempotency_key_conflict", "ON CONFLICT (idempotency_key) DO NOTHING", "recordTemplateAccessGrant", "requireActiveSeat"),
        "collaborator provisioning",
    )
    require_markers(
        "lib/template-access.ts",
        ("retained_due_to_other_active_grant", "removeTemplateCollaborator", "access_reconciliation_jobs", "retry_queued"),
        "template access revocation",
    )
    require_markers(
        "app/api/ready/community/route.ts",
        (
            "communityLaunchConfigurationProblems", "marketplaceAppConfig", "communityMarketplacePlanId",
            "github_marketplace_app_key_must_be_rsa", 'mode: "community"', "ensureSchema", 'db().query("SELECT 1")',
        ),
        "Community readiness gate",
    )
    require_markers(
        "app/api/ready/route.ts",
        (
            "configurationProblems", "githubMarketplaceAppPrivateKeyPem", "githubVendorAppPrivateKeyPem",
            "github_marketplace_app_key_must_be_rsa", "github_vendor_app_key_must_be_rsa",
            '"ed25519"', "organizationSeatCapacity", "ensureSchema",
        ),
        "full commercial readiness gate",
    )
    require_markers(
        "tests/security.test.ts",
        (
            "plan mapping and organization capacities fail closed", "principal-bound v2", "request_body_too_large",
            "weak:GITHUB_WEBHOOK_SECRET", "Marketplace and vendor GitHub App roles cannot collapse",
            "legacy single-app credentials do not satisfy split configuration", "Community OAuth state uses PKCE",
            "Community browser session is encrypted", "ANPOS_COMMERCIAL_RELEASE_REF", "mutable production controls",
        ),
        "commercial security unit tests",
    )
    require_markers(
        "tests/community-launch.test.ts",
        (
            "Community launch config is independent from paid and vendor secrets",
            "Community Marketplace identity stays outside paid plan mapping",
            "Community Marketplace plan identity fails closed when malformed",
            "missing:GITHUB_VENDOR_APP_ID", "paid: false",
        ),
        "Community launch unit tests",
    )
    require_markers(
        "tests/release-channel.test.ts",
        (
            "certified release manifest requires deterministic template export evidence",
            "commercial release manifest rejects mutable or unverifiable identity",
            "paid plans include certified update channel while provider compatibility stays core",
            "protocol_update_channel", "standard_provider_adapters",
        ),
        "certified release channel unit tests",
    )
    require_markers(
        "tests/repository-audit.test.ts",
        (
            "exactly ten ANPOS control files", "baseline_present", "uninitialized_child",
            "canonical_source", "needs_repair", "not_anpos",
        ),
        "Community repository audit unit tests",
    )

    entitlement_schema = json.loads((ROOT / "schemas/license-entitlement.schema.json").read_text(encoding="utf-8"))
    schema_text = json.dumps(entitlement_schema, sort_keys=True)
    for marker in ('"principal"', '"format_version"', '"const": 2', '"github_account_type": {"const": "Organization"}'):
        if marker not in schema_text:
            fail(f"license entitlement schema missing seat-bound envelope marker: {marker}")

    api_contract = json.loads((ROOT / "blueprints/commercial/service-api-contract.json").read_text(encoding="utf-8"))
    if api_contract.get("schema_version") != 6:
        fail("commercial service API contract must be schema_version 6")
    contract_text = json.dumps(api_contract, sort_keys=True)
    for marker in (
        "/v1/releases/current", "/v1/template/archive", "/v1/seats", "/v1/access/reconcile", "/v1/audit/repository",
        "organization_consumption_requires_explicit_seat_principal", "community_repository_audit_must_not_read_application_source",
        "paid_release_ref_must_be_immutable_commit_sha", "paid_release_manifest_must_be_verified_before_metadata_or_archive_delivery",
        "protocol_update_channel", '"single_file": "read"', "not_persisted_by_repository_audit",
    ):
        if marker not in contract_text:
            fail(f"commercial service API contract missing marker: {marker}")

    catalog = json.loads((ROOT / "config/licensing/product-catalog.json").read_text(encoding="utf-8"))
    plans_source = text("lib/plans.ts")
    for plan in catalog.get("plans", []):
        plan_id = plan.get("id")
        if plan_id and f"{plan_id}:" not in plans_source:
            fail(f"commercial runtime plan map missing catalog plan: {plan_id}")
        for entitlement in plan.get("entitlements", []):
            if entitlement not in plans_source:
                fail(f"commercial runtime plan features missing catalog entitlement: {plan_id}:{entitlement}")
        if "standard_provider_adapters" in plan.get("entitlements", []):
            fail(f"core provider compatibility must not be sold as paid entitlement: {plan_id}")

    control = json.loads((ROOT / "config/security/control-plane-policy.json").read_text(encoding="utf-8"))
    if "/commercial-service/**" not in control.get("protected_paths", []):
        fail("commercial service must be a protected control-plane path")
    ownership = json.loads((ROOT / "config/github/path-ownership.json").read_text(encoding="utf-8"))
    if not any(rule.get("pattern") == "/commercial-service/**" and rule.get("independent_review_required") is True for rule in ownership.get("rules", [])):
        fail("commercial service must require independent protected review")
    codeowners = (ROOT / ".github/CODEOWNERS").read_text(encoding="utf-8")
    if "/commercial-service/" not in codeowners:
        fail("source CODEOWNERS must protect commercial-service")

    bootstrap = (ROOT / "scripts/bootstrap_child.py").read_text(encoding="utf-8")
    if "commercial-service" not in bootstrap or "shutil.rmtree" not in bootstrap:
        fail("canonical child bootstrap must strip vendor-only commercial service")

    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for marker in ("commercial-service/node_modules/", "commercial-service/.next/", "commercial-service/.vercel/"):
        if marker not in ignore:
            fail(f".gitignore missing commercial service generated path: {marker}")

    if any((SERVICE / name).exists() for name in (".env", ".vercel", "node_modules", ".next")):
        fail("commercial service source must not contain local secrets/build/runtime artifacts")

    if ERRORS:
        print("ANPOS commercial service validation failed:", file=sys.stderr)
        for error in ERRORS:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ANPOS commercial service static checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

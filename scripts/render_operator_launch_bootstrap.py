#!/usr/bin/env python3
"""Render a secret-safe ANPOS commercial launch handoff.

The renderer preconfigures GitHub App registration URLs, exact deployable
artifact identity, deterministic vendor-export provenance, production-verifier
arguments, and the production environment-variable contract. It never accepts
private keys, webhook secrets, database credentials, operator tokens,
Marketplace plan IDs, prices, or other live secret/business-authority values.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_PATH = ROOT / "commercial-service/package.json"
PROTOCOL_PATH = ROOT / "config/protocol/version.json"
ORG_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
APP_NAME_RE = re.compile(r"^[^\r\n]{3,100}$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_SERVICE_NAME = "anpos-commercial-service"
EXPECTED_RUNTIME_CONTRACT = "split-github-app-v1"
SERVICE_REPOSITORY_NAME = "anpos-commercial-service"
TEMPLATE_REPOSITORY_NAME = "anpos-commercial-template"
EXPORT_MANIFEST_NAME = "EXPORT-MANIFEST.json"
VENDOR_HANDOFF_VERIFIER = "scripts/verify_vendor_handoff.py"
PREMIUM_PACK_MANIFEST_NAME = "ANPOS-PREMIUM-MANIFEST.json"
PREMIUM_PACK_VERIFIER = "scripts/verify_premium_pack.py"

COMMUNITY_AUDIT_PATHS = [
    ".ai/manifest.json",
    "config/protocol/instance.json",
    "config/protocol/version.json",
    "config/quality/quality-policy.json",
    "config/security/control-plane-policy.json",
    "config/github/ruleset-policy.json",
    "config/design/design-assurance.json",
    "config/data/data-governance.json",
    "config/release/release-policy.json",
    "config/operations/operations-policy.json",
]

MARKETPLACE_APP_ENV = [
    "GITHUB_MARKETPLACE_APP_ID",
    "GITHUB_MARKETPLACE_APP_PRIVATE_KEY",
    "GITHUB_MARKETPLACE_CLIENT_ID",
    "GITHUB_MARKETPLACE_CLIENT_SECRET",
    "GITHUB_WEBHOOK_SECRET",
]
VENDOR_APP_ENV = [
    "GITHUB_VENDOR_APP_ID",
    "GITHUB_VENDOR_APP_PRIVATE_KEY",
    "GITHUB_VENDOR_INSTALLATION_ID",
    "ANPOS_PRIVATE_TEMPLATE_REPO",
]
SERVICE_ENV = [
    "DATABASE_URL",
    "ANPOS_PUBLIC_BASE_URL",
    "ANPOS_SESSION_SECRET",
    "ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID",
    "ANPOS_ENTITLEMENT_PRIVATE_KEY",
    "ANPOS_ENTITLEMENT_KEY_ID",
    "ANPOS_ENTITLEMENT_ISSUER",
    "ANPOS_OPERATOR_TOKEN",
    "ANPOS_MARKETPLACE_PLAN_MAP",
    "ANPOS_ORG_SEAT_LIMITS",
    "ANPOS_COMMERCIAL_RELEASE_REF",
]
PREMIUM_ENV = [
    "ANPOS_PRIVATE_PREMIUM_REPO",
    "ANPOS_PREMIUM_RELEASE_REF",
    "ANPOS_PREMIUM_MANIFEST_SHA256",
    "ANPOS_PREMIUM_CONTENT_SET_SHA256",
]
LEGACY_SINGLE_APP_ENV = ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"]


class BootstrapError(ValueError):
    pass


@dataclass(frozen=True)
class Inputs:
    organization: str
    service_base_url: str
    homepage_url: str
    marketplace_app_name: str
    vendor_app_name: str
    collaborator_provisioning: bool


def load_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise BootstrapError(f"{label} is unavailable or invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise BootstrapError(f"{label} must contain a JSON object")
    return value


def load_artifact_identity(
    package_path: Path = PACKAGE_PATH,
    protocol_path: Path = PROTOCOL_PATH,
) -> dict[str, str]:
    """Load deployable identity from committed package/protocol metadata.

    The package is the deployable artifact identity source. Canonical protocol
    metadata is checked as an invariant so a stale package cannot generate a
    misleading operator handoff.
    """
    package = load_json_object(package_path, "commercial service package metadata")
    protocol = load_json_object(protocol_path, "canonical protocol metadata")

    service = str(package.get("name") or "")
    service_version = str(package.get("version") or "")
    anpos = package.get("anpos") or {}
    if not isinstance(anpos, dict):
        raise BootstrapError("commercial service package anpos metadata must be an object")
    source_protocol_version = str(anpos.get("source_protocol_version") or "")
    runtime_contract = str(anpos.get("runtime_contract") or "")
    canonical_protocol_version = str(protocol.get("version") or "")

    if service != EXPECTED_SERVICE_NAME:
        raise BootstrapError(f"unexpected commercial service package name: {service or '<missing>'}")
    if not VERSION_RE.fullmatch(service_version):
        raise BootstrapError("commercial service package version is missing or invalid")
    if not VERSION_RE.fullmatch(source_protocol_version):
        raise BootstrapError("commercial service source protocol version is missing or invalid")
    if source_protocol_version != canonical_protocol_version:
        raise BootstrapError(
            "commercial service source protocol version does not match canonical protocol metadata"
        )
    if runtime_contract != EXPECTED_RUNTIME_CONTRACT:
        raise BootstrapError(
            f"commercial service runtime contract must be {EXPECTED_RUNTIME_CONTRACT}"
        )

    return {
        "service": service,
        "service_version": service_version,
        "source_protocol_version": source_protocol_version,
        "runtime_contract": runtime_contract,
    }


def load_source_export_identity(source_root: Path = ROOT) -> dict[str, str]:
    """Read the exact canonical Git commit/tree that deterministic vendor exports must represent."""
    try:
        revision_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=source_root,
            check=False,
            capture_output=True,
            text=True,
        )
        tree_result = subprocess.run(
            ["git", "rev-parse", "HEAD^{tree}"],
            cwd=source_root,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise BootstrapError(f"canonical Git identity is unavailable: {exc}") from exc
    if revision_result.returncode != 0 or tree_result.returncode != 0:
        detail = (
            revision_result.stderr.strip()
            or tree_result.stderr.strip()
            or "git rev-parse failed"
        )
        raise BootstrapError(f"canonical Git identity is unavailable: {detail}")
    revision = revision_result.stdout.strip()
    tree = tree_result.stdout.strip()
    if not SHA40_RE.fullmatch(revision) or not SHA40_RE.fullmatch(tree):
        raise BootstrapError("canonical Git revision/tree must be full 40-character lowercase SHA-1 identities")
    return {
        "canonical_source_revision": revision,
        "canonical_source_tree": tree,
    }


def normalize_https_url(value: str, label: str) -> str:
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.netloc:
        raise BootstrapError(f"{label} must be an absolute https:// URL")
    if parsed.username or parsed.password:
        raise BootstrapError(f"{label} must not contain embedded credentials")
    if parsed.query or parsed.fragment:
        raise BootstrapError(f"{label} must not contain query or fragment data")
    path = parsed.path.rstrip("/")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def validate_org(value: str) -> str:
    organization = value.strip()
    if not ORG_RE.fullmatch(organization):
        raise BootstrapError("organization must be a valid GitHub organization slug")
    return organization


def validate_app_name(value: str, label: str) -> str:
    name = value.strip()
    if not APP_NAME_RE.fullmatch(name):
        raise BootstrapError(f"{label} must be 3-100 characters and contain no newlines")
    return name


def registration_url(organization: str, params: list[tuple[str, str]]) -> str:
    query = urllib.parse.urlencode(params, doseq=True, quote_via=urllib.parse.quote)
    return f"https://github.com/organizations/{organization}/settings/apps/new?{query}"


def marketplace_registration_url(inputs: Inputs) -> str:
    callback_url = inputs.service_base_url + "/api/auth/github/callback"
    setup_url = inputs.service_base_url + "/setup/github"
    params = [
        ("name", inputs.marketplace_app_name),
        ("description", "ANPOS customer-facing GitHub Marketplace application"),
        ("url", inputs.homepage_url),
        ("public", "true"),
        ("webhook_active", "false"),
        ("request_oauth_on_install", "false"),
        ("callback_urls[]", callback_url),
        ("setup_url", setup_url),
        ("setup_on_update", "true"),
        ("single_file", "read"),
    ]
    params.extend(("single_file_paths[]", path) for path in COMMUNITY_AUDIT_PATHS)
    return registration_url(inputs.organization, params)


def vendor_registration_url(inputs: Inputs) -> str:
    params = [
        ("name", inputs.vendor_app_name),
        ("description", "ANPOS private vendor template and premium distribution application"),
        ("url", inputs.homepage_url),
        ("public", "false"),
        ("webhook_active", "false"),
        ("request_oauth_on_install", "false"),
        ("contents", "read"),
    ]
    if inputs.collaborator_provisioning:
        params.append(("administration", "write"))
    return registration_url(inputs.organization, params)


def render(
    inputs: Inputs,
    artifact_identity: dict[str, str] | None = None,
    source_export_identity: dict[str, str] | None = None,
) -> dict[str, Any]:
    identity = dict(artifact_identity or load_artifact_identity())
    required_identity = {"service", "service_version", "source_protocol_version", "runtime_contract"}
    if set(identity) != required_identity or any(not str(identity[key]) for key in required_identity):
        raise BootstrapError("artifact identity is incomplete")

    export_identity = dict(source_export_identity or load_source_export_identity())
    required_export_identity = {"canonical_source_revision", "canonical_source_tree"}
    if set(export_identity) != required_export_identity:
        raise BootstrapError("canonical vendor export identity is incomplete")
    for key in required_export_identity:
        if not SHA40_RE.fullmatch(str(export_identity[key])):
            raise BootstrapError(f"canonical vendor export identity has invalid {key}")

    vendor_permissions = {"contents": "read", "metadata": "read"}
    if inputs.collaborator_provisioning:
        vendor_permissions["administration"] = "write"

    verifier_arguments = [
        "--require-ready",
        "--expected-service-version",
        identity["service_version"],
        "--expected-protocol-version",
        identity["source_protocol_version"],
    ]
    common_handoff_arguments = [
        "--expected-source-revision",
        export_identity["canonical_source_revision"],
        "--expected-source-tree",
        export_identity["canonical_source_tree"],
    ]
    service_handoff_arguments = [
        "--expected-mode",
        "service",
        *common_handoff_arguments,
        "--expected-service-version",
        identity["service_version"],
        "--expected-protocol-version",
        identity["source_protocol_version"],
        "--expected-runtime-contract",
        identity["runtime_contract"],
    ]
    template_handoff_arguments = [
        "--expected-mode",
        "template",
        *common_handoff_arguments,
    ]

    callback_url = inputs.service_base_url + "/api/auth/github/callback"
    setup_url = inputs.service_base_url + "/setup/github"

    return {
        "schema_version": 6,
        "status": "operator_actions_required",
        "launch_authorized": False,
        "organization": inputs.organization,
        "service_base_url": inputs.service_base_url,
        "homepage_url": inputs.homepage_url,
        "artifact_identity": identity,
        "production_verifier_arguments": verifier_arguments,
        "vendor_repository_handoff": {
            "manifest_name": EXPORT_MANIFEST_NAME,
            "verifier": VENDOR_HANDOFF_VERIFIER,
            "canonical_source_revision": export_identity["canonical_source_revision"],
            "canonical_source_tree": export_identity["canonical_source_tree"],
            "service_repository": SERVICE_REPOSITORY_NAME,
            "template_repository": TEMPLATE_REPOSITORY_NAME,
            "service_verification_arguments": service_handoff_arguments,
            "template_verification_arguments": template_handoff_arguments,
            "verification_rule": "Run the verifier from the canonical checkout at canonical_source_revision against each exported directory or clean private-repository checkout before accepting/pushing/deploying it.",
        },
        "premium_distribution_handoff": {
            "conditional": True,
            "condition": "required_if_ANPOS_MARKETPLACE_PLAN_MAP_contains_pro_team_or_enterprise",
            "manifest_name": PREMIUM_PACK_MANIFEST_NAME,
            "verifier": PREMIUM_PACK_VERIFIER,
            "environment_keys": list(PREMIUM_ENV),
            "private_repository_must_be_distinct_from_template_repository": True,
            "release_ref_must_be_exact_40_character_commit_sha": True,
            "manifest_sha256_must_come_from_successful_offline_verifier_receipt": True,
            "content_set_sha256_must_come_from_successful_offline_verifier_receipt": True,
            "source_contract_or_runtime_is_not_premium_payload_or_sale_readiness": True,
        },
        "github_apps": {
            "marketplace": {
                "role": "customer_marketplace_app",
                "public": True,
                "registration_url": marketplace_registration_url(inputs),
                "github_app_webhook_active": False,
                "callback_url": callback_url,
                "setup_url": setup_url,
                "request_oauth_on_install": False,
                "setup_on_update": True,
                "events": [],
                "marketplace_listing_webhook": {
                    "configuration_surface": "github_marketplace_listing_webhook",
                    "required": True,
                    "event": "marketplace_purchase",
                    "url": inputs.service_base_url + "/api/webhooks/github/marketplace",
                    "secret_environment_key": "GITHUB_WEBHOOK_SECRET",
                },
                "repository_permissions": {"metadata": "read", "single_file": "read"},
                "single_file_paths": list(COMMUNITY_AUDIT_PATHS),
                "community_audit_reads_application_source": False,
                "community_auth_flow": "marketplace_setup_url_then_pkce_github_app_oauth",
                "environment_keys": MARKETPLACE_APP_ENV,
            },
            "vendor_distribution": {
                "role": "vendor_distribution_app",
                "public": False,
                "registration_url": vendor_registration_url(inputs),
                "events": [],
                "permissions": vendor_permissions,
                "collaborator_provisioning_enabled": inputs.collaborator_provisioning,
                "environment_keys": VENDOR_APP_ENV,
            },
        },
        "service_environment_keys": SERVICE_ENV,
        "conditional_premium_environment_keys": PREMIUM_ENV,
        "legacy_single_app_environment_keys_forbidden": LEGACY_SINGLE_APP_ENV,
        "operator_sequence": [
            "Generate deterministic private vendor service and template exports from the certified canonical revision.",
            "Verify both exports with scripts/verify_vendor_handoff.py using vendor_repository_handoff arguments before accepting or pushing/deploying them; retain the successful JSON receipts as provenance evidence.",
            "Create the private vendor repositories and populate them only from verified deterministic exports; verify a clean checkout again after the initial push.",
            "After the verified private template push, set ANPOS_COMMERCIAL_RELEASE_REF to that repository's exact 40-character commit SHA; never use main, a branch, or a mutable tag for paid delivery.",
            "Register the public Marketplace App using the prefilled URL; verify the Setup URL, OAuth callback, setup-on-update behavior, and Community single-file permission set before saving the App.",
            "After creating the draft GitHub Marketplace listing, configure its separate Marketplace listing webhook at /api/webhooks/github/marketplace, subscribe to marketplace_purchase there, and store its strong secret as GITHUB_WEBHOOK_SECRET. Do not add marketplace_purchase to normal GitHub App event subscriptions.",
            "Keep request OAuth on install disabled. Marketplace purchase/setup redirects land on /setup/github, which starts the explicit PKCE GitHub App OAuth flow.",
            "Generate the Marketplace App client secret in GitHub, store it only in the deployment secret manager, and configure GITHUB_MARKETPLACE_CLIENT_ID/GITHUB_MARKETPLACE_CLIENT_SECRET plus ANPOS_PUBLIC_BASE_URL/ANPOS_SESSION_SECRET.",
            "Configure ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID only with the real operator-approved free Marketplace plan ID after that plan exists; keep Community outside ANPOS_MARKETPLACE_PLAN_MAP, which remains paid-only.",
            "Verify the Community audit permission remains single-file read for exactly the approved ten ANPOS control paths and is not broadened to application source-code access.",
            "For free-first launch, require /api/ready/community HTTP 200 plus real Setup URL -> OAuth -> installation-bound repository discovery -> audit E2E evidence; this does not prove paid/vendor readiness.",
            "Register the private Vendor Distribution App using the prefilled URL; keep Administration write disabled unless collaborator provisioning is deliberately enabled.",
            "Generate and store distinct App private keys in the deployment secret store; never commit them.",
            "Install the Vendor Distribution App with Contents read on the verified private commercial-template repository; if a higher paid tier is activated, also install it on the distinct private premium repository.",
            "Before mapping pro, team, or enterprise in ANPOS_MARKETPLACE_PLAN_MAP, create a distinct private premium repository, verify its exact immutable revision with scripts/verify_premium_pack.py, and configure ANPOS_PRIVATE_PREMIUM_REPO, ANPOS_PREMIUM_RELEASE_REF, ANPOS_PREMIUM_MANIFEST_SHA256, and ANPOS_PREMIUM_CONTENT_SET_SHA256 from the successful verifier receipt.",
            f"Populate the {identity['service']} {identity['service_version']} production environment contract with real external values.",
            f"Deploy the exact {identity['service']} {identity['service_version']} artifact and require /api/version to report source protocol {identity['source_protocol_version']} and runtime contract {identity['runtime_contract']}.",
            "Run scripts/verify_commercial_production.py with the generated production_verifier_arguments; exact artifact identity must pass before /api/ready can count as paid-runtime evidence.",
            "Exercise the Marketplace Setup URL -> PKCE OAuth callback -> authorized repository discovery -> read-only Community audit flow using a real installation before claiming Community launch readiness.",
            "Exercise GET /api/v1/releases/current and GET /api/v1/template/archive against the exact ANPOS_COMMERCIAL_RELEASE_REF and verify the returned canonical source revision/tree matches retained vendor-handoff evidence before claiming Developer delivery readiness.",
            "For Pro or a higher tier, exercise GET /api/v1/premium/releases/current and GET /api/v1/premium/archive against the exact verifier-bound premium revision before claiming premium distribution readiness.",
            "Require full /api/ready plus applicable paid/vendor/premium E2E evidence before paid launch authorization.",
        ],
        "safety": [
            "This output contains no credentials and is not proof that either GitHub App or any private vendor/premium repository exists.",
            "Registration URLs are prefilled operator aids; GitHub remains the authority for the final App configuration.",
            "Artifact identity is read from committed deployable package metadata and checked against canonical protocol metadata; do not replace it with hand-maintained expected versions.",
            "Vendor export identity is read from canonical Git commit/tree identity; handoff verification reconstructs expected bytes from committed canonical blobs and rejects extra, missing, dirty, tampered, stale, or wrong-mode vendor checkouts.",
            "A handoff verification receipt proves byte equality to the approved deterministic export; it does not prove GitHub repository ownership, visibility, App installation, Marketplace approval, or production deployment.",
            "Community audit permission is deliberately limited to ten ANPOS control files and must not be represented as permission to inspect application source code.",
            "Setup redirect installation IDs are untrusted until OAuth completes and the authenticated GitHub user is verified against that installation.",
            "Community v1 uses encrypted short-lived HttpOnly sessions and deliberately does not persist GitHub refresh tokens.",
            "Community Marketplace identity must use the real ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID and must never be smuggled into the paid ANPOS_MARKETPLACE_PLAN_MAP.",
            "Paid update/archive delivery must use the exact ANPOS_COMMERCIAL_RELEASE_REF commit whose deterministic EXPORT-MANIFEST and private-repository checkout have been verified; mutable refs are forbidden.",
            "Pro/Team/Enterprise activation requires a distinct private premium repository, exact premium commit SHA, and manifest/content-set digests from a successful offline premium verifier receipt; a source contract or route is not premium payload or sale readiness.",
            "Do not reuse App IDs or private keys across Marketplace and Vendor Distribution roles.",
            "Do not use legacy GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY with the split-App commercial service contract.",
            "Do not infer Marketplace approval, publisher verification, installation counts, prices, plan IDs, repository existence, premium payload existence, or production readiness from this output.",
        ],
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization", required=True, help="GitHub organization that will own both App registrations")
    parser.add_argument("--service-base-url", required=True, help="HTTPS base URL of the ANPOS commercial service")
    parser.add_argument("--homepage-url", required=True, help="HTTPS product/application homepage URL")
    parser.add_argument("--marketplace-app-name", default="ANPOS Marketplace")
    parser.add_argument("--vendor-app-name", default="ANPOS Vendor Distribution")
    parser.add_argument(
        "--enable-collaborator-provisioning",
        action="store_true",
        help="Prefill Administration: write on the private Vendor App; archive-only is safer and remains the default",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        inputs = Inputs(
            organization=validate_org(args.organization),
            service_base_url=normalize_https_url(args.service_base_url, "service base URL"),
            homepage_url=normalize_https_url(args.homepage_url, "homepage URL"),
            marketplace_app_name=validate_app_name(args.marketplace_app_name, "Marketplace App name"),
            vendor_app_name=validate_app_name(args.vendor_app_name, "Vendor App name"),
            collaborator_provisioning=bool(args.enable_collaborator_provisioning),
        )
        output = render(inputs)
    except BootstrapError as exc:
        print(f"ANPOS operator launch bootstrap FAILED: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

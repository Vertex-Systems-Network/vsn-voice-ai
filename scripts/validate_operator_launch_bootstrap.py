#!/usr/bin/env python3
"""Static and behavioral validation for secret-safe operator launch bootstrap tooling."""
from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "scripts/render_operator_launch_bootstrap.py"
DOC = ROOT / "blueprints/commercial/operator-launch-bootstrap.md"
TESTS = ROOT / "tests/test_operator_launch_bootstrap.py"
BOUNDARY = ROOT / "config/licensing/vendor-source-boundary.json"
VENDOR_QUALITY = ROOT / "blueprints/commercial/vendor-launch-quality.yml"
CHILD_QUALITY = ROOT / "blueprints/github/workflows/repository-quality.yml"
MARKETPLACE_BLUEPRINT = ROOT / "blueprints/commercial/github-marketplace-app-manifest.example.json"
VENDOR_BLUEPRINT = ROOT / "blueprints/commercial/github-vendor-app-manifest.example.json"
ENV_EXAMPLE = ROOT / "commercial-service/.env.example"
PACKAGE = ROOT / "commercial-service/package.json"
PROTOCOL = ROOT / "config/protocol/version.json"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def read(path: Path) -> str:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict:
    try:
        data = json.loads(read(path) or "{}")
    except Exception as exc:
        fail(f"{path.relative_to(ROOT)} is not valid JSON: {exc}")
        return {}
    if not isinstance(data, dict):
        fail(f"{path.relative_to(ROOT)} must contain a JSON object")
        return {}
    return data


def parse_query(url: str) -> dict[str, list[str]]:
    return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)


def render(extra: list[str] | None = None) -> dict:
    command = [
        sys.executable,
        str(RENDERER),
        "--organization",
        "Vertex-Systems-Network",
        "--service-base-url",
        "https://license.example.test",
        "--homepage-url",
        "https://example.test/anpos",
    ]
    if extra:
        command.extend(extra)
    try:
        result = subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=True)
        data = json.loads(result.stdout)
    except Exception as exc:
        fail(f"operator launch renderer behavioral check failed: {exc}")
        return {}
    if not isinstance(data, dict):
        fail("operator launch renderer output must be a JSON object")
        return {}
    return data


def git_identity() -> tuple[str, str]:
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, text=True, capture_output=True
        ).stdout.strip()
        tree = subprocess.run(
            ["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, check=True, text=True, capture_output=True
        ).stdout.strip()
    except Exception as exc:
        fail(f"unable to read canonical Git identity: {exc}")
        return "", ""
    if not SHA40_RE.fullmatch(revision) or not SHA40_RE.fullmatch(tree):
        fail("canonical Git identity must use full SHA-1 revision/tree values")
    return revision, tree


def main() -> int:
    renderer_source = read(RENDERER)
    doc = read(DOC)
    tests_source = read(TESTS)
    vendor_quality = read(VENDOR_QUALITY)
    child_quality = read(CHILD_QUALITY)
    env_example = read(ENV_EXAMPLE)
    package = load_json(PACKAGE)
    protocol = load_json(PROTOCOL)
    source_revision, source_tree = git_identity()

    for source, path in ((renderer_source, RENDERER), (tests_source, TESTS)):
        if source:
            try:
                ast.parse(source, filename=str(path))
            except SyntaxError as exc:
                fail(f"{path.relative_to(ROOT)} is not valid Python: {exc}")

    for forbidden in (
        "--private-key",
        "--webhook-secret",
        "--database-url",
        "--operator-token",
        "--marketplace-plan-id",
        "--commercial-release-ref",
        "--price",
    ):
        if forbidden in renderer_source:
            fail(f"operator launch renderer must not accept secret/business-authority CLI flag: {forbidden}")

    for marker in (
        "GITHUB_MARKETPLACE_APP_ID",
        "GITHUB_MARKETPLACE_APP_PRIVATE_KEY",
        "GITHUB_VENDOR_APP_ID",
        "GITHUB_VENDOR_APP_PRIVATE_KEY",
        "GITHUB_VENDOR_INSTALLATION_ID",
        "ANPOS_PRIVATE_TEMPLATE_REPO",
        "ANPOS_COMMERCIAL_RELEASE_REF",
        "legacy_single_app_environment_keys_forbidden",
        "artifact_identity",
        "production_verifier_arguments",
        "load_artifact_identity",
        "load_source_export_identity",
        "vendor_repository_handoff",
        "canonical_source_revision",
        "canonical_source_tree",
        "service_verification_arguments",
        "template_verification_arguments",
        "scripts/verify_vendor_handoff.py",
        "PACKAGE_PATH",
        "PROTOCOL_PATH",
        "launch_authorized",
        "marketplace_purchase",
        "marketplace_listing_webhook",
        "/api/v1/releases/current",
        "/api/v1/template/archive",
        "administration",
        "contents",
    ):
        if marker not in renderer_source:
            fail(f"operator launch renderer missing marker: {marker}")

    for stale_literal in ('"0.3.0"', '"0.3.1"', '"0.3.2"'):
        if stale_literal in renderer_source:
            fail(f"operator launch renderer must not hard-code release version {stale_literal}")

    expected_identity = {
        "service": package.get("name"),
        "service_version": package.get("version"),
        "source_protocol_version": (package.get("anpos") or {}).get("source_protocol_version"),
        "runtime_contract": (package.get("anpos") or {}).get("runtime_contract"),
    }
    if expected_identity["source_protocol_version"] != protocol.get("version"):
        fail("commercial package/protocol identity must match before rendering an operator handoff")
    if expected_identity["runtime_contract"] != "split-github-app-v1":
        fail("operator bootstrap requires split-github-app-v1 artifact identity")

    data = render()
    if data:
        if data.get("schema_version") != 6:
            fail("operator launch renderer output must be schema_version 6")
        if data.get("status") != "operator_actions_required" or data.get("launch_authorized") is not False:
            fail("operator launch renderer must remain fail-closed and non-authoritative")
        if data.get("artifact_identity") != expected_identity:
            fail("operator handoff artifact_identity must be derived from deployable package metadata")
        expected_args = [
            "--require-ready",
            "--expected-service-version",
            str(expected_identity["service_version"]),
            "--expected-protocol-version",
            str(expected_identity["source_protocol_version"]),
        ]
        if data.get("production_verifier_arguments") != expected_args:
            fail("operator handoff must emit exact package-derived production verifier arguments")

        service_env = set(data.get("service_environment_keys") or [])
        for required in (
            "ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID",
            "ANPOS_MARKETPLACE_PLAN_MAP",
            "ANPOS_COMMERCIAL_RELEASE_REF",
        ):
            if required not in service_env:
                fail(f"operator handoff service environment missing {required}")

        sequence = "\n".join(str(value) for value in data.get("operator_sequence") or [])
        for marker in (
            "ANPOS_COMMERCIAL_RELEASE_REF",
            "exact 40-character commit SHA",
            "/api/v1/releases/current",
            "/api/v1/template/archive",
            "/api/ready/community",
            "full /api/ready",
        ):
            if marker not in sequence:
                fail(f"operator sequence missing release/readiness marker: {marker}")
        safety = "\n".join(str(value) for value in data.get("safety") or [])
        if "mutable refs are forbidden" not in safety:
            fail("operator safety must explicitly forbid mutable paid release refs")

        handoff = data.get("vendor_repository_handoff") or {}
        if handoff.get("canonical_source_revision") != source_revision:
            fail("operator handoff must bind vendor export to current canonical source revision")
        if handoff.get("canonical_source_tree") != source_tree:
            fail("operator handoff must bind vendor export to current canonical source tree")
        if handoff.get("manifest_name") != "EXPORT-MANIFEST.json":
            fail("operator handoff must identify deterministic export manifest")
        if handoff.get("verifier") != "scripts/verify_vendor_handoff.py":
            fail("operator handoff must route vendor checkout verification through canonical verifier")
        if handoff.get("service_repository") != "anpos-commercial-service":
            fail("operator handoff service repository name is invalid")
        if handoff.get("template_repository") != "anpos-commercial-template":
            fail("operator handoff template repository name is invalid")

        service_args = handoff.get("service_verification_arguments") or []
        template_args = handoff.get("template_verification_arguments") or []
        for label, args, mode in (
            ("service", service_args, "service"),
            ("template", template_args, "template"),
        ):
            for required in (
                "--expected-mode",
                mode,
                "--expected-source-revision",
                source_revision,
                "--expected-source-tree",
                source_tree,
            ):
                if required not in args:
                    fail(f"operator {label} handoff arguments missing exact source identity/mode: {required}")
        for required in (
            "--expected-service-version",
            str(expected_identity["service_version"]),
            "--expected-protocol-version",
            str(expected_identity["source_protocol_version"]),
            "--expected-runtime-contract",
            str(expected_identity["runtime_contract"]),
        ):
            if required not in service_args:
                fail(f"operator service handoff arguments missing artifact identity: {required}")
        if "--expected-service-version" in template_args:
            fail("template handoff verification must not require commercial service identity")

        apps = data.get("github_apps") or {}
        marketplace = apps.get("marketplace") or {}
        vendor = apps.get("vendor_distribution") or {}
        if marketplace.get("public") is not True or vendor.get("public") is not False:
            fail("operator launch renderer must preserve public Marketplace/private Vendor App split")
        mq = parse_query(str(marketplace.get("registration_url") or ""))
        vq = parse_query(str(vendor.get("registration_url") or ""))
        if mq.get("public") != ["true"] or mq.get("webhook_active") != ["false"]:
            fail("Marketplace registration URL must prefill public visibility with the ordinary GitHub App webhook disabled")
        if "events[]" in mq or "webhook_url" in mq:
            fail("Marketplace registration URL must not model marketplace_purchase as a normal GitHub App webhook")
        listing_webhook = marketplace.get("marketplace_listing_webhook") or {}
        if listing_webhook.get("configuration_surface") != "github_marketplace_listing_webhook":
            fail("operator handoff must identify the separate Marketplace listing webhook surface")
        if listing_webhook.get("event") != "marketplace_purchase" or listing_webhook.get("url") != "https://license.example.test/api/webhooks/github/marketplace":
            fail("operator handoff Marketplace listing webhook is invalid")
        if listing_webhook.get("secret_environment_key") != "GITHUB_WEBHOOK_SECRET":
            fail("operator handoff must bind the Marketplace listing webhook secret environment key")
        if "administration" in mq or "contents" in mq:
            fail("Marketplace registration URL must not request vendor template repository permissions")
        if vq.get("public") != ["false"] or vq.get("webhook_active") != ["false"]:
            fail("Vendor registration URL must prefill private visibility and disabled webhook")
        if vq.get("contents") != ["read"] or "administration" in vq:
            fail("Vendor default registration must remain archive-only Contents: read")
        if set(data.get("legacy_single_app_environment_keys_forbidden") or []) != {"GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"}:
            fail("operator handoff must explicitly forbid legacy single-App environment keys")

        serialized = json.dumps(data, sort_keys=True)
        for secret_marker in ("BEGIN PRIVATE KEY", "github_pat_", "ghp_", "postgresql://"):
            if secret_marker in serialized:
                fail(f"operator handoff output appears to contain secret material: {secret_marker}")

    collaborator = render(["--enable-collaborator-provisioning"])
    if collaborator:
        vendor = ((collaborator.get("github_apps") or {}).get("vendor_distribution") or {})
        vq = parse_query(str(vendor.get("registration_url") or ""))
        if vq.get("administration") != ["write"]:
            fail("collaborator mode must explicitly add Vendor Administration: write")

    marketplace_blueprint = load_json(MARKETPLACE_BLUEPRINT)
    vendor_blueprint = load_json(VENDOR_BLUEPRINT)
    if (marketplace_blueprint.get("required_defaults") or {}).get("public") is not True:
        fail("operator renderer depends on public Marketplace App blueprint")
    archive = ((vendor_blueprint.get("minimum_permissions_by_capability") or {}).get("archive_first_delivery") or {})
    if archive.get("contents") != "read" or "administration" in archive:
        fail("operator renderer depends on archive-only Vendor App blueprint")

    for env_name in (
        "GITHUB_MARKETPLACE_APP_ID",
        "GITHUB_MARKETPLACE_APP_PRIVATE_KEY",
        "GITHUB_VENDOR_APP_ID",
        "GITHUB_VENDOR_APP_PRIVATE_KEY",
        "GITHUB_VENDOR_INSTALLATION_ID",
        "ANPOS_PRIVATE_TEMPLATE_REPO",
        "ANPOS_COMMERCIAL_RELEASE_REF",
    ):
        if env_name not in env_example:
            fail(f"commercial service environment example missing operator handoff key: {env_name}")
    if "ANPOS_TEMPLATE_REF=" in env_example:
        fail("commercial service environment example must not advertise mutable ANPOS_TEMPLATE_REF")
    for legacy in ("\nGITHUB_APP_ID=", "\nGITHUB_APP_PRIVATE_KEY="):
        if legacy in env_example:
            fail("commercial service environment example must not restore legacy single-App credentials")

    for marker in (
        "secret-safe renderer",
        "package-derived artifact identity",
        "`artifact_identity`",
        "`production_verifier_arguments`",
        "Deterministic vendor-repository handoff",
        "`vendor_repository_handoff`",
        "`canonical_source_revision`",
        "`canonical_source_tree`",
        "`scripts/verify_vendor_handoff.py`",
        "JSON receipt",
        "public Marketplace App",
        "Marketplace listing webhook",
        "private Vendor Distribution App",
        "GITHUB_MARKETPLACE_APP_ID",
        "GITHUB_VENDOR_APP_ID",
        "ANPOS_COMMERCIAL_RELEASE_REF",
        "40-character lowercase Git commit SHA",
        "/api/v1/releases/current",
        "/api/v1/template/archive",
        "Legacy `GITHUB_APP_ID`",
        "/api/version",
        "/api/ready",
        "Re-check current GitHub App and GitHub Marketplace requirements",
    ):
        if marker not in doc:
            fail(f"operator launch bootstrap documentation missing marker: {marker}")
    for stale_doc in (
        "commercial service 0.3.0",
        "commercial service 0.3.1",
        "commercial service 0.3.2",
        "Deploy 0.3.0",
        "Deploy 0.3.1",
        "Deploy 0.3.2",
    ):
        if stale_doc in doc:
            fail(f"operator launch bootstrap documentation contains stale hand-maintained version: {stale_doc}")

    for marker in (
        "test_split_environment_contract_and_legacy_rejection_are_explicit",
        "ANPOS_COMMERCIAL_RELEASE_REF",
        "/api/v1/releases/current",
        "test_artifact_identity_and_verifier_args_are_package_derived",
        "test_artifact_identity_fails_closed_on_package_protocol_mismatch",
        "test_vendor_handoff_identity_is_git_derived_and_binds_both_exports",
        "test_source_export_identity_rejects_invalid_injected_sha",
    ):
        if marker not in tests_source:
            fail(f"operator bootstrap tests missing identity/provenance/release marker: {marker}")

    boundary = load_json(BOUNDARY)
    vendor_only = set(boundary.get("vendor_only_paths") or [])
    for relative in (
        "blueprints/commercial/operator-launch-bootstrap.md",
        "scripts/render_operator_launch_bootstrap.py",
        "scripts/validate_operator_launch_bootstrap.py",
        "scripts/verify_vendor_handoff.py",
        "tests/test_operator_launch_bootstrap.py",
        "tests/test_vendor_handoff.py",
    ):
        if relative not in vendor_only:
            fail(f"vendor source boundary missing operator bootstrap/handoff path: {relative}")

    if "python scripts/validate_operator_launch_bootstrap.py" not in vendor_quality:
        fail("vendor launch quality blueprint must run operator launch bootstrap validator")
    if "tests.test_operator_launch_bootstrap" not in vendor_quality:
        fail("vendor launch quality blueprint must run operator launch bootstrap tests")
    if "tests.test_vendor_handoff" not in vendor_quality:
        fail("vendor launch quality blueprint must run deterministic vendor handoff tests")
    for forbidden in (
        "validate_operator_launch_bootstrap.py",
        "test_operator_launch_bootstrap",
        "verify_vendor_handoff.py",
        "test_vendor_handoff",
    ):
        if forbidden in child_quality:
            fail(f"child repository quality blueprint must not depend on vendor-only operator/handoff tooling: {forbidden}")

    if ERRORS:
        print("ANPOS operator launch bootstrap validation failed:", file=sys.stderr)
        for error in ERRORS:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ANPOS operator launch bootstrap checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

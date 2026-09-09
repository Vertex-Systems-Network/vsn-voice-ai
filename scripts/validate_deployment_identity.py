#!/usr/bin/env python3
"""Validate commercial deployment identity attestation and production verifier routing."""
from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "commercial-service"
VERSION_ROUTE = SERVICE / "app/api/version/route.ts"
PACKAGE = SERVICE / "package.json"
VERIFIER = ROOT / "scripts/verify_commercial_production.py"
CONTRACT = ROOT / "blueprints/commercial/service-api-contract.json"
TESTS = ROOT / "tests/test_deployment_identity.py"
BOUNDARY = ROOT / "config/licensing/vendor-source-boundary.json"
VENDOR_QUALITY = ROOT / "blueprints/commercial/vendor-launch-quality.yml"
CHILD_QUALITY = ROOT / "blueprints/github/workflows/repository-quality.yml"
PROTOCOL = ROOT / "config/protocol/version.json"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
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


def main() -> int:
    route = read(VERSION_ROUTE)
    verifier = read(VERIFIER)
    tests = read(TESTS)
    vendor_quality = read(VENDOR_QUALITY)
    child_quality = read(CHILD_QUALITY)

    for source, path in ((verifier, VERIFIER), (tests, TESTS)):
        if source:
            try:
                ast.parse(source, filename=str(path))
            except SyntaxError as exc:
                fail(f"{path.relative_to(ROOT)} is not valid Python: {exc}")

    package = load_json(PACKAGE)
    protocol = load_json(PROTOCOL)
    anpos = package.get("anpos") or {}
    service_version = str(package.get("version") or "")
    if not VERSION_RE.fullmatch(service_version):
        fail("commercial deployment identity must contain a valid semantic service version")
    if anpos.get("source_protocol_version") != protocol.get("version"):
        fail("commercial package source_protocol_version must equal canonical protocol version")
    if anpos.get("runtime_contract") != "split-github-app-v1":
        fail("commercial package must embed split-github-app-v1 runtime contract")

    for marker in (
        'import packageJson from "@/package.json"',
        "service_version",
        "source_protocol_version",
        "runtime_contract",
        '"Cache-Control": "no-store"',
    ):
        if marker not in route:
            fail(f"deployment identity route missing marker: {marker}")
    for forbidden in ("process.env", "serviceConfig", "PRIVATE_KEY", "WEBHOOK_SECRET", "DATABASE_URL"):
        if forbidden in route:
            fail(f"public deployment identity route must not depend on secret/config marker: {forbidden}")

    for marker in (
        'EXPECTED_SERVICE_NAME = "anpos-commercial-service"',
        'EXPECTED_RUNTIME_CONTRACT = "split-github-app-v1"',
        '"/api/version"',
        '"/api/v1/keys"',
        '"/api/v1/entitlements/current"',
        '"/api/v1/reconcile"',
        '"--expected-service-version"',
        '"--expected-protocol-version"',
        '"--github-account-id"',
        '"X-Anpos-Account-Id"',
        '"entitlement_not_found"',
        '"valid_account_id_required"',
        '"anpos-production-verifier-contract-probe"',
        'body=json.dumps({}, separators=(",", ":"))',
        "a stale artifact cannot be certified",
        "validate_version_payload",
        "normalize_github_account_id",
    ):
        if marker not in verifier:
            fail(f"production verifier missing deployment/authenticated-smoke marker: {marker}")
    for stale in (
        'request(base_url, "/v1/keys"',
        '"/v1/entitlements/current",',
        '"/v1/reconcile",',
        '"dry_run"',
        'payload["github_account_id"]',
    ):
        if stale in verifier:
            fail(f"production verifier still contains stale or unsafe smoke contract marker: {stale}")

    try:
        result = subprocess.run(
            [sys.executable, str(VERIFIER), "--base-url", "https://example.test", "--require-ready"],
            cwd=ROOT,
            check=False,
            text=True,
            capture_output=True,
            timeout=10,
        )
        if result.returncode != 1 or "requires --expected-service-version and --expected-protocol-version" not in result.stderr:
            fail("--require-ready must fail locally before network access when exact expected identity is absent")
    except Exception as exc:
        fail(f"failed to behaviorally test require-ready identity gate: {exc}")

    contract = load_json(CONTRACT)
    endpoints = contract.get("endpoints") or []
    version_entries = [item for item in endpoints if isinstance(item, dict) and item.get("path") == "/version"]
    if len(version_entries) != 1:
        fail("commercial API contract must define exactly one /version endpoint")
    else:
        version = version_entries[0]
        if version.get("authentication") != "public_read" or version.get("must_not_return_secrets") is not True:
            fail("/version contract must be public read and explicitly secret-free")
        fields = set(version.get("required_fields") or [])
        if {"service", "service_version", "source_protocol_version", "runtime_contract"} - fields:
            fail("/version contract missing required deployment identity fields")
        if version.get("cache_control") != "no-store":
            fail("/version contract must require no-store")
    cross = contract.get("cross_cutting_rules") or {}
    if cross.get("deployment_identity_endpoint_required") is not True:
        fail("commercial API contract must require deployment identity endpoint")
    if cross.get("production_readiness_requires_expected_artifact_identity") is not True:
        fail("commercial API contract must require expected artifact identity for production readiness")

    for marker in (
        "test_version_payload_requires_exact_service_protocol_and_runtime_contract",
        "test_require_ready_refuses_missing_expected_identity_before_network",
        "test_verifier_uses_actual_next_api_prefixes",
        "test_authenticated_smoke_contract_is_fail_closed_and_canonical",
        "test_service_package_embeds_certified_source_identity",
        "test_version_route_is_public_non_secret_and_package_derived",
    ):
        if marker not in tests:
            fail(f"deployment identity tests missing marker: {marker}")

    boundary = load_json(BOUNDARY)
    vendor_only = set(boundary.get("vendor_only_paths") or [])
    for relative in (
        "scripts/validate_deployment_identity.py",
        "tests/test_deployment_identity.py",
    ):
        if relative not in vendor_only:
            fail(f"vendor source boundary missing deployment identity path: {relative}")

    if "python scripts/validate_deployment_identity.py" not in vendor_quality:
        fail("vendor quality blueprint must run deployment identity validator")
    if "tests.test_deployment_identity" not in vendor_quality:
        fail("vendor quality blueprint must run deployment identity tests")
    if "validate_deployment_identity.py" in child_quality or "test_deployment_identity" in child_quality:
        fail("child repository quality must not depend on vendor-only deployment identity tooling")

    if ERRORS:
        print("ANPOS deployment identity validation failed:", file=sys.stderr)
        for error in ERRORS:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ANPOS commercial deployment identity checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the canonical-source persistent GitHub Actions certification guard."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ".github/workflows/source-continuous-certification.yml"
BOUNDARY = ROOT / "config" / "licensing" / "vendor-source-boundary.json"
SOURCE_REPOSITORY = "Vertex-Systems-Network/ai-native-project-operating-system"
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def require(source: str, marker: str, label: str | None = None) -> None:
    if marker not in source:
        fail(label or f"source continuous certification workflow missing marker: {marker}")


def committed_workflow() -> str:
    result = subprocess.run(
        ["git", "show", f"HEAD:{WORKFLOW_PATH}"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        fail("canonical source must commit .github/workflows/source-continuous-certification.yml")
        return ""
    return result.stdout


def main() -> int:
    source = committed_workflow()
    for marker in (
        "name: ANPOS Source Continuous Certification", "pull_request:", "push:", "- main",
        "permissions:", "contents: read", "concurrency:", "cancel-in-progress: true",
        f"github.repository == '{SOURCE_REPOSITORY}'", "runs-on: ubuntu-24.04", "timeout-minutes: 35",
        "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
        "EXPECTED_SOURCE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
        'test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"',
        "persist-credentials: false", "fetch-depth: 0", "python-version: '3.12'", "jsonschema==4.25.1",
        "python -m compileall -q scripts tests", "python -m unittest discover -s tests -p 'test_*.py' -v",
        "python scripts/validate_ai_native_repo.py", "python scripts/validate_commercial_licensing.py",
        "python scripts/validate_commercial_service.py", "python scripts/validate_vendor_repository_export.py",
        "python scripts/validate_commercial_launch_package.py", "python scripts/validate_marketplace_staged_launch.py",
        "python scripts/validate_operator_launch_bootstrap.py", "python scripts/validate_deployment_identity.py",
        "python scripts/validate_source_continuous_certification.py", "scripts/export_vendor_repositories.py",
        "scripts/verify_vendor_handoff.py", "diff -qr", "node-version: '22.x'",
        "npm install --global npm@11.19.1 --ignore-scripts", "npm ci", "npm audit --audit-level=low",
        "npm run certify", "commercial-service/tsconfig.json|commercial-service/next-env.d.ts",
        "git status --porcelain --untracked-files=no",
    ):
        require(source, marker)

    for forbidden in (
        "pull_request_target:", "secrets.", "contents: write", "actions: write", "checks: write",
        "id-token: write", "persist-credentials: true",
    ):
        if forbidden in source:
            fail(f"source continuous certification workflow contains forbidden authority marker: {forbidden}")
    if re.search(r"^\s*[A-Za-z0-9_-]+:\s*write\s*$", source, flags=re.MULTILINE):
        fail("source continuous certification workflow must remain read-only")

    uses_lines = [line.strip() for line in source.splitlines() if line.strip().startswith("uses:")]
    if not uses_lines:
        fail("source continuous certification workflow must use pinned GitHub Actions")
    for line in uses_lines:
        ref = line.rsplit("@", 1)[-1] if "@" in line else ""
        if not re.fullmatch(r"[0-9a-f]{40}", ref):
            fail(f"GitHub Action must be pinned to a full commit SHA: {line}")

    try:
        boundary = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"unable to read vendor source boundary: {exc}")
        boundary = {}
    vendor_only = set(boundary.get("vendor_only_paths") or [])
    for path in (
        WORKFLOW_PATH, "scripts/validate_source_continuous_certification.py",
        "tests/test_source_continuous_certification.py",
    ):
        if path not in vendor_only:
            fail(f"source-only continuous certification asset must be vendor-only: {path}")

    bootstrap = (ROOT / "scripts" / "bootstrap_instance.py").read_text(encoding="utf-8")
    if "source-continuous-certification.yml" in bootstrap:
        fail("source-only continuous certification workflow must not be installed as a child workflow blueprint")

    if ERRORS:
        print("Source continuous certification validation failed:", file=sys.stderr)
        for error in ERRORS:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Source continuous certification validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

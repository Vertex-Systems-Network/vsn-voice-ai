#!/usr/bin/env python3
"""Production smoke verifier for the separately deployed ANPOS commercial service.

This tool never creates Marketplace purchases or treats synthetic events as real billing
evidence. It verifies observable deployment/runtime gates, exact deployment identity when
production readiness is required, and optional authenticated operator/customer paths supplied
by the operator at execution time.
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

DEFAULT_TIMEOUT = 15.0
MAX_RESPONSE_BYTES = 1_000_000
MAX_SAFE_GITHUB_ACCOUNT_ID = 9_007_199_254_740_991
EXPECTED_SERVICE_NAME = "anpos-commercial-service"
EXPECTED_RUNTIME_CONTRACT = "split-github-app-v1"


class VerificationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        try:
            return json.loads(self.body.decode("utf-8"))
        except Exception as exc:  # pragma: no cover - exact decoder message is not contractual
            raise VerificationError(f"response is not valid UTF-8 JSON: {exc}") from exc


def normalize_base_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.netloc:
        raise VerificationError("base URL must be an absolute https:// URL")
    if parsed.username or parsed.password:
        raise VerificationError("base URL must not contain embedded credentials")
    if parsed.query or parsed.fragment:
        raise VerificationError("base URL must not contain query/fragment data")
    path = parsed.path.rstrip("/")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def normalize_expected_version(value: str | None, label: str) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized or len(normalized) > 100 or any(ch.isspace() for ch in normalized):
        raise VerificationError(f"{label} must be a non-empty, whitespace-free value up to 100 characters")
    return normalized


def normalize_github_account_id(value: str | None) -> int | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized or not normalized.isascii() or not normalized.isdigit():
        raise VerificationError("GitHub account ID must be a positive decimal integer")
    account_id = int(normalized)
    if account_id <= 0 or account_id > MAX_SAFE_GITHUB_ACCOUNT_ID:
        raise VerificationError("GitHub account ID must be a positive JavaScript-safe integer")
    return account_id


def request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Response:
    url = base_url + path
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=context) as raw:
            payload = raw.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise VerificationError(f"response from {path} exceeded {MAX_RESPONSE_BYTES} bytes")
            return Response(raw.status, {k.lower(): v for k, v in raw.headers.items()}, payload)
    except urllib.error.HTTPError as exc:
        payload = exc.read(MAX_RESPONSE_BYTES + 1)
        if len(payload) > MAX_RESPONSE_BYTES:
            payload = payload[:MAX_RESPONSE_BYTES]
        return Response(exc.code, {k.lower(): v for k, v in exc.headers.items()}, payload)
    except urllib.error.URLError as exc:
        raise VerificationError(f"request to {path} failed: {exc.reason}") from exc


def require_status(response: Response, expected: int, label: str) -> None:
    if response.status != expected:
        raise VerificationError(f"{label} expected HTTP {expected}, got {response.status}")


def check_health(base_url: str, timeout: float) -> None:
    response = request(base_url, "/api/health", timeout=timeout)
    require_status(response, 200, "health endpoint")
    data = response.json()
    if not isinstance(data, dict):
        raise VerificationError("health endpoint must return a JSON object")
    if data.get("service") != EXPECTED_SERVICE_NAME or data.get("status") != "alive":
        raise VerificationError("health endpoint returned an unexpected service identity/status")


def validate_version_payload(
    data: Any,
    expected_service_version: str | None,
    expected_protocol_version: str | None,
) -> dict[str, str]:
    if not isinstance(data, dict):
        raise VerificationError("version endpoint must return a JSON object")
    if data.get("ok") is not True:
        raise VerificationError("version endpoint must report ok=true")
    if data.get("service") != EXPECTED_SERVICE_NAME:
        raise VerificationError("version endpoint returned an unexpected service name")

    service_version = data.get("service_version")
    protocol_version = data.get("source_protocol_version")
    runtime_contract = data.get("runtime_contract")
    if not isinstance(service_version, str) or not service_version.strip():
        raise VerificationError("version endpoint is missing service_version")
    if not isinstance(protocol_version, str) or not protocol_version.strip():
        raise VerificationError("version endpoint is missing source_protocol_version")
    if runtime_contract != EXPECTED_RUNTIME_CONTRACT:
        raise VerificationError(
            f"version endpoint runtime_contract must be {EXPECTED_RUNTIME_CONTRACT!r}, got {runtime_contract!r}"
        )
    if expected_service_version and service_version != expected_service_version:
        raise VerificationError(
            f"deployed service version mismatch: expected {expected_service_version}, got {service_version}"
        )
    if expected_protocol_version and protocol_version != expected_protocol_version:
        raise VerificationError(
            f"deployed source protocol version mismatch: expected {expected_protocol_version}, got {protocol_version}"
        )
    return {
        "service_version": service_version,
        "source_protocol_version": protocol_version,
        "runtime_contract": runtime_contract,
    }


def check_version(
    base_url: str,
    timeout: float,
    expected_service_version: str | None,
    expected_protocol_version: str | None,
) -> dict[str, str]:
    response = request(base_url, "/api/version", timeout=timeout)
    require_status(response, 200, "version endpoint")
    return validate_version_payload(response.json(), expected_service_version, expected_protocol_version)


def check_readiness(base_url: str, timeout: float, require_ready: bool) -> None:
    response = request(base_url, "/api/ready", timeout=timeout)
    if require_ready:
        require_status(response, 200, "readiness endpoint")
        data = response.json()
        if not isinstance(data, dict) or data.get("ok") is not True or data.get("status") != "ready":
            raise VerificationError("readiness endpoint must return ok=true/status=ready for production certification")
    elif response.status == 200:
        response.json()
    elif response.status not in {401, 403, 404, 503}:
        raise VerificationError(
            f"readiness endpoint returned unexpected HTTP {response.status}; expected 200 or a fail-closed/protected status"
        )


def check_public_keys(base_url: str, timeout: float) -> None:
    response = request(base_url, "/api/v1/keys", timeout=timeout)
    require_status(response, 200, "public entitlement keys endpoint")
    data = response.json()
    if not isinstance(data, dict):
        raise VerificationError("public entitlement keys endpoint must return a JSON object")


def check_current_entitlement(base_url: str, timeout: float, github_token: str, account_id: int) -> None:
    response = request(
        base_url,
        "/api/v1/entitlements/current",
        headers={
            "Authorization": f"Bearer {github_token}",
            "X-Anpos-Account-Id": str(account_id),
        },
        timeout=timeout,
    )
    if response.status == 200:
        data = response.json()
        if not isinstance(data, dict) or data.get("ok") is not True:
            raise VerificationError("current entitlement HTTP 200 response must be a JSON object with ok=true")
        return
    if response.status == 404:
        data = response.json()
        if isinstance(data, dict) and data.get("error") == "entitlement_not_found":
            return
        raise VerificationError("current entitlement HTTP 404 did not match the canonical entitlement_not_found contract")
    raise VerificationError(
        f"current entitlement authenticated smoke expected HTTP 200 or structured entitlement_not_found 404, got {response.status}"
    )


def check_operator_reconcile(base_url: str, timeout: float, operator_token: str) -> None:
    """Authenticate the operator route without performing a real reconciliation mutation."""
    response = request(
        base_url,
        "/api/v1/reconcile",
        method="POST",
        headers={
            "Authorization": f"Bearer {operator_token}",
            "Content-Type": "application/json",
            "Idempotency-Key": "anpos-production-verifier-contract-probe",
        },
        body=json.dumps({}, separators=(",", ":")).encode("utf-8"),
        timeout=timeout,
    )
    if response.status != 400:
        raise VerificationError(
            f"operator reconciliation authenticated contract probe expected HTTP 400, got {response.status}"
        )
    data = response.json()
    if not isinstance(data, dict) or data.get("error") != "valid_account_id_required":
        raise VerificationError(
            "operator reconciliation HTTP 400 did not match the canonical valid_account_id_required contract"
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Production/staging commercial-service HTTPS base URL")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parser.add_argument("--require-ready", action="store_true", help="Require exact deployment identity and /api/ready HTTP 200")
    parser.add_argument(
        "--expected-service-version",
        default=None,
        help="Expected deployed commercial-service version. Required with --require-ready.",
    )
    parser.add_argument(
        "--expected-protocol-version",
        default=None,
        help="Expected ANPOS source protocol version embedded in the deployed artifact. Required with --require-ready.",
    )
    parser.add_argument(
        "--github-token-env",
        default=None,
        help="Optional environment-variable name containing a GitHub user token for entitlement smoke verification",
    )
    parser.add_argument(
        "--operator-token-env",
        default=None,
        help="Optional environment-variable name containing the operator token for non-mutating authenticated route verification",
    )
    parser.add_argument(
        "--github-account-id",
        default=None,
        help="Positive numeric GitHub account ID required when --github-token-env is used",
    )
    return parser.parse_args(argv)


def read_secret_from_env(name: str | None) -> str | None:
    if not name:
        return None
    value = os.environ.get(name)
    if not value:
        raise VerificationError(f"required environment variable {name!r} is missing or empty")
    return value


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        if args.timeout <= 0 or args.timeout > 60:
            raise VerificationError("timeout must be > 0 and <= 60 seconds")
        base_url = normalize_base_url(args.base_url)
        expected_service_version = normalize_expected_version(args.expected_service_version, "expected service version")
        expected_protocol_version = normalize_expected_version(args.expected_protocol_version, "expected protocol version")
        github_account_id = normalize_github_account_id(args.github_account_id)
        if args.require_ready and (not expected_service_version or not expected_protocol_version):
            raise VerificationError(
                "--require-ready requires --expected-service-version and --expected-protocol-version so a stale artifact cannot be certified"
            )
        github_token = read_secret_from_env(args.github_token_env)
        operator_token = read_secret_from_env(args.operator_token_env)
        if github_token and github_account_id is None:
            raise VerificationError("--github-token-env requires --github-account-id for the canonical entitlement route contract")

        check_health(base_url, args.timeout)
        identity = check_version(base_url, args.timeout, expected_service_version, expected_protocol_version)
        check_readiness(base_url, args.timeout, args.require_ready)
        check_public_keys(base_url, args.timeout)
        if github_token:
            assert github_account_id is not None
            check_current_entitlement(base_url, args.timeout, github_token, github_account_id)
        if operator_token:
            check_operator_reconcile(base_url, args.timeout, operator_token)
    except VerificationError as exc:
        print(f"ANPOS commercial production verification FAILED: {exc}", file=sys.stderr)
        return 1

    print(
        "ANPOS commercial production smoke verification passed "
        f"(service={identity['service_version']}, protocol={identity['source_protocol_version']}, "
        f"contract={identity['runtime_contract']})."
    )
    if not args.require_ready:
        print(
            "NOTE: production launch is not certified unless --require-ready passes and real Marketplace E2E evidence is recorded. "
            "--require-ready also requires exact expected service/protocol versions and exact deployment identity."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

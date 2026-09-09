from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERIFIER_PATH = ROOT / "scripts" / "verify_commercial_production.py"


def load_verifier():
    name = "verify_commercial_production_identity_tests"
    spec = importlib.util.spec_from_file_location(name, VERIFIER_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class DeploymentIdentityTests(unittest.TestCase):
    def current_identity(self) -> tuple[dict, dict]:
        package = json.loads((ROOT / "commercial-service/package.json").read_text(encoding="utf-8"))
        protocol = json.loads((ROOT / "config/protocol/version.json").read_text(encoding="utf-8"))
        return package, protocol

    def test_version_payload_requires_exact_service_protocol_and_runtime_contract(self) -> None:
        verifier = load_verifier()
        package, protocol = self.current_identity()
        service_version = package["version"]
        protocol_version = protocol["version"]
        payload = {
            "ok": True,
            "service": package["name"],
            "service_version": service_version,
            "source_protocol_version": protocol_version,
            "runtime_contract": package["anpos"]["runtime_contract"],
        }
        identity = verifier.validate_version_payload(payload, service_version, protocol_version)
        self.assertEqual(identity["service_version"], service_version)
        self.assertEqual(identity["source_protocol_version"], protocol_version)
        with self.assertRaisesRegex(verifier.VerificationError, "service version mismatch"):
            verifier.validate_version_payload(payload, "0.0.0", protocol_version)
        with self.assertRaisesRegex(verifier.VerificationError, "source protocol version mismatch"):
            verifier.validate_version_payload(payload, service_version, "0.0.0")
        with self.assertRaisesRegex(verifier.VerificationError, "runtime_contract"):
            verifier.validate_version_payload({**payload, "runtime_contract": "legacy"}, service_version, protocol_version)

    def test_require_ready_refuses_missing_expected_identity_before_network(self) -> None:
        verifier = load_verifier()
        self.assertEqual(
            verifier.main(["--base-url", "https://example.test", "--require-ready"]),
            1,
        )

    def test_verifier_uses_actual_next_api_prefixes(self) -> None:
        source = VERIFIER_PATH.read_text(encoding="utf-8")
        for expected in (
            '"/api/version"',
            '"/api/v1/keys"',
            '"/api/v1/entitlements/current"',
            '"/api/v1/reconcile"',
        ):
            self.assertIn(expected, source)
        for stale in (
            'request(base_url, "/v1/keys"',
            '"/v1/entitlements/current",',
            '"/v1/reconcile",',
        ):
            self.assertNotIn(stale, source)

    def test_authenticated_smoke_contract_is_fail_closed_and_canonical(self) -> None:
        source = VERIFIER_PATH.read_text(encoding="utf-8")
        for expected in (
            '"X-Anpos-Account-Id"',
            '"entitlement_not_found"',
            '"valid_account_id_required"',
            '"anpos-production-verifier-contract-probe"',
            'body=json.dumps({}, separators=(",", ":"))',
            '"--github-account-id"',
        ):
            self.assertIn(expected, source)
        self.assertNotIn('"dry_run"', source)
        self.assertNotIn('payload["github_account_id"]', source)

    def test_service_package_embeds_certified_source_identity(self) -> None:
        package, protocol = self.current_identity()
        self.assertRegex(package["version"], r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
        self.assertEqual(package["anpos"]["source_protocol_version"], protocol["version"])
        self.assertEqual(package["anpos"]["runtime_contract"], "split-github-app-v1")

    def test_version_route_is_public_non_secret_and_package_derived(self) -> None:
        source = (ROOT / "commercial-service/app/api/version/route.ts").read_text(encoding="utf-8")
        for marker in (
            'import packageJson from "@/package.json"',
            "service_version",
            "source_protocol_version",
            "runtime_contract",
            '"Cache-Control": "no-store"',
        ):
            self.assertIn(marker, source)
        self.assertNotIn("process.env", source)
        self.assertNotIn("serviceConfig", source)

    def test_service_api_contract_requires_deployment_identity(self) -> None:
        contract = json.loads((ROOT / "blueprints/commercial/service-api-contract.json").read_text(encoding="utf-8"))
        version = next(item for item in contract["endpoints"] if item.get("path") == "/version")
        self.assertEqual(version["authentication"], "public_read")
        self.assertTrue(version["must_not_return_secrets"])
        self.assertEqual(version["cache_control"], "no-store")
        self.assertTrue(contract["cross_cutting_rules"]["deployment_identity_endpoint_required"])
        self.assertTrue(contract["cross_cutting_rules"]["production_readiness_requires_expected_artifact_identity"])


if __name__ == "__main__":
    unittest.main()

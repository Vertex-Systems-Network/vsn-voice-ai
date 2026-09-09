from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "commercial-service"


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class PremiumDistributionSourceTests(unittest.TestCase):
    def test_runtime_identity_and_lock_are_039(self) -> None:
        package = load("commercial-service/package.json")
        lock = load("commercial-service/package-lock.json")
        self.assertEqual(package["version"], "0.3.9")
        self.assertEqual(lock["version"], "0.3.9")
        self.assertEqual(lock["packages"][""]["version"], "0.3.9")
        self.assertEqual(package["anpos"]["source_protocol_version"], "1.3.13")
        self.assertEqual(package["anpos"]["runtime_contract"], "split-github-app-v1")

    def test_env_contract_is_conditional_and_immutable(self) -> None:
        source = (SERVICE / "lib/env.ts").read_text(encoding="utf-8")
        example = (SERVICE / ".env.example").read_text(encoding="utf-8")
        for marker in [
            "premiumPaidPlanConfigured",
            "premiumDistributionConfigurationProblems",
            "premiumDistributionConfig",
            "ANPOS_PRIVATE_PREMIUM_REPO",
            "ANPOS_PREMIUM_RELEASE_REF",
            "ANPOS_PREMIUM_MANIFEST_SHA256",
            "ANPOS_PREMIUM_CONTENT_SET_SHA256",
            "unsafe:ANPOS_PREMIUM_REPOSITORY_MUST_BE_DISTINCT",
            "^[0-9a-f]{40}$",
            "^[0-9a-f]{64}$",
        ]:
            self.assertIn(marker, source)
        for marker in [
            "Developer-only map does not require premium config",
            "ANPOS_PRIVATE_PREMIUM_REPO",
            "ANPOS_PREMIUM_RELEASE_REF",
            "ANPOS_PREMIUM_MANIFEST_SHA256",
            "ANPOS_PREMIUM_CONTENT_SET_SHA256",
            "scripts/verify_premium_pack.py",
        ]:
            self.assertIn(marker, example)

    def test_runtime_manifest_binding_and_archive_redirect_are_present(self) -> None:
        parser = (SERVICE / "lib/premium-releases.ts").read_text(encoding="utf-8")
        github = (SERVICE / "lib/github.ts").read_text(encoding="utf-8")
        for marker in [
            "parsePremiumReleaseManifest",
            "PREMIUM_RELEASE_PROTOCOL_NOT_COMPATIBLE",
            "PREMIUM_PROVIDER_PARTNERSHIP_CLAIM_FORBIDDEN",
            "PREMIUM_PROVIDER_MANIFEST_ENTRY_REQUIRED",
            "content_set_sha256",
            "private_premium_repository",
            "immutable_release_identity_required",
        ]:
            self.assertIn(marker, parser)
        for marker in [
            "premiumReleaseManifest",
            "premiumArchiveRedirect",
            "ANPOS-PREMIUM-MANIFEST.json",
            "PREMIUM_RELEASE_MANIFEST_DIGEST_MISMATCH",
            "PREMIUM_RELEASE_CONTENT_SET_DIGEST_MISMATCH",
            "codeload.github.com",
            "premiumDistributionConfig",
        ]:
            self.assertIn(marker, github)

    def test_premium_routes_require_both_entitlements_seat_and_reconciliation(self) -> None:
        for relative, event in [
            ("app/api/v1/premium/releases/current/route.ts", "premium_release_metadata_issued"),
            ("app/api/v1/premium/archive/route.ts", "premium_archive_issued"),
        ]:
            source = (SERVICE / relative).read_text(encoding="utf-8")
            for marker in [
                "premium_blueprints",
                "premium_provider_adapters",
                "reconcileEntitlement",
                "requireActiveSeat",
                event,
                "private, no-store" if "releases/current" in relative else "Referrer-Policy",
            ]:
                self.assertIn(marker, source)
        archive = (SERVICE / "app/api/v1/premium/archive/route.ts").read_text(encoding="utf-8")
        self.assertIn("PREMIUM_RELEASE_REF_MISMATCH", archive)
        self.assertIn("status: 307", archive)

    def test_api_contract_declares_premium_distribution_without_sale_claim(self) -> None:
        contract = load("blueprints/commercial/service-api-contract.json")
        self.assertEqual(contract["schema_version"], 6)
        endpoints = {(row["method"], row["path"]): row for row in contract["endpoints"]}
        metadata = endpoints[("GET", "/v1/premium/releases/current")]
        archive = endpoints[("GET", "/v1/premium/archive")]
        self.assertEqual(metadata["requires_entitlements"], ["premium_blueprints", "premium_provider_adapters"])
        self.assertTrue(metadata["manifest_sha256_must_match_verifier_receipt"])
        self.assertTrue(metadata["content_set_sha256_must_match_verifier_receipt"])
        self.assertTrue(archive["immutable_premium_release_ref_required"])
        rules = contract["cross_cutting_rules"]
        self.assertTrue(rules["premium_distribution_configuration_required_when_higher_paid_tier_is_activated"])
        self.assertTrue(rules["premium_repository_must_be_distinct_from_private_template_repository"])
        self.assertTrue(rules["premium_source_distribution_plumbing_is_not_premium_payload_or_sale_readiness"])

    def test_catalog_and_pack_contract_remain_fail_closed(self) -> None:
        catalog = load("config/licensing/feature-catalog.json")
        entitlements = {row["id"]: row for row in catalog["entitlements"]}
        for key in ["premium_blueprints", "premium_provider_adapters"]:
            self.assertEqual(entitlements[key]["availability"], "planned_not_implemented")
            self.assertIn("payload_not_implemented", entitlements[key]["commercial_differentiator_status"])
        readiness = load("config/licensing/premium-pack-contract.json")["current_readiness"]
        self.assertTrue(readiness["distribution_runtime_source_implemented"])
        self.assertFalse(readiness["private_premium_repository_exists"])
        self.assertFalse(readiness["entitlement_gated_premium_distribution_implemented"])
        self.assertFalse(readiness["production_premium_e2e_verified"])
        self.assertFalse(readiness["pro_sale_ready"])

    def test_commercial_role_routes_premium_runtime(self) -> None:
        role = set(load(".ai/manifest.json")["roles"]["commercial_distribution"])
        for path in [
            "commercial-service/lib/premium-releases.ts",
            "commercial-service/app/api/v1/premium/releases/current/route.ts",
            "commercial-service/app/api/v1/premium/archive/route.ts",
        ]:
            self.assertIn(path, role)


if __name__ == "__main__":
    unittest.main()

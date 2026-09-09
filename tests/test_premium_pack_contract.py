from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import verify_premium_pack as verifier


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class PremiumPackContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / "premium-pack"
        self.repo.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def manifest(self, files: list[dict], *, providers: list[dict] | None = None, minimum: str = "1.3.13", maximum: str = "1.3.13") -> dict:
        return {
            "schema_version": 1,
            "pack_id": "anpos-premium-pro",
            "pack_version": "1.0.0",
            "source_protocol_compatibility": {"minimum": minimum, "maximum": maximum},
            "capabilities": [
                {
                    "id": "premium_delivery_workflow",
                    "display_name": "Premium Delivery Workflow",
                    "asset_classes": ["premium_blueprint", "premium_documentation"],
                },
                {
                    "id": "premium_provider_automation",
                    "display_name": "Premium Provider Automation",
                    "asset_classes": ["premium_provider_adapter"],
                },
            ],
            "providers": providers or [],
            "files": files,
            "provenance": {
                "distribution_scope": "private_premium_repository",
                "contains_customer_secrets": False,
                "contains_operator_secrets": False,
                "derived_only_from_public_core": False,
                "immutable_release_identity_required": True,
            },
        }

    def write_payload(self, relative: str, data: bytes) -> dict:
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        asset_class = {
            "premium/blueprints/": "premium_blueprint",
            "premium/providers/": "premium_provider_adapter",
            "premium/governance/": "premium_governance_recipe",
            "premium/docs/": "premium_documentation",
        }[next(prefix for prefix in ["premium/blueprints/", "premium/providers/", "premium/governance/", "premium/docs/"] if relative.startswith(prefix))]
        capability = "premium_provider_automation" if asset_class == "premium_provider_adapter" else "premium_delivery_workflow"
        return {
            "path": relative,
            "asset_class": asset_class,
            "sha256": digest(data),
            "bytes": len(data),
            "capability_ids": [capability],
        }

    def write_manifest(self, manifest: dict) -> None:
        (self.repo / "ANPOS-PREMIUM-MANIFEST.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def assert_error(self, expected: str, *, protocol: str = "1.3.13") -> None:
        with self.assertRaises(verifier.VerificationError) as ctx:
            verifier.verify(self.repo, expected_pack_id="anpos-premium-pro", expected_pack_version="1.0.0", expected_protocol_version=protocol)
        self.assertIn(expected, str(ctx.exception))

    def test_contract_is_fail_closed_and_does_not_claim_pro_value(self) -> None:
        contract = load("config/licensing/premium-pack-contract.json")
        self.assertEqual(contract["schema_version"], 2)
        self.assertEqual(contract["status"], "contract_and_distribution_source_no_premium_payload")
        self.assertTrue(contract["private_repository_required"])
        self.assertTrue(contract["canonical_source_must_not_contain_premium_payload"])
        self.assertTrue(contract["source_contract_is_not_premium_entitlement_value"])
        readiness = contract["current_readiness"]
        self.assertTrue(readiness["contract_defined"])
        self.assertTrue(readiness["distribution_runtime_source_implemented"])
        self.assertFalse(readiness["private_premium_repository_exists"])
        self.assertFalse(readiness["premium_blueprint_payload_implemented"])
        self.assertFalse(readiness["premium_provider_adapter_payload_implemented"])
        self.assertFalse(readiness["entitlement_gated_premium_distribution_implemented"])
        self.assertFalse(readiness["production_premium_e2e_verified"])
        self.assertFalse(readiness["pro_sale_ready"])

    def test_distribution_boundary_is_immutable_digest_bound_and_conditional(self) -> None:
        boundary = load("config/licensing/premium-pack-contract.json")["distribution_boundary"]
        self.assertEqual(boundary["required_entitlements"], ["premium_blueprints", "premium_provider_adapters"])
        self.assertTrue(boundary["private_pack_repository_must_be_distinct_from_private_template_repository"])
        self.assertTrue(boundary["runtime_manifest_sha256_must_match_offline_verifier_receipt"])
        self.assertTrue(boundary["runtime_content_set_sha256_must_match_offline_verifier_receipt"])
        self.assertTrue(boundary["runtime_release_ref_must_be_exact_40_character_commit_sha"])
        self.assertTrue(boundary["higher_paid_plan_activation_requires_premium_distribution_configuration"])
        self.assertTrue(boundary["developer_only_plan_activation_does_not_require_premium_distribution_configuration"])

    def test_commercial_role_routes_contract_schema_docs_verifier_and_runtime(self) -> None:
        manifest = load(".ai/manifest.json")
        role = set(manifest["roles"]["commercial_distribution"])
        for expected in [
            "config/licensing/premium-pack-contract.json",
            "schemas/premium-pack-manifest.schema.json",
            "docs/commercial/premium-pack-boundary.md",
            "scripts/verify_premium_pack.py",
            "commercial-service/lib/premium-releases.ts",
            "commercial-service/app/api/v1/premium/releases/current/route.ts",
            "commercial-service/app/api/v1/premium/archive/route.ts",
        ]:
            self.assertIn(expected, role)

    def test_feature_catalog_keeps_premium_entitlements_blocked_but_references_distribution_source(self) -> None:
        catalog = load("config/licensing/feature-catalog.json")
        rows = {row["id"]: row for row in catalog["entitlements"]}
        for entitlement_id in ["premium_blueprints", "premium_provider_adapters"]:
            row = rows[entitlement_id]
            self.assertEqual(row["availability"], "planned_not_implemented")
            self.assertEqual(
                row["commercial_differentiator_status"],
                "contract_and_distribution_runtime_source_implemented_payload_not_implemented",
            )
            for expected in [
                "config/licensing/premium-pack-contract.json",
                "scripts/verify_premium_pack.py",
                "commercial-service/lib/premium-releases.ts",
                "commercial-service/app/api/v1/premium/releases/current/route.ts",
                "commercial-service/app/api/v1/premium/archive/route.ts",
            ]:
                self.assertIn(expected, row["evidence"])

    def test_valid_private_pack_returns_integrity_receipt_without_sale_claim(self) -> None:
        first = self.write_payload("premium/blueprints/delivery.md", b"ANPOS premium delivery workflow v1 unique test payload\n")
        second = self.write_payload("premium/docs/guide.md", b"ANPOS premium guide unique test payload\n")
        self.write_manifest(self.manifest([first, second]))
        receipt = verifier.verify(
            self.repo,
            expected_pack_id="anpos-premium-pro",
            expected_pack_version="1.0.0",
            expected_protocol_version="1.3.13",
        )
        self.assertTrue(receipt["ok"])
        self.assertEqual(receipt["verification"], "anpos_private_premium_pack_contract_v1")
        self.assertEqual(receipt["file_count"], 2)
        self.assertFalse(receipt["pro_sale_ready"])
        self.assertEqual(receipt["verified_protocol_version"], "1.3.13")
        self.assertRegex(receipt["manifest_sha256"], r"^[a-f0-9]{64}$")
        self.assertRegex(receipt["content_set_sha256"], r"^[a-f0-9]{64}$")

    def test_tampered_payload_is_rejected(self) -> None:
        row = self.write_payload("premium/blueprints/delivery.md", b"original premium payload\n")
        self.write_manifest(self.manifest([row]))
        (self.repo / row["path"]).write_text("tampered\n", encoding="utf-8")
        self.assert_error("PREMIUM_FILE_BYTE_COUNT_MISMATCH")

    def test_unmanifested_payload_is_rejected(self) -> None:
        row = self.write_payload("premium/blueprints/delivery.md", b"manifested premium payload\n")
        self.write_payload("premium/docs/extra.md", b"extra premium payload\n")
        self.write_manifest(self.manifest([row]))
        self.assert_error("PREMIUM_PAYLOAD_MANIFEST_SET_MISMATCH")

    def test_secret_marker_is_rejected(self) -> None:
        row = self.write_payload("premium/docs/unsafe.txt", b"token=github_pat_example_should_never_ship\n")
        self.write_manifest(self.manifest([row]))
        self.assert_error("PREMIUM_SECRET_MARKER_FORBIDDEN")

    def test_exact_copy_of_canonical_tracked_file_is_rejected(self) -> None:
        canonical = (ROOT / "README.md").read_bytes()
        row = self.write_payload("premium/docs/copied-readme.md", canonical)
        self.write_manifest(self.manifest([row]))
        self.assert_error("PREMIUM_FILE_EXACT_COPY_OF_CANONICAL_SOURCE")

    def test_provider_adapter_requires_matching_provider_manifest_entry(self) -> None:
        row = self.write_payload("premium/providers/example/adapter.txt", b"premium provider adapter test implementation\n")
        self.write_manifest(self.manifest([row], providers=[]))
        self.assert_error("PREMIUM_PROVIDER_MANIFEST_ENTRY_REQUIRED")

    def test_provider_adapter_with_declared_provider_verifies(self) -> None:
        row = self.write_payload("premium/providers/example/adapter.txt", b"premium provider adapter declared implementation\n")
        providers = [
            {
                "provider_id": "example",
                "adapter_version": "1.0.0",
                "tested_provider_version_or_api": "test-api-v1",
                "capability_ids": ["premium_provider_automation"],
                "partnership_or_certification_claim": False,
            }
        ]
        self.write_manifest(self.manifest([row], providers=providers))
        receipt = verifier.verify(self.repo, expected_protocol_version="1.3.13")
        self.assertTrue(receipt["ok"])
        self.assertFalse(receipt["pro_sale_ready"])

    def test_protocol_outside_compatibility_range_is_rejected(self) -> None:
        row = self.write_payload("premium/blueprints/delivery.md", b"protocol bounded premium payload\n")
        self.write_manifest(self.manifest([row], minimum="1.3.10", maximum="1.3.12"))
        self.assert_error("PREMIUM_PROTOCOL_NOT_COMPATIBLE", protocol="1.3.13")

    @unittest.skipIf(os.name == "nt", "symlink creation requires platform privileges on some Windows runners")
    def test_symlink_payload_is_rejected(self) -> None:
        real = self.repo / "real.txt"
        real.write_text("outside declared premium tree\n", encoding="utf-8")
        link = self.repo / "premium" / "docs" / "link.txt"
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(real)
        manifest = self.manifest([
            {
                "path": "premium/docs/link.txt",
                "asset_class": "premium_documentation",
                "sha256": digest(real.read_bytes()),
                "bytes": real.stat().st_size,
                "capability_ids": ["premium_delivery_workflow"],
            }
        ])
        self.write_manifest(manifest)
        self.assert_error("PREMIUM_REGULAR_FILE_REQUIRED")


if __name__ == "__main__":
    unittest.main()

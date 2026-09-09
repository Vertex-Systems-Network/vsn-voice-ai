from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class CommercialLicensingTests(unittest.TestCase):
    def test_source_commercial_layer_is_inactive(self) -> None:
        policy = load("config/licensing/commercial-policy.json")
        adapter = load("config/licensing/marketplace-adapter.json")
        entitlement = load("config/licensing/entitlement-reference.json")
        self.assertEqual(policy["status"], "template_blueprint")
        self.assertEqual(policy["activation_scope"], "commercial_distribution_only")
        self.assertFalse(policy["enabled"])
        self.assertFalse(adapter["configured"])
        self.assertEqual(entitlement["state"], "unbound")
        self.assertFalse(entitlement["authority"])
        self.assertEqual(entitlement["verification"]["status"], "not_verified")

    def test_repository_cache_cannot_be_billing_authority(self) -> None:
        policy = load("config/licensing/commercial-policy.json")
        authority = policy["authority"]
        self.assertFalse(authority["repository_entitlement_cache_is_authority"])
        self.assertTrue(authority["server_side_entitlement_ledger_required"])
        self.assertTrue(authority["billing_provider_reconciliation_required_on_ambiguity"])

    def test_expiry_is_non_destructive(self) -> None:
        rules = load("config/licensing/commercial-policy.json")["non_destructive_expiry"]
        self.assertTrue(rules["existing_generated_project_must_continue"])
        self.assertTrue(rules["remote_repository_deletion_for_license_expiry_forbidden"])
        self.assertTrue(rules["intentional_build_breakage_for_license_expiry_forbidden"])
        self.assertTrue(rules["code_or_data_encryption_kill_switch_forbidden"])

    def test_marketplace_webhook_is_verified_and_idempotent(self) -> None:
        adapter = load("config/licensing/marketplace-adapter.json")
        webhook = adapter["webhook"]
        self.assertEqual(webhook["event"], "marketplace_purchase")
        self.assertEqual(set(webhook["supported_actions"]), {"purchased", "changed", "cancelled"})
        self.assertEqual(webhook["signature_header"], "X-Hub-Signature-256")
        self.assertEqual(webhook["delivery_id_header"], "X-GitHub-Delivery")
        self.assertTrue(webhook["constant_time_signature_compare_required"])
        self.assertTrue(webhook["delivery_id_deduplication_required"])
        self.assertTrue(webhook["out_of_order_or_ambiguous_event_requires_api_reconciliation"])

    def test_secrets_never_live_in_repository(self) -> None:
        adapter = load("config/licensing/marketplace-adapter.json")
        secrets = adapter["secrets"]
        self.assertFalse(secrets["webhook_secret_in_repository"])
        self.assertFalse(secrets["github_app_private_key_in_repository"])
        self.assertFalse(secrets["entitlement_signing_private_key_in_repository"])
        self.assertTrue(secrets["secrets_manager_required"])

    def test_product_catalog_is_draft_and_external_pricing(self) -> None:
        catalog = load("config/licensing/product-catalog.json")
        self.assertTrue(catalog["pricing_is_external_to_repository"])
        plans = catalog["plans"]
        self.assertGreaterEqual(len(plans), 1)
        self.assertEqual(len({plan["id"] for plan in plans}), len(plans))
        for plan in plans:
            self.assertEqual(plan["sale_status"], "draft")
            self.assertIsNone(plan["marketplace_plan_id"])
            self.assertIsNone(plan["monthly_price_usd"])
            self.assertIsNone(plan["annual_price_usd"])

    def test_commercial_conformance_scenarios_exist(self) -> None:
        names = {row["name"] for row in load("config/testing/conformance-scenarios.json")["scenarios"]}
        self.assertTrue({
            "marketplace_webhook_forgery_or_replay",
            "entitlement_expiry_non_destructive",
            "marketplace_plan_change_entitlement_reconciliation",
        }.issubset(names))


if __name__ == "__main__":
    unittest.main()

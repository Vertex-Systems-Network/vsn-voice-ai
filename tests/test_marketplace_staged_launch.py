from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MarketplaceStagedLaunchTests(unittest.TestCase):
    def test_staged_marketplace_launch_is_fail_closed(self) -> None:
        strategy = json.loads((ROOT / "blueprints/commercial/marketplace-staged-launch.json").read_text(encoding="utf-8"))
        self.assertEqual(strategy["status"], "inactive_blueprint")
        self.assertEqual(strategy["activation_scope"], "vendor_marketplace_launch_only")
        self.assertEqual(strategy["strategy"], "free_first_then_paid")
        self.assertEqual(strategy["source_checked_at"], "2026-09-04")

        architecture = strategy["github_app_architecture"]
        self.assertEqual(architecture["marketplace_app_reference"], "blueprints/commercial/github-marketplace-app-manifest.example.json")
        self.assertEqual(architecture["vendor_app_reference"], "blueprints/commercial/github-vendor-app-manifest.example.json")
        self.assertTrue(architecture["marketplace_app_must_be_public"])
        self.assertTrue(architecture["apps_must_remain_distinct"])
        self.assertTrue(architecture["vendor_administration_must_not_be_requested_from_customer_installations"])

        free = strategy["phase_1_free_listing"]
        self.assertTrue(free["requires_general_marketplace_listing_compliance"])
        self.assertTrue(free["requires_public_marketplace_app_installability"])
        self.assertTrue(free["requires_public_availability"])
        self.assertTrue(free["requires_value_beyond_authentication"])
        self.assertTrue({"purchased", "cancelled"}.issubset(set(free["required_marketplace_events_when_free_only"])))
        self.assertFalse(free["paid_trial_upgrade_downgrade_handling_required_while_free_only"])
        self.assertEqual(free["free_plan_definition"]["status"], "operator_decision_required")
        self.assertIsNone(free["free_plan_definition"]["catalog_plan_id"])
        self.assertIsNone(free["free_plan_definition"]["marketplace_plan_id"])
        self.assertEqual(free["free_plan_definition"]["entitlements"], [])

        paid = strategy["phase_2_paid_eligibility"]
        self.assertEqual(paid["current_minimum_github_app_installations"], 100)
        self.assertTrue(paid["verified_publisher_required"])
        self.assertTrue(paid["financial_onboarding_required"])
        self.assertTrue(paid["paid_plans_can_be_added_to_existing_free_listing"])
        conversion = strategy["conversion"]
        self.assertFalse(conversion["automatic"])
        self.assertTrue(conversion["operator_approval_required"])
        self.assertFalse(conversion["repository_can_authorize_paid_conversion"])
        self.assertFalse(conversion["paid_product_catalog_mutation_allowed_by_this_blueprint"])

    def test_staged_free_to_paid_path_preserves_paid_catalog(self) -> None:
        catalog = json.loads((ROOT / "config/licensing/product-catalog.json").read_text(encoding="utf-8"))
        plan_ids = [plan["id"] for plan in catalog["plans"]]
        self.assertEqual(plan_ids, ["developer", "pro", "team", "enterprise"])
        self.assertNotIn("free", plan_ids)
        self.assertNotIn("community", plan_ids)

        checklist = json.loads((ROOT / "blueprints/commercial/production-launch-checklist.json").read_text(encoding="utf-8"))
        self.assertFalse(checklist["launch_authorized"])
        publication = checklist["recommended_publication_path"]
        self.assertEqual(publication["strategy"], "free_first_then_paid")
        self.assertEqual(publication["reference"], "blueprints/commercial/marketplace-staged-launch.json")
        self.assertTrue(publication["operator_override_allowed"])
        gate_ids = {gate["id"] for gate in checklist["required_gates"]}
        self.assertTrue(
            {"github_marketplace_app", "github_vendor_app", "github_app_role_separation", "vendor_app_installation"}.issubset(gate_ids)
        )
        self.assertNotIn("github_app", gate_ids)
        self.assertNotIn("app_installation", gate_ids)


if __name__ == "__main__":
    unittest.main()

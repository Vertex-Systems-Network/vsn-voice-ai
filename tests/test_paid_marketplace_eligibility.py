from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PaidMarketplaceEligibilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/licensing/paid-marketplace-eligibility.json").read_text(encoding="utf-8"))

    def test_current_requirements_snapshot_is_explicit(self) -> None:
        snapshot = self.data["requirements_snapshot"]
        self.assertEqual(snapshot["verified_on"], "2026-09-05")
        self.assertEqual(snapshot["github_app_minimum_installations_for_paid_listing"], 100)
        self.assertTrue(snapshot["organization_owned_app_required"])
        self.assertTrue(snapshot["verified_publisher_required"])
        self.assertTrue(snapshot["financial_onboarding_required"])
        self.assertTrue(snapshot["monthly_and_annual_paid_billing_required"])
        self.assertTrue(snapshot["reverify_immediately_before_paid_submission"])

    def test_requirements_are_not_confused_with_real_eligibility(self) -> None:
        evidence = self.data["external_eligibility_evidence"]
        self.assertIsNone(evidence["genuine_installation_count"])
        self.assertFalse(evidence["organization_verified_publisher"])
        self.assertFalse(evidence["financial_onboarding_complete"])
        self.assertFalse(evidence["real_paid_plan_ids_configured"])
        self.assertFalse(evidence["paid_purchase_change_cancel_trial_e2e_verified"])
        self.assertFalse(self.data["activation_gate"]["paid_marketplace_eligible"])

    def test_paid_lifecycle_scope_is_complete(self) -> None:
        lifecycle = set(self.data["requirements_snapshot"]["marketplace_purchase_lifecycle_required"])
        self.assertEqual(lifecycle, {"purchase", "upgrade", "downgrade", "cancellation", "free_trial_when_offered"})


if __name__ == "__main__":
    unittest.main()

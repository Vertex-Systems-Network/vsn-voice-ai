from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PricingPlanActivationEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/licensing/pricing-plan-activation-evidence.json").read_text(encoding="utf-8"))

    def test_live_pricing_and_plan_ids_are_not_invented(self) -> None:
        self.assertEqual(set(self.data["plans"]), {"developer", "pro", "team", "enterprise"})
        for plan in self.data["plans"].values():
            self.assertIsNone(plan["marketplace_plan_id"])
            self.assertIsNone(plan["monthly_price_usd"])
            self.assertIsNone(plan["annual_price_usd"])
            self.assertFalse(plan["operator_approved"])

    def test_paid_activation_is_fail_closed(self) -> None:
        gate = self.data["activation_gate"]
        self.assertFalse(gate["pricing_and_plan_ids_complete"])
        self.assertFalse(gate["paid_listing_eligible"])
        self.assertFalse(gate["paid_activation_authorized"])
        self.assertEqual(self.data["paid_eligibility_authority"], "config/licensing/paid-marketplace-eligibility.json")

    def test_documentation_exists(self) -> None:
        self.assertTrue((ROOT / "docs/commercial/pricing-plan-activation-evidence.md").exists())


if __name__ == "__main__":
    unittest.main()

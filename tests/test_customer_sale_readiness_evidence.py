from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CustomerSaleReadinessEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/licensing/customer-sale-readiness-evidence.json").read_text(encoding="utf-8"))

    def test_every_customer_journey_step_starts_pending(self) -> None:
        expected = {
            "marketplace_purchase_event", "billing_reconciliation", "customer_authentication",
            "entitlement_issue_or_refresh", "archive_or_template_delivery", "customer_install_and_verify",
            "update_channel_access", "cancellation_non_destructive",
        }
        self.assertEqual(set(self.data["journey"]), expected)
        for step in self.data["journey"].values():
            self.assertEqual(step["status"], "pending")
            self.assertIsNone(step["evidence_reference"])

    def test_sale_readiness_remains_fail_closed(self) -> None:
        gate = self.data["sale_readiness_gate"]
        self.assertFalse(gate["self_service_onboarding_verified"])
        self.assertFalse(gate["purchase_to_delivery_verified"])
        self.assertFalse(gate["support_boundary_verified"])
        self.assertFalse(gate["sale_ready"])
        self.assertEqual(self.data["support_boundary_authority"], "config/licensing/customer-onboarding-support.json")

    def test_documentation_exists(self) -> None:
        self.assertTrue((ROOT / "docs/commercial/customer-sale-readiness-evidence.md").exists())


if __name__ == "__main__":
    unittest.main()

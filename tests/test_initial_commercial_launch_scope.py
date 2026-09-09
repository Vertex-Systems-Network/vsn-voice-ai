from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class InitialCommercialLaunchScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/licensing/initial-commercial-launch-scope.json").read_text(encoding="utf-8"))

    def test_initial_sequence_is_community_then_developer(self) -> None:
        self.assertEqual(self.data["strategy"], "community_free_then_developer_paid")
        initial = self.data["initial_launch"]
        self.assertEqual(set(initial), {"community", "developer"})
        self.assertEqual(initial["community"]["price_usd"], 0)
        self.assertTrue(initial["developer"]["requires_paid_marketplace_eligibility"])
        self.assertTrue(initial["developer"]["requires_verified_private_release_delivery"])
        self.assertTrue(initial["developer"]["requires_legal_sale_approval"])

    def test_higher_tiers_do_not_block_initial_launch_but_remain_inactive(self) -> None:
        deferred = self.data["deferred_tiers"]
        self.assertEqual(set(deferred), {"pro", "team", "enterprise"})
        self.assertEqual(deferred["pro"]["commercial_state"], "deferred_not_initial_sale_scope")
        self.assertEqual(deferred["team"]["commercial_state"], "deferred_not_initial_sale_scope")
        self.assertEqual(deferred["enterprise"]["commercial_state"], "external_contract_only_until_productized")
        gate = self.data["launch_gate"]
        self.assertFalse(gate["community_launch_authorized"])
        self.assertFalse(gate["developer_paid_sale_authorized"])
        self.assertFalse(gate["pro_sale_authorized"])
        self.assertFalse(gate["team_sale_authorized"])
        self.assertFalse(gate["enterprise_self_serve_sale_authorized"])

    def test_documentation_exists(self) -> None:
        self.assertTrue((ROOT / "docs/commercial/initial-commercial-launch-scope.md").exists())


if __name__ == "__main__":
    unittest.main()

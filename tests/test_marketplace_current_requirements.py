from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MarketplaceCurrentRequirementsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads(
            (ROOT / "blueprints/commercial/github-marketplace-compliance.json").read_text(encoding="utf-8")
        )

    def test_current_requirements_reverification_is_recorded(self) -> None:
        self.assertEqual(self.data["source_reverified_at"], "2026-09-06")
        self.assertGreaterEqual(len(self.data["official_sources"]), 6)
        self.assertTrue(all(url.startswith("https://docs.github.com/") for url in self.data["official_sources"]))

    def test_free_and_paid_marketplace_event_baselines_are_explicit(self) -> None:
        events = self.data["marketplace_events"]
        self.assertTrue({"purchased", "cancelled"}.issubset(set(events["required_actions_for_all_plans"])))
        self.assertTrue({"purchased", "changed", "cancelled"}.issubset(set(events["required_actions_for_paid_plans"])))


if __name__ == "__main__":
    unittest.main()

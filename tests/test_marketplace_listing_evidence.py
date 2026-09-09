from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MarketplaceListingEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/licensing/marketplace-listing-evidence.json").read_text(encoding="utf-8"))

    def test_listing_evidence_is_separate_from_requirements_blueprint(self) -> None:
        self.assertIn(
            self.data["status"],
            {"pending_external_assets_and_urls", "partially_verified_external_evidence"},
        )
        self.assertEqual(
            self.data["requirements_authority"],
            "blueprints/commercial/github-marketplace-compliance.json",
        )

    def test_external_evidence_is_explicit_and_fail_closed(self) -> None:
        items = self.data["evidence_items"]
        expected = {
            "homepage", "privacy_policy", "support", "terms", "publisher_contact",
            "logo", "feature_card", "screenshots", "public_app_installability", "marketplace_webhook",
        }
        self.assertEqual(set(items), expected)
        self.assertTrue(all(row["status"] in {"pending", "verified"} for row in items.values()))

        for key in ("homepage", "privacy_policy", "support", "terms", "publisher_contact", "public_app_installability", "marketplace_webhook"):
            row = items[key]
            if row["status"] == "verified":
                self.assertIsNotNone(row.get("verified_at"), key)

        if items["homepage"]["status"] == "verified":
            self.assertTrue(items["homepage"]["url"].startswith("https://"))
        if items["privacy_policy"]["status"] == "verified":
            self.assertTrue(items["privacy_policy"]["url"].startswith("https://"))
        if items["support"]["status"] == "verified":
            self.assertTrue(items["support"]["url_or_email"])
        if items["publisher_contact"]["status"] == "verified":
            self.assertTrue(items["publisher_contact"]["evidence_reference"])
        if items["public_app_installability"]["status"] == "verified":
            self.assertTrue(items["public_app_installability"]["evidence_reference"])
        if items["marketplace_webhook"]["status"] == "verified":
            self.assertTrue(items["marketplace_webhook"]["evidence_reference"])

    def test_listing_cannot_be_claimed_ready_while_any_required_evidence_is_pending(self) -> None:
        gate = self.data["submission_gate"]
        items = self.data["evidence_items"]
        all_verified = all(row["status"] == "verified" for row in items.values())
        self.assertEqual(gate["listing_evidence_complete"], all_verified)
        self.assertFalse(gate["listing_evidence_complete"])
        self.assertTrue(any(row["status"] == "pending" for row in items.values()))
        evidence_only = json.dumps(items).lower()
        self.assertNotIn("example.com", evidence_only)


if __name__ == "__main__":
    unittest.main()

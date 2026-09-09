from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CommercialArtifactFreshnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/release/commercial-artifact-freshness.json").read_text(encoding="utf-8"))

    def test_freshness_is_fail_closed_after_source_changes(self) -> None:
        self.assertEqual(self.data["status"], "regeneration_required_after_canonical_changes")
        self.assertFalse(self.data["freshness_gate"]["artifact_freshness_verified"])
        evidence = self.data["required_evidence"]
        for key, value in evidence.items():
            if isinstance(value, bool):
                self.assertFalse(value, key)
            else:
                self.assertIsNone(value, key)

    def test_exact_canonical_identity_is_required(self) -> None:
        text = (self.data["invalidation_rule"] + " " + self.data["freshness_gate"]["rule"]).lower()
        self.assertIn("canonical", text)
        self.assertIn("revision", text)
        self.assertIn("tree", text)
        self.assertIn("exact", text)

    def test_operator_and_vendor_outputs_are_all_bound(self) -> None:
        evidence = self.data["required_evidence"]
        for key in [
            "service_export_receipt_sha256",
            "template_export_receipt_sha256",
            "operator_bootstrap_artifact_digest",
            "service_artifact_reference",
            "template_artifact_reference",
            "operator_artifact_reference",
        ]:
            self.assertIn(key, evidence)
        self.assertTrue((ROOT / "docs/commercial/artifact-freshness-evidence.md").exists())


if __name__ == "__main__":
    unittest.main()

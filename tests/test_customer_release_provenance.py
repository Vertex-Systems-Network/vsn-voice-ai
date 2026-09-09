from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CustomerReleaseProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/release/customer-release-provenance.json").read_text(encoding="utf-8"))
        self.package = json.loads((ROOT / "commercial-service/package.json").read_text(encoding="utf-8"))
        self.protocol = json.loads((ROOT / "config/protocol/version.json").read_text(encoding="utf-8"))

    def test_expected_release_identity_matches_source(self) -> None:
        expected = self.data["expected_identity"]
        self.assertEqual(expected["service_version"], self.package["version"])
        self.assertEqual(expected["protocol_version"], self.protocol["version"])
        self.assertEqual(expected["runtime_contract"], self.package["anpos"]["runtime_contract"])

    def test_release_artifact_provenance_is_not_invented(self) -> None:
        artifact = self.data["release_artifact"]
        for key in [
            "canonical_source_revision", "canonical_source_tree", "artifact_reference",
            "artifact_sha256", "vendor_handoff_receipt_sha256", "published_release_reference",
        ]:
            self.assertIsNone(artifact[key])
        self.assertFalse(artifact["verified"])

    def test_customer_release_note_is_draft_until_provenance_exists(self) -> None:
        notes = self.data["customer_notes"]
        self.assertEqual(notes["draft_path"], "docs/releases/ANPOS-1.3.13-commercial-0.3.9.md")
        self.assertTrue((ROOT / notes["draft_path"]).exists())
        self.assertFalse(notes["customer_visible_release_notes_verified"])
        gate = self.data["release_gate"]
        self.assertFalse(gate["version_provenance_verified"])
        self.assertFalse(gate["customer_release_publication_authorized"])
        self.assertTrue((ROOT / "docs/commercial/customer-release-provenance.md").exists())


if __name__ == "__main__":
    unittest.main()

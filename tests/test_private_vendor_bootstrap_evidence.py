from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PrivateVendorBootstrapEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/release/private-vendor-bootstrap-evidence.json").read_text(encoding="utf-8"))

    def test_expected_private_repositories_are_named_but_not_claimed(self) -> None:
        repos = self.data["repositories"]
        self.assertEqual(repos["commercial_service"]["expected_full_name"], "Vertex-Systems-Network/anpos-commercial-service")
        self.assertEqual(repos["customer_template"]["expected_full_name"], "Vertex-Systems-Network/anpos-commercial-template")
        for repo in repos.values():
            self.assertFalse(repo["existence_verified"])
            self.assertFalse(repo["private_visibility_verified"])
            self.assertIsNone(repo["default_branch"])
            self.assertIsNone(repo["head_revision"])
            self.assertIsNone(repo["head_tree"])
            self.assertIsNone(repo["handoff_receipt_sha256"])

    def test_vendor_source_of_record_is_fail_closed(self) -> None:
        gate = self.data["bootstrap_gate"]
        self.assertFalse(gate["both_repositories_verified_private"])
        self.assertFalse(gate["exact_handoff_verified"])
        self.assertFalse(gate["vendor_source_of_record_ready"])
        self.assertTrue((ROOT / "docs/commercial/private-vendor-bootstrap-evidence.md").exists())


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LegalDocumentEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/licensing/legal-document-evidence.json").read_text(encoding="utf-8"))

    def test_legal_evidence_extends_existing_approval_authority(self) -> None:
        self.assertEqual(self.data["status"], "pending_operator_and_counsel_evidence")
        self.assertEqual(self.data["authority"], "config/licensing/legal-approval.json")

    def test_customer_documents_are_not_preapproved(self) -> None:
        expected = {
            "terms_of_service", "privacy_policy", "commercial_license_eula",
            "refund_cancellation_policy", "support_terms",
        }
        self.assertEqual(set(self.data["documents"]), expected)
        for document in self.data["documents"].values():
            self.assertFalse(document["approved"])
            self.assertIsNone(document["version"])
            self.assertIsNone(document["sha256"])
            self.assertIsNone(document["reviewed_by"])
            self.assertIsNone(document["reviewed_at"])

    def test_release_scope_and_activation_remain_pending(self) -> None:
        scope = self.data["approval_scope"]
        self.assertIsNone(scope["approved_release_version"])
        self.assertIsNone(scope["approved_protocol_version"])
        self.assertIsNone(scope["operator_approval_reference"])
        self.assertIsNone(scope["counsel_review_reference"])
        self.assertFalse(self.data["activation_gate"]["legal_evidence_complete"])


if __name__ == "__main__":
    unittest.main()

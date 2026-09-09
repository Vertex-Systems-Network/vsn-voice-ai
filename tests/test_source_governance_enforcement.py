from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SourceGovernanceEnforcementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/github/source-enforcement-evidence.json").read_text(encoding="utf-8"))

    def test_source_enforcement_contract_targets_canonical_main(self) -> None:
        self.assertEqual(self.data["status"], "pending_external_enforcement")
        self.assertEqual(self.data["repository"], "Vertex-Systems-Network/ai-native-project-operating-system")
        self.assertEqual(self.data["default_branch"], "main")
        certification = self.data["required_source_certification"]
        self.assertEqual(certification["workflow"], "ANPOS Source Continuous Certification")
        self.assertEqual(certification["job"], "source-certification")
        self.assertTrue(certification["must_pass_before_merge"])

    def test_server_side_evidence_is_not_invented(self) -> None:
        evidence = self.data["external_evidence"]
        self.assertFalse(evidence["branch_protection_verified"])
        self.assertFalse(evidence["ruleset_verified"])
        self.assertFalse(evidence["required_check_enforced_server_side"])
        self.assertIsNone(evidence["verified_at"])
        self.assertIsNone(evidence["verified_by"])
        self.assertIsNone(evidence["evidence_reference"])
        self.assertFalse(self.data["launch_gate"]["source_governance_enforced"])

    def test_required_server_side_controls_are_explicit(self) -> None:
        controls = self.data["required_server_side_controls"]
        for key in [
            "pull_request_required",
            "required_status_check",
            "block_force_push",
            "block_branch_deletion",
            "require_conversation_resolution",
        ]:
            self.assertTrue(controls[key])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ProductionSmokeRollbackEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "config/release/production-smoke-rollback-evidence.json").read_text(encoding="utf-8"))
        self.package = json.loads((ROOT / "commercial-service/package.json").read_text(encoding="utf-8"))
        self.protocol = json.loads((ROOT / "config/protocol/version.json").read_text(encoding="utf-8"))

    def test_expected_identity_tracks_current_source_identity(self) -> None:
        expected = self.data["expected_identity"]
        self.assertEqual(expected["service_version"], self.package["version"])
        self.assertEqual(expected["protocol_version"], self.protocol["version"])
        self.assertEqual(expected["runtime_contract"], self.package["anpos"]["runtime_contract"])

    def test_production_evidence_is_not_invented(self) -> None:
        observed = self.data["observed_production"]
        self.assertIsNone(observed["deployment_revision"])
        self.assertIsNone(observed["deployment_tree"])
        for key, value in observed.items():
            if isinstance(value, bool):
                self.assertFalse(value, key)
        recovery = self.data["recovery"]
        self.assertFalse(recovery["rollback_procedure_verified"])
        self.assertFalse(recovery["restore_test_verified"])
        self.assertIsNone(recovery["backup_evidence_reference"])
        self.assertIsNone(recovery["rpo_minutes"])
        self.assertIsNone(recovery["rto_minutes"])

    def test_launch_gate_is_fail_closed(self) -> None:
        gate = self.data["production_gate"]
        self.assertFalse(gate["exact_identity_verified"])
        self.assertFalse(gate["smoke_verified"])
        self.assertFalse(gate["rollback_and_restore_verified"])
        self.assertFalse(gate["production_ready"])
        self.assertTrue((ROOT / "docs/commercial/production-smoke-rollback-evidence.md").exists())


if __name__ == "__main__":
    unittest.main()

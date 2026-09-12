import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "claim_slot", ROOT / "scripts" / "claim_slot.py"
)
assert SPEC is not None and SPEC.loader is not None
claim_slot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(claim_slot)


class DependencyReadyTests(unittest.TestCase):
    def test_no_dependencies_is_ready(self) -> None:
        self.assertTrue(claim_slot.dependency_ready({"dependencies": []}, []))

    def test_slot_dependency_requires_exact_completed_slot(self) -> None:
        slots = [
            {"id": "SLOT-001", "work_unit_id": "WU-002", "status": "completed"},
            {"id": "SLOT-099", "work_unit_id": "WU-002", "status": "completed"},
        ]
        self.assertTrue(
            claim_slot.dependency_ready({"dependencies": ["SLOT-001"]}, slots)
        )
        self.assertFalse(
            claim_slot.dependency_ready({"dependencies": ["SLOT-002"]}, slots)
        )

    def test_work_unit_dependency_accepts_terminal_work_unit_evidence(self) -> None:
        slots = [
            {"id": "SLOT-010", "work_unit_id": "WU-014", "status": "merged"}
        ]
        self.assertTrue(
            claim_slot.dependency_ready({"dependencies": ["WU-014"]}, slots)
        )

    def test_nonterminal_dependency_is_not_ready(self) -> None:
        slots = [
            {"id": "SLOT-001", "work_unit_id": "WU-002", "status": "approved"}
        ]
        self.assertFalse(
            claim_slot.dependency_ready({"dependencies": ["SLOT-001"]}, slots)
        )
        self.assertFalse(
            claim_slot.dependency_ready({"dependencies": ["WU-002"]}, slots)
        )

    def test_unknown_dependency_namespace_fails_closed(self) -> None:
        slots = [
            {"id": "SLOT-001", "work_unit_id": "WU-002", "status": "completed"}
        ]
        self.assertFalse(
            claim_slot.dependency_ready({"dependencies": ["MOD-002"]}, slots)
        )


if __name__ == "__main__":
    unittest.main()

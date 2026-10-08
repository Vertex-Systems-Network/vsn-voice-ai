"""Regression tests for bounded, authenticated, no-routine-choice continuation."""
import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts/continuity_supervisor.py"
spec = importlib.util.spec_from_file_location("continuity_supervisor", MODULE)
continuity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(continuity)

MAIN = "a" * 40


def work(item_id, kind="work_unit", **fields):
    item = dict(id=item_id, kind=kind, status="ready", phase=1,
                priority=10, scope="ordinary_development")
    item.update(fields)
    return item


class FakeHost:
    def __init__(self):
        self.rev = 1
        self.finished = set()
        self.calls = []
        self.valid_identity = True
        self.checkpoint_ok = True
        self.receipt_verified = True
        self.items = [
            work("PR-131", kind="accepted_pr",
                 independent_review_required=True,
                 independent_review_approved=False),
            work("WU-002", external_blocker="Issue #110 hardware acceptance"),
            work("WU-014", priority=1),
            work("WU-016", priority=2),
        ]

    def authority(self):
        return {
            "authenticated": self.valid_identity,
            "lease_current": True,
            "principal": "verified-host-test-fixture",
            "epoch": 7,
            "fencing_token": "test-fence",
            "scopes": ["ordinary_development"],
        }

    def snapshot(self):
        return {"revision": str(self.rev), "main_sha": MAIN,
                "items": self.items, "completed": list(self.finished)}

    def execute(self, item, revision, fence):
        self.calls.append(item["id"])
        return {"item_id": item["id"], "source_sha": MAIN,
                "verified": self.receipt_verified, "evidence_ref": "fixture:receipt"}

    def checkpoint(self, receipt, revision, fence):
        if not self.checkpoint_ok or revision != str(self.rev) or fence != "test-fence":
            return False
        self.rev += 1
        self.finished.add(receipt["item_id"])
        return True


class ContinuityTests(unittest.TestCase):
    def test_two_independent_milestones_without_asking_for_continue(self):
        host = FakeHost()
        done = continuity.run_continuation(host, max_milestones=8)
        self.assertEqual(done, ["WU-014", "WU-016"])
        self.assertEqual(host.calls, done)
        self.assertNotIn("PR-131", done)
        self.assertNotIn("WU-002", done)

    def test_resume_skips_checkpointed_work(self):
        host = FakeHost()
        self.assertEqual(continuity.run_continuation(host, 1), ["WU-014"])
        self.assertEqual(continuity.run_continuation(host, 8), ["WU-016"])

    def test_dependency_and_review_gates(self):
        host = FakeHost()
        host.items.append(work("WU-020", dependencies=["WU-014"], priority=0))
        selected = continuity.choose(host.items, set(), {"ordinary_development"})
        self.assertEqual(selected["id"], "WU-014")
        selected_after = continuity.choose(host.items, {"WU-014"}, {"ordinary_development"})
        self.assertEqual(selected_after["id"], "WU-020")

    def test_unverified_supervisor_identity_fails_closed(self):
        host = FakeHost()
        host.valid_identity = False
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, [])

    def test_missing_cas_checkpoint_does_not_continue(self):
        host = FakeHost()
        host.checkpoint_ok = False
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, ["WU-014"])

    def test_fabricated_work_receipt_does_not_count(self):
        host = FakeHost()
        host.receipt_verified = False
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.finished, set())

    def test_invocation_budget_is_bounded(self):
        host = FakeHost()
        self.assertEqual(continuity.run_continuation(host, 1), ["WU-014"])
        with self.assertRaises(ValueError):
            continuity.run_continuation(host, 0)


if __name__ == "__main__":
    unittest.main()

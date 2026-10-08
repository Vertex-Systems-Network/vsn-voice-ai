"""Deterministic contract tests for a bounded continuation host, not live-agent proof."""
import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts/continuity_supervisor.py"
spec = importlib.util.spec_from_file_location("continuity_supervisor", MODULE)
continuity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(continuity)

MAIN = "a" * 40


def work(item_id, kind="work_unit", **fields):
    item = {"id": item_id, "kind": kind, "status": "ready",
            "phase": 1, "priority": 10, "scope": "ordinary_development"}
    item.update(fields)
    return item


class FakeHost:
    def __init__(self):
        self.rev = 1
        self.finished = set()
        self.calls = []
        self.repairs = []
        self.verified = True
        self.authenticated = True
        self.lease_current = True
        self.identity_verified = True
        self.epoch = 7
        self.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        self.scopes = ["ordinary_development"]
        self.checkpoint_ok = True
        self.receipt_verified = True
        self.receipt_sha = MAIN
        self.transient = {}
        self.blocked = set()
        self.mutate_lease_during_execute = False
        self.mutate_source_during_execute = False
        self.items = [
            work("PR-131", kind="accepted_pr", independent_review_required=True,
                 independent_review_approved=False),
            work("WU-002", external_blocker="Issue #110 Windows acceptance"),
            work("WU-014", priority=1),
            work("WU-016", priority=2),
        ]

    def authority(self):
        return {
            "authenticated": self.authenticated,
            "identity_verified": self.identity_verified,
            "lease_current": self.lease_current,
            "principal": "verified-test-fixture",
            "epoch": self.epoch,
            "expires_at": self.expires_at.isoformat(),
            "fencing_token": "test-fence",
            "scopes": self.scopes,
        }

    def snapshot(self):
        return {"revision": str(self.rev), "main_sha": MAIN,
                "items": self.items, "completed": list(self.finished)}

    def execute(self, item, revision, fence):
        self.calls.append(item["id"])
        if self.mutate_lease_during_execute:
            self.epoch += 1
        if self.mutate_source_during_execute:
            self.rev += 1
        if item["id"] in self.blocked:
            raise continuity.BlockedWorkError("external gate")
        if self.transient.get(item["id"], 0) > 0:
            self.transient[item["id"]] -= 1
            raise continuity.RetryableWorkError("ordinary repairable test failure")
        return {"item_id": item["id"], "source_sha": self.receipt_sha,
                "verified": self.receipt_verified, "evidence_ref": "fixture:receipt"}

    def repair(self, item, revision, fence):
        self.repairs.append(item["id"])

    def checkpoint(self, receipt, revision, fence):
        if not self.checkpoint_ok or revision != str(self.rev) or fence != "test-fence":
            return False
        self.rev += 1
        self.finished.add(receipt["item_id"])
        return True


class ContinuityTests(unittest.TestCase):
    def test_two_milestones_without_routine_continue_prompt(self):
        host = FakeHost()
        self.assertEqual(continuity.run_continuation(host), ["WU-014", "WU-016"])
        self.assertEqual(host.calls, ["WU-014", "WU-016"])

    def test_resume_from_exact_durable_checkpoint(self):
        host = FakeHost()
        self.assertEqual(continuity.run_continuation(host, 1), ["WU-014"])
        self.assertEqual(continuity.run_continuation(host, 8), ["WU-016"])

    def test_blocked_work_does_not_block_safe_lane(self):
        host = FakeHost()
        host.blocked.add("WU-014")
        self.assertEqual(continuity.run_continuation(host), ["WU-016"])

    def test_current_phase_and_dependency_precedence(self):
        host = FakeHost()
        host.items.append(work("WU-020", dependencies=["WU-014"], priority=0))
        self.assertEqual(continuity.choose(host.items, set(), {"ordinary_development"})["id"], "WU-014")
        self.assertEqual(continuity.choose(host.items, {"WU-014"}, {"ordinary_development"})["id"], "WU-020")

    def test_retryable_failure_repairs_without_owner_input(self):
        host = FakeHost()
        host.transient["WU-014"] = 1
        self.assertEqual(continuity.run_continuation(host), ["WU-014", "WU-016"])
        self.assertEqual(host.repairs, ["WU-014"])
        self.assertEqual(host.calls.count("WU-014"), 2)

    def test_repair_rejects_revoked_epoch_before_mutating(self):
        host = FakeHost()
        host.transient["WU-014"] = 1
        host.mutate_lease_during_execute = True
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.repairs, [])

    def test_repair_rejects_source_drift_before_mutating(self):
        host = FakeHost()
        host.transient["WU-014"] = 1
        host.mutate_source_during_execute = True
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.repairs, [])

    def test_exhausted_retry_budget_isolated_from_other_work(self):
        host = FakeHost()
        host.transient["WU-014"] = 5
        self.assertEqual(continuity.run_continuation(host, max_retries_per_item=2), ["WU-016"])
        self.assertEqual(host.calls.count("WU-014"), 3)
        self.assertEqual(host.repairs.count("WU-014"), 2)

    def test_invalid_identity_fails_closed(self):
        host = FakeHost()
        host.identity_verified = False
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, [])

    def test_expired_lease_fails_closed(self):
        host = FakeHost()
        host.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, [])

    def test_changed_epoch_during_execution_fails_closed(self):
        host = FakeHost()
        host.mutate_lease_during_execute = True
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.finished, set())

    def test_source_revision_drift_fails_closed(self):
        host = FakeHost()
        host.mutate_source_during_execute = True
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.finished, set())

    def test_invalid_cas_checkpoint_fails_closed(self):
        host = FakeHost()
        host.checkpoint_ok = False
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, ["WU-014"])

    def test_fabricated_or_wrong_source_receipts_are_rejected(self):
        for key, value in [("receipt_verified", False), ("receipt_sha", "b" * 40)]:
            with self.subTest(key=key):
                host = FakeHost()
                setattr(host, key, value)
                with self.assertRaises(continuity.ContinuationSafetyError):
                    continuity.run_continuation(host)
                self.assertFalse(host.finished)

    def test_duplicate_work_and_invalid_sha_rejected(self):
        host = FakeHost()
        host.items.append(dict(host.items[-1]))
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        host = FakeHost()
        host.snapshot = lambda: {"revision": "1", "main_sha": "not-verified",
                                 "items": host.items, "completed": []}
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)

    def test_hard_work_and_retry_budgets(self):
        host = FakeHost()
        self.assertEqual(continuity.run_continuation(host, max_milestones=1), ["WU-014"])
        for bad in (0, 33, True):
            with self.assertRaises(ValueError):
                continuity.run_continuation(host, max_milestones=bad)
        with self.assertRaises(ValueError):
            continuity.run_continuation(host, max_retries_per_item=4)


if __name__ == "__main__":
    unittest.main()

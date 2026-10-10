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
        self.milestone_receipts = {}
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
        self.persist_receipt = True
        self.corrupt_persisted_receipt = False
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
                "items": self.items, "completed": list(self.finished),
                "milestone_receipts": dict(self.milestone_receipts)}

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
        # Receipt state is NOT work-unit completion state.
        if self.persist_receipt:
            evidence = receipt["evidence_ref"]
            if self.corrupt_persisted_receipt:
                evidence = "fixture:wrong-evidence"
            self.milestone_receipts[receipt["item_id"]] = {
                "source_sha": receipt["source_sha"],
                "evidence_ref": evidence,
            }
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

    def test_external_authorization_gates_never_become_routine_owner_prompts(self):
        gate_fields = [
            ("human_consent_required", "human_consent_verified", "human_consent_evidence_ref"),
            ("external_acceptance_required", "external_acceptance_verified", "external_acceptance_evidence_ref"),
            ("paid_resource_required", "budget_authorized", "budget_authorization_evidence_ref"),
            ("production_release_required", "release_authorized", "release_authorization_evidence_ref"),
        ]
        for required, verified, evidence in gate_fields:
            with self.subTest(gate=required):
                host = FakeHost()
                host.items.append(work("WU-EXTERNAL", phase=0, priority=0, **{required: True}))
                self.assertEqual(continuity.run_continuation(host), ["WU-014", "WU-016"])
                self.assertNotIn("WU-EXTERNAL", host.calls)

                # A boolean alone or a blank evidence marker cannot grant a
                # new privileged action. Real hosts verify references.
                host.items[-1][verified] = True
                self.assertEqual(
                    continuity.choose(host.items, set(), set(host.scopes))["id"], "WU-014"
                )
                host.items[-1][evidence] = " "
                self.assertEqual(
                    continuity.choose(host.items, set(), set(host.scopes))["id"], "WU-014"
                )
                host.items[-1][evidence] = "verified-host:authorization/123"
                self.assertEqual(
                    continuity.choose(host.items, set(), set(host.scopes))["id"], "WU-EXTERNAL"
                )

    def test_multiple_external_gates_require_independent_evidence(self):
        host = FakeHost()
        external = work(
            "WU-EXTERNAL", phase=0, priority=0,
            human_consent_required=True,
            human_consent_verified=True,
            human_consent_evidence_ref="consent:approved/123",
            production_release_required=True,
        )
        host.items.append(external)
        self.assertEqual(
            continuity.choose(host.items, set(), set(host.scopes))["id"], "WU-014"
        )
        external["release_authorized"] = True
        external["release_authorization_evidence_ref"] = "release:verified/123"
        self.assertEqual(
            continuity.choose(host.items, set(), set(host.scopes))["id"], "WU-EXTERNAL"
        )

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

    def test_resume_deduplicates_receipts_without_completing_work_units(self):
        host = FakeHost()
        self.assertEqual(continuity.run_continuation(host, 1), ["WU-014"])
        self.assertEqual(host.finished, set())
        self.assertEqual(continuity.run_continuation(host, 8), ["WU-016"])
        self.assertEqual(host.calls.count("WU-014"), 1)
        self.assertEqual(set(host.milestone_receipts), {"WU-014", "WU-016"})

    def test_checkpoint_revision_without_persisted_receipt_is_rejected(self):
        host = FakeHost()
        host.persist_receipt = False
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, ["WU-014"])

    def test_mismatched_durable_receipt_is_rejected(self):
        host = FakeHost()
        host.corrupt_persisted_receipt = True
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, ["WU-014"])

    def test_malformed_durable_receipt_is_rejected_before_work(self):
        host = FakeHost()
        host.milestone_receipts["old-milestone"] = {"source_sha": "bad", "evidence_ref": ""}
        with self.assertRaises(continuity.ContinuationSafetyError):
            continuity.run_continuation(host)
        self.assertEqual(host.calls, [])

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
                                 "items": host.items, "completed": [], "milestone_receipts": {}}
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

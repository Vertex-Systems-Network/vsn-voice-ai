import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = (
    ROOT
    / "packages"
    / "contracts"
    / "schemas"
    / "routing-cost-reconciliation.schema.json"
)


class RoutingCostReconciliationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def consistent_payload(self) -> dict:
        return {
            "schema_version": 1,
            "status": "consistent",
            "total_issue_count": 0,
            "truncated": False,
            "issues": [],
        }

    def inconsistent_payload(self) -> dict:
        return {
            "schema_version": 1,
            "status": "inconsistent",
            "total_issue_count": 2,
            "truncated": False,
            "issues": [
                {
                    "code": "snapshot.selection_total_mismatch",
                    "expected": "18446744073709551615",
                    "observed": "18446744073709551614",
                },
                {
                    "code": "summary.provider_cost_rate_mismatch",
                    "provider_id": "provider-a",
                    "expected": "9223372036854775807",
                    "observed": "0",
                },
            ],
        }

    def test_consistent_and_inconsistent_payloads_are_valid(self) -> None:
        self.validator.validate(self.consistent_payload())
        self.validator.validate(self.inconsistent_payload())

    def test_truncated_payload_requires_full_retained_window_and_more_total_issues(self) -> None:
        payload = {
            "schema_version": 1,
            "status": "inconsistent",
            "total_issue_count": 300,
            "truncated": True,
            "issues": [
                {"code": "snapshot.provider_id_mismatch"}
                for _ in range(256)
            ],
        }
        self.validator.validate(payload)

        payload["total_issue_count"] = 256
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload["total_issue_count"] = 300
        payload["issues"].pop()
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_consistency_status_invariants_are_fail_closed(self) -> None:
        payload = self.consistent_payload()
        payload["total_issue_count"] = 1
        payload["issues"] = [{"code": "snapshot.cost_rate_invalid"}]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = self.inconsistent_payload()
        payload["total_issue_count"] = 0
        payload["issues"] = []
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_issue_codes_are_closed_to_current_reconciliation_surface(self) -> None:
        payload = self.inconsistent_payload()
        payload["issues"][0]["code"] = "summary.unreviewed_extension"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_expected_and_observed_values_remain_strings(self) -> None:
        payload = self.inconsistent_payload()
        payload["issues"][0]["expected"] = 18446744073709551615
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = self.inconsistent_payload()
        payload["issues"][0]["observed"] = -9223372036854775808
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_issue_count_and_retained_detail_are_bounded(self) -> None:
        payload = self.inconsistent_payload()
        payload["total_issue_count"] = 4294967296
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = self.inconsistent_payload()
        payload["total_issue_count"] = 257
        payload["issues"] = [
            {"code": "snapshot.provider_id_mismatch"}
            for _ in range(257)
        ]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_sensitive_or_unknown_fields_are_rejected_at_every_level(self) -> None:
        for field in (
            "audio",
            "transcript",
            "tenant_id",
            "credential",
            "request_payload",
            "payment_data",
        ):
            payload = self.inconsistent_payload()
            payload[field] = "must-not-cross-boundary"
            with self.subTest(level="top", field=field), self.assertRaises(
                ValidationError
            ):
                self.validator.validate(payload)

            payload = self.inconsistent_payload()
            payload["issues"][0][field] = "must-not-cross-boundary"
            with self.subTest(level="issue", field=field), self.assertRaises(
                ValidationError
            ):
                self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

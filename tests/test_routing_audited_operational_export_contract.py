import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "packages" / "contracts" / "schemas"


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


class RoutingAuditedOperationalExportContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.operational_schema = load_schema("routing-operational-export.schema.json")
        cls.reconciliation_schema = load_schema(
            "routing-cost-reconciliation.schema.json"
        )
        cls.schema = load_schema("routing-audited-operational-export.schema.json")
        for schema in (
            cls.operational_schema,
            cls.reconciliation_schema,
            cls.schema,
        ):
            Draft202012Validator.check_schema(schema)

        registry = Registry()
        registry = registry.with_resource(
            cls.operational_schema["$id"],
            Resource.from_contents(cls.operational_schema),
        )
        registry = registry.with_resource(
            cls.reconciliation_schema["$id"],
            Resource.from_contents(cls.reconciliation_schema),
        )
        cls.validator = Draft202012Validator(cls.schema, registry=registry)

    def valid_payload(self) -> dict:
        return {
            "schema_version": 1,
            "operational": {
                "schema_version": 1,
                "route_attempts": "18446744073709551615",
                "total_selections": "18446744073709551614",
                "no_eligible_count": "1",
                "warning_count": 0,
                "critical_count": 1,
                "cost_control": {
                    "total_selections": "18446744073709551614",
                    "no_eligible_count": "1",
                    "no_eligible_basis_points": 1,
                    "average_selected_cost_microunits_per_minute": "250",
                    "by_provider": [],
                },
                "alerts": [
                    {
                        "code": "routing.cost_reconciliation_inconsistent",
                        "severity": "critical",
                        "observed": "1",
                    }
                ],
            },
            "reconciliation": {
                "schema_version": 1,
                "status": "inconsistent",
                "total_issue_count": 1,
                "truncated": False,
                "issues": [
                    {
                        "code": "summary.average_cost_mismatch",
                        "expected": "250",
                        "observed": "251",
                    }
                ],
            },
        }

    def test_valid_audited_export(self) -> None:
        self.validator.validate(self.valid_payload())

    def test_unsafe_large_operational_integer_shape_is_rejected(self) -> None:
        payload = self.valid_payload()
        payload["operational"]["route_attempts"] = 18446744073709551615
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_unknown_billing_surface_is_rejected(self) -> None:
        payload = self.valid_payload()
        payload["billing"] = {"accrued_spend": "999"}
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_reconciliation_content_cannot_widen_with_request_data(self) -> None:
        payload = self.valid_payload()
        payload["reconciliation"]["issues"][0]["request_id"] = "req_sensitive"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

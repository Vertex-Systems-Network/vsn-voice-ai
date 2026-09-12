import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "packages" / "contracts" / "schemas" / "routing-operational-export.schema.json"


class RoutingOperationalExportContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def valid_payload(self) -> dict:
        return {
            "schema_version": 1,
            "route_attempts": "18446744073709551615",
            "total_selections": "18446744073709551614",
            "no_eligible_count": "1",
            "warning_count": 1,
            "critical_count": 1,
            "cost_control": {
                "total_selections": "18446744073709551614",
                "no_eligible_count": "1",
                "no_eligible_basis_points": 1,
                "average_selected_cost_microunits_per_minute": "9223372036854775807",
                "by_provider": [
                    {
                        "provider_id": "provider-a",
                        "selection_count": "18446744073709551614",
                        "selection_share_basis_points": 10000,
                        "cost_microunits_per_minute": "9223372036854775807",
                        "weighted_cost_contribution_microunits_per_minute": "9223372036854775807",
                        "latency_p95_ms": "275",
                        "health": "healthy",
                        "rate_limit": "available",
                    }
                ],
            },
            "alerts": [
                {
                    "code": "provider.cost_rate_invalid",
                    "severity": "critical",
                    "provider_id": "provider-b",
                    "observed": "-9223372036854775808",
                },
                {
                    "code": "provider.cost_rate_high",
                    "severity": "warning",
                    "observed": "9223372036854775807",
                    "threshold": "9223372036854775806",
                },
            ],
        }

    def test_precision_safe_payload_is_valid(self) -> None:
        self.validator.validate(self.valid_payload())

    def test_64_bit_values_cannot_cross_as_json_numbers(self) -> None:
        payload = self.valid_payload()
        payload["route_attempts"] = 18446744073709551615
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = self.valid_payload()
        payload["cost_control"]["by_provider"][0]["cost_microunits_per_minute"] = 9223372036854775807
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_decimal_strings_are_canonical(self) -> None:
        for invalid in ("01", "-0", "+1", "1.0", "1e3", ""):
            payload = self.valid_payload()
            payload["alerts"][0]["observed"] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_sensitive_or_unknown_fields_are_rejected(self) -> None:
        for field in ("audio", "transcript", "tenant_id", "credential", "request_payload", "payment_data"):
            payload = self.valid_payload()
            payload[field] = "must-not-cross-boundary"
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_state_and_basis_point_bounds_are_closed(self) -> None:
        payload = self.valid_payload()
        payload["cost_control"]["by_provider"][0]["health"] = "unknown-health"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = self.valid_payload()
        payload["cost_control"]["by_provider"][0]["selection_share_basis_points"] = 10001
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

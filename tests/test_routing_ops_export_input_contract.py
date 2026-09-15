import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "packages" / "contracts" / "schemas" / "routing-ops-export-input.schema.json"
FIXTURE = ROOT / "tests" / "fixtures" / "routing-ops-export-input.json"


class RoutingOpsExportInputContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_fixture_matches_closed_content_safe_contract(self) -> None:
        self.validator.validate(self.fixture)

    def test_unknown_sensitive_or_free_form_fields_are_rejected(self) -> None:
        for field, value in (
            ("tenant_id", "tenant_123"),
            ("transcript", "customer speech"),
            ("credential", "secret"),
            ("notes", "free-form text"),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload[field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_provider_identifiers_and_states_are_closed(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["metrics"]["by_provider"]["Customer Name / transcript"] = payload[
            "metrics"
        ]["by_provider"].pop("provider-a")
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["metrics"]["by_provider"]["provider-a"]["health"] = "unknown-health"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["reported_cost_control"]["by_provider"][0]["rate_limit"] = "blocked"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_operational_bounds_reject_negative_or_invalid_basis_points(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["metrics"]["by_provider"]["provider-a"]["cost_microunits_per_minute"] = -1
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["thresholds"]["max_no_eligible_basis_points"] = 10001
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["reported_cost_control"]["by_provider"][0][
            "selection_share_basis_points"
        ] = 10001
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_schema_version_is_required_and_locked(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload.pop("schema_version")
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["schema_version"] = 2
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

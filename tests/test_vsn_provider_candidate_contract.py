import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "packages" / "contracts" / "schemas" / "vsn-provider-candidate.schema.json"
FIXTURE = ROOT / "tests" / "fixtures" / "vsn-provider-candidate.json"


class VSNProviderCandidateContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_shared_disabled_candidate_fixture_is_valid(self) -> None:
        self.validator.validate(self.fixture)

    def test_activation_fields_are_schema_locked_fail_closed(self) -> None:
        for field, value in (
            ("enabled", True),
            ("verified_access", True),
            ("health", "healthy"),
            ("rate_limit", "available"),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload["provider_manifest"][field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_unverified_runtime_and_commercial_metadata_is_rejected(self) -> None:
        for field, value in (
            ("regions", ["us-east-1"]),
            ("retention_policy", "customer-defined"),
            ("latency_p95_ms", 50),
            ("quality_score", 90),
            ("privacy_score", 90),
            ("cost_microunits_per_minute", 10),
            ("remaining_quota_microunits", 1000),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload["provider_manifest"][field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_sensitive_or_delivery_fields_are_rejected(self) -> None:
        for field, value in (
            ("artifact_url", "https://example.invalid/model.onnx"),
            ("artifact_path", "C:\\models\\model.onnx"),
            ("credential", "secret"),
            ("tenant_id", "tenant_123"),
            ("notes", "free form"),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload[field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_schema_and_identifiers_are_bounded(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["schema_version"] = 2
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["provider_manifest"]["id"] = "Customer / transcript"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["artifact_sha256"] = "0" * 64
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_capabilities_and_access_mode_are_closed(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["provider_manifest"]["capabilities"] = ["voice.future_capability"]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["provider_manifest"]["access_mode"] = "unverified_mode"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

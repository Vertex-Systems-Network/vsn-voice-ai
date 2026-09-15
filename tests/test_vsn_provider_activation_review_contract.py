import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "packages" / "contracts" / "schemas" / "vsn-provider-activation-review.schema.json"
FIXTURE = ROOT / "tests" / "fixtures" / "vsn-provider-activation-review.json"


class VSNProviderActivationReviewContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_shared_fixture_is_valid_and_non_activating(self) -> None:
        self.validator.validate(self.fixture)
        self.assertFalse(self.fixture["activation_authorized"])
        self.assertFalse(self.fixture["candidate_state"]["enabled"])
        self.assertFalse(self.fixture["candidate_state"]["verified_access"])
        self.assertEqual(self.fixture["candidate_state"]["health"], "unhealthy")
        self.assertEqual(self.fixture["candidate_state"]["rate_limit"], "unknown")

    def test_activation_and_runtime_access_cannot_be_promoted(self) -> None:
        for field, value in (
            ("activation_authorized", True),
            ("enabled", True),
            ("verified_access", True),
            ("health", "healthy"),
            ("rate_limit", "available"),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                if field == "activation_authorized":
                    payload[field] = value
                else:
                    payload["candidate_state"][field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_evidence_refs_are_required_bounded_opaque_identifiers(self) -> None:
        for field in (
            "runtime_access",
            "artifact_signature",
            "release_provenance",
            "benchmark_policy",
            "rollback_readiness",
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                del payload["evidence_refs"][field]
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

                payload = copy.deepcopy(self.fixture)
                payload["evidence_refs"][field] = "https://example.invalid/evidence"
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_no_numeric_benchmark_thresholds_or_sensitive_content_fields_are_allowed(self) -> None:
        for field, value in (
            ("benchmark_threshold_ms", 50),
            ("dataset_path", "/research/data"),
            ("artifact_url", "https://example.invalid/model.onnx"),
            ("tenant_id", "tenant_123"),
            ("credential", "secret"),
            ("raw_audio", "base64-data"),
            ("transcript", "customer speech"),
            ("notes", "free form"),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload[field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_candidate_identity_fields_are_bounded(self) -> None:
        mutations = {
            "review_id": "review/unsafe",
            "verification_evidence_id": "https://example.invalid/model-evidence",
            "model_id": "customer/model",
            "model_version": "latest",
            "artifact_id": "/artifact/path",
            "artifact_sha256": "0" * 64,
            "provider_id": "Provider Runtime",
            "access_mode": "unknown",
        }
        for field, value in mutations.items():
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload[field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_capabilities_are_required_unique_and_normalized(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["capabilities"] = []
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["capabilities"] = [
            "voice.accent_convert",
            "voice.accent_convert",
        ]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["capabilities"] = ["custom.future.capability"]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

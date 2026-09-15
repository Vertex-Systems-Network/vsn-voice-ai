import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "packages" / "contracts" / "schemas" / "vsn-model-verification-evidence.schema.json"
FIXTURE = ROOT / "tests" / "fixtures" / "vsn-model-verification-evidence.json"


class VSNModelVerificationEvidenceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_shared_fixture_is_valid(self) -> None:
        self.validator.validate(self.fixture)

    def test_every_required_evidence_gate_is_mandatory(self) -> None:
        for field in (
            "dataset_provenance",
            "leakage_test",
            "model_regression",
            "benchmark",
            "security_review",
            "rollback",
            "artifact_integrity",
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                del payload["evidence_refs"][field]
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_content_paths_urls_credentials_and_activation_fields_are_rejected(self) -> None:
        for field, value in (
            ("artifact_url", "https://example.invalid/model.onnx"),
            ("artifact_path", "C:\\models\\model.onnx"),
            ("credential", "secret"),
            ("notes", "free form"),
            ("transcript", "customer speech"),
            ("enabled", True),
            ("routing_eligible", True),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload[field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_evidence_references_are_opaque_bounded_identifiers(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["evidence_refs"]["benchmark"] = "https://example.invalid/benchmark.json"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["evidence_refs"]["rollback"] = "C:\\evidence\\rollback.json"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["evidence_refs"]["dataset_provenance"] = []
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_dataset_and_evidence_reference_arrays_are_unique(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["dataset_registry_refs"].append(payload["dataset_registry_refs"][0])
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["evidence_refs"]["dataset_provenance"].append(
            payload["evidence_refs"]["dataset_provenance"][0]
        )
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_schema_identity_and_artifact_digest_are_locked(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["schema_version"] = 2
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["evidence_id"] = "unsafe evidence/id"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["artifact_sha256"] = "0" * 64
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

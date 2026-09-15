import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "packages" / "contracts" / "schemas" / "vsn-model-manifest.schema.json"


def registered_manifest() -> dict:
    return {
        "schema_version": 1,
        "model_id": "vsn-noise-foundation",
        "model_version": "0.1.0",
        "lifecycle_state": "verification_required",
        "capabilities": ["audio.noise_cancel", "audio.vad"],
        "artifact": {
            "artifact_id": "MODELART-NOISE-001",
            "format": "onnx",
            "sha256": "1" * 64,
        },
        "provenance": {
            "dataset_registry_refs": ["DATASET-SYNTHETIC-001"],
            "rights_review_status": "verification_required",
            "deletion_lineage_status": "verification_required",
        },
        "verification": {
            "artifact_integrity": "verification_required",
            "benchmark": "verification_required",
            "security_review": "verification_required",
            "rollback": "verification_required",
        },
    }


class VSNModelManifestContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_unverified_registration_metadata_is_valid(self) -> None:
        self.validator.validate(registered_manifest())

    def test_verified_state_requires_every_provenance_and_verification_gate(self) -> None:
        payload = registered_manifest()
        payload["lifecycle_state"] = "verified"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload["provenance"]["rights_review_status"] = "verified"
        payload["provenance"]["deletion_lineage_status"] = "verified"
        for key in payload["verification"]:
            payload["verification"][key] = "verified"
        self.validator.validate(payload)

    def test_verified_state_fails_closed_when_any_single_gate_regresses(self) -> None:
        payload = registered_manifest()
        payload["lifecycle_state"] = "verified"
        payload["provenance"]["rights_review_status"] = "verified"
        payload["provenance"]["deletion_lineage_status"] = "verified"
        for key in payload["verification"]:
            payload["verification"][key] = "verified"

        for section, field in (
            ("provenance", "rights_review_status"),
            ("provenance", "deletion_lineage_status"),
            ("verification", "artifact_integrity"),
            ("verification", "benchmark"),
            ("verification", "security_review"),
            ("verification", "rollback"),
        ):
            with self.subTest(section=section, field=field):
                invalid = copy.deepcopy(payload)
                invalid[section][field] = "verification_required"
                with self.assertRaises(ValidationError):
                    self.validator.validate(invalid)

    def test_contract_rejects_sensitive_content_paths_urls_and_activation_fields(self) -> None:
        for field, value in (
            ("tenant_id", "tenant_123"),
            ("transcript", "customer speech"),
            ("credential", "secret-value"),
            ("notes", "free form"),
            ("artifact_url", "https://example.invalid/model.onnx"),
            ("artifact_path", "C:\\models\\model.onnx"),
            ("enabled", True),
            ("routing_eligible", True),
            ("provider_id", "vsn-provider"),
        ):
            with self.subTest(field=field):
                payload = registered_manifest()
                payload[field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_artifact_metadata_is_closed_and_digest_is_non_placeholder(self) -> None:
        payload = registered_manifest()
        payload["artifact"]["path"] = "/models/model.onnx"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = registered_manifest()
        payload["artifact"]["sha256"] = "0" * 64
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = registered_manifest()
        payload["artifact"]["sha256"] = "A" * 64
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_capability_and_artifact_format_are_closed(self) -> None:
        payload = registered_manifest()
        payload["capabilities"] = ["voice.unapproved_future_capability"]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = registered_manifest()
        payload["artifact"]["format"] = "pickle"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_dataset_provenance_uses_opaque_registry_references_only(self) -> None:
        payload = registered_manifest()
        payload["provenance"]["dataset_registry_refs"] = [
            "s3://customer-production/audio"
        ]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = registered_manifest()
        payload["provenance"]["dataset_registry_refs"] = []
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_schema_version_and_identifiers_are_locked(self) -> None:
        payload = registered_manifest()
        payload["schema_version"] = 2
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = registered_manifest()
        payload["model_id"] = "Customer Model / secret"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

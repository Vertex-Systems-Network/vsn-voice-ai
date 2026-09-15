import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "packages" / "contracts" / "schemas" / "vsn-dataset-provenance.schema.json"
FIXTURE = ROOT / "tests" / "fixtures" / "vsn-dataset-provenance.json"


class VSNDatasetProvenanceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_shared_fixture_is_valid_and_excludes_customer_content(self) -> None:
        self.validator.validate(self.fixture)
        self.assertEqual(self.fixture["customer_content_policy"], "excluded")
        self.assertEqual(
            self.fixture["production_to_research_transfer_status"], "not_applicable"
        )
        self.assertNotIn("authorization_evidence_ref", self.fixture)

    def test_separately_authorized_customer_content_requires_authorization_and_verified_transfer(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["customer_content_policy"] = "separately_authorized"
        payload["production_to_research_transfer_status"] = "verification_required"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload["authorization_evidence_ref"] = "EVIDENCE-CUSTOMER-CONTENT-AUTH-1"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload["production_to_research_transfer_status"] = "verified"
        self.validator.validate(payload)

    def test_excluded_customer_content_rejects_authorization_reference_and_transfer_claim(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["authorization_evidence_ref"] = "EVIDENCE-UNNEEDED-AUTH-1"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["production_to_research_transfer_status"] = "verified"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_raw_content_locations_credentials_and_notes_are_rejected(self) -> None:
        for field, value in (
            ("dataset_url", "https://example.invalid/dataset"),
            ("dataset_path", "C:\\datasets\\voice"),
            ("raw_audio", "base64-data"),
            ("transcript", "customer speech"),
            ("credential", "secret"),
            ("notes", "free form"),
            ("tenant_id", "tenant_123"),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture)
                payload[field] = value
                with self.assertRaises(ValidationError):
                    self.validator.validate(payload)

    def test_data10_classification_and_storage_are_locked(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["classification"] = "confidential"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["storage_class"] = "production_database"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_provenance_and_lineage_refs_are_bounded_opaque_identifiers(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["source_provenance_refs"] = []
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["source_provenance_refs"] = ["https://example.invalid/provenance"]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["deletion_lineage_ref"] = "/research/deletion.json"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_dataset_identity_and_schema_version_are_locked(self) -> None:
        payload = copy.deepcopy(self.fixture)
        payload["schema_version"] = 2
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = copy.deepcopy(self.fixture)
        payload["dataset_id"] = "customer/audio/path"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "packages" / "contracts" / "schemas"


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


class WorkspaceBootstrapContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.authorization_schema = load_schema("authorization-context.schema.json")
        cls.schema = load_schema("workspace-bootstrap.schema.json")
        Draft202012Validator.check_schema(cls.authorization_schema)
        Draft202012Validator.check_schema(cls.schema)

        registry = Registry().with_resource(
            cls.authorization_schema["$id"],
            Resource.from_contents(cls.authorization_schema),
        )
        cls.validator = Draft202012Validator(cls.schema, registry=registry)

    def valid_payload(self) -> dict:
        unloaded = {"status": "unloaded", "items": []}
        return {
            "schema_version": 1,
            "authorization": {
                "schema_version": 1,
                "subject_id": "user_123",
                "organization_id": "org_456",
                "membership_id": "membership_789",
                "roles": ["member"],
                "permissions": ["conversation.read"],
                "session_id": "session_abc",
            },
            "meetings": dict(unloaded),
            "devices": dict(unloaded),
            "team": dict(unloaded),
            "settings": dict(unloaded),
        }

    def test_valid_unloaded_workspace_bootstrap(self) -> None:
        self.validator.validate(self.valid_payload())

    def test_resource_area_cannot_claim_loaded_data_yet(self) -> None:
        payload = self.valid_payload()
        payload["meetings"] = {
            "status": "unloaded",
            "items": [{"meeting_id": "invented"}],
        }
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_resource_area_status_cannot_advance_without_contract_revision(self) -> None:
        payload = self.valid_payload()
        payload["devices"]["status"] = "loaded"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_authorization_context_still_rejects_secrets(self) -> None:
        payload = self.valid_payload()
        payload["authorization"]["session_secret"] = "must-not-cross-boundary"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_cross_boundary_unknown_fields_are_rejected(self) -> None:
        payload = self.valid_payload()
        payload["billing"] = {"status": "unloaded", "items": []}
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

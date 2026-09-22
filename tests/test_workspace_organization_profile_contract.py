import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "packages" / "contracts" / "schemas"


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


class WorkspaceOrganizationProfileContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.response_schema = load_schema("workspace-organization-profile.schema.json")
        cls.update_schema = load_schema(
            "workspace-organization-profile-update.schema.json"
        )
        Draft202012Validator.check_schema(cls.response_schema)
        Draft202012Validator.check_schema(cls.update_schema)
        cls.response_validator = Draft202012Validator(cls.response_schema)
        cls.update_validator = Draft202012Validator(cls.update_schema)

    def valid_response(self) -> dict:
        return {
            "schema_version": 1,
            "organization_id": "org_456",
            "display_name": "Vertex Systems",
        }

    def test_valid_response_and_update(self) -> None:
        self.response_validator.validate(self.valid_response())
        self.update_validator.validate({"display_name": "Vertex Systems"})

    def test_response_rejects_identity_authority_and_persistence_fields(self) -> None:
        for field, value in [
            ("subject_id", "user_internal"),
            ("session_id", "session_internal"),
            ("roles", ["admin"]),
            ("permissions", ["team.manage"]),
            ("updated_at", "2026-09-22T00:00:00Z"),
        ]:
            payload = self.valid_response()
            payload[field] = value
            with self.assertRaises(ValidationError):
                self.response_validator.validate(payload)

    def test_update_is_closed_to_display_name(self) -> None:
        for field, value in [
            ("organization_id", "org_other"),
            ("subject_id", "user_other"),
            ("roles", ["admin"]),
            ("permissions", ["team.manage"]),
        ]:
            payload = {"display_name": "Vertex Systems", field: value}
            with self.assertRaises(ValidationError):
                self.update_validator.validate(payload)

    def test_display_name_is_bounded_and_control_character_safe(self) -> None:
        for value in ["x" * 101, "bad\nname", "bad\tname"]:
            with self.assertRaises(ValidationError):
                self.response_validator.validate(
                    {
                        **self.valid_response(),
                        "display_name": value,
                    }
                )
            with self.assertRaises(ValidationError):
                self.update_validator.validate({"display_name": value})


if __name__ == "__main__":
    unittest.main()

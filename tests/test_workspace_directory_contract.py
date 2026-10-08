import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "packages" / "contracts" / "schemas" / "workspace-directory.schema.json"


class WorkspaceDirectoryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def valid_payload(self) -> dict:
        return {
            "schema_version": 1,
            "workspaces": [
                {
                    "schema_version": 1,
                    "membership_id": "membership_001",
                    "organization_id": "org_001",
                    "display_name": "Vertex Systems",
                    "status": "active",
                    "roles": ["member"],
                }
            ],
            "has_more": False,
        }

    def test_valid_workspace_directory(self) -> None:
        self.validator.validate(self.valid_payload())

    def test_internal_identity_and_permission_fields_are_rejected(self) -> None:
        for forbidden_field, value in [
            ("subject_id", "user_123"),
            ("session_id", "session_internal"),
            ("permissions", ["team.read"]),
            ("email", "person@example.com"),
        ]:
            payload = self.valid_payload()
            payload["workspaces"][0][forbidden_field] = value
            with self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_display_name_is_nullable_bounded_and_control_safe(self) -> None:
        payload = self.valid_payload()
        payload["workspaces"][0]["display_name"] = None
        self.validator.validate(payload)

        for value in ["", " bad", "bad\nname", "x" * 101]:
            payload = self.valid_payload()
            payload["workspaces"][0]["display_name"] = value
            with self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_directory_is_bounded_to_100_workspaces(self) -> None:
        payload = self.valid_payload()
        workspace = payload["workspaces"][0]
        payload["workspaces"] = [
            {
                **workspace,
                "membership_id": f"membership_{index}",
                "organization_id": f"org_{index}",
            }
            for index in range(101)
        ]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_roles_and_status_are_closed(self) -> None:
        invalid_values = [
            ("roles", []),
            ("roles", ["member", "member"]),
            ("roles", ["Member"]),
            ("status", "deleted"),
        ]
        for field, value in invalid_values:
            payload = self.valid_payload()
            payload["workspaces"][0][field] = value
            with self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_unknown_top_level_fields_are_rejected(self) -> None:
        payload = self.valid_payload()
        payload["profile"] = {"display_name": "unreviewed"}
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

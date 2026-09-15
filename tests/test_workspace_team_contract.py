import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "packages" / "contracts" / "schemas" / "workspace-team.schema.json"


class WorkspaceTeamContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def valid_payload(self) -> dict:
        return {
            "schema_version": 1,
            "organization_id": "org_456",
            "members": [
                {
                    "schema_version": 1,
                    "membership_id": "membership_123",
                    "subject_id": "user_123",
                    "status": "active",
                    "roles": ["member"],
                }
            ],
            "has_more": False,
        }

    def test_valid_team_payload(self) -> None:
        self.validator.validate(self.valid_payload())

    def test_session_permissions_and_secret_fields_are_rejected(self) -> None:
        for forbidden_field, value in [
            ("session_id", "session_internal"),
            ("permissions", ["team.read"]),
            ("email", "person@example.com"),
            ("credential", "secret"),
        ]:
            payload = self.valid_payload()
            payload["members"][0][forbidden_field] = value
            with self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_member_count_is_bounded(self) -> None:
        payload = self.valid_payload()
        member = payload["members"][0]
        payload["members"] = [
            {
                **member,
                "membership_id": f"membership_{index}",
                "subject_id": f"user_{index}",
            }
            for index in range(201)
        ]
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_roles_are_bounded_unique_authority_tokens(self) -> None:
        for roles in [[], ["member", "member"], ["Member"], ["x" * 129]]:
            payload = self.valid_payload()
            payload["members"][0]["roles"] = roles
            with self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_cross_boundary_unknown_top_level_fields_are_rejected(self) -> None:
        payload = self.valid_payload()
        payload["billing"] = {"plan": "invented"}
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "packages" / "contracts" / "schemas"


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


class AuthorizationContextContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = load_schema("authorization-context.schema.json")
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_valid_tenant_bound_context(self) -> None:
        payload = {
            "schema_version": 1,
            "subject_id": "user_123",
            "organization_id": "org_456",
            "membership_id": "membership_789",
            "roles": ["member"],
            "permissions": ["conversation.read", "device.link"],
            "session_id": "session_abc",
        }
        self.validator.validate(payload)

    def test_membership_is_required(self) -> None:
        payload = {
            "schema_version": 1,
            "subject_id": "user_123",
            "organization_id": "org_456",
            "roles": ["member"],
            "permissions": [],
        }
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_session_secret_is_not_part_of_authorization_context(self) -> None:
        payload = {
            "schema_version": 1,
            "subject_id": "user_123",
            "organization_id": "org_456",
            "membership_id": "membership_789",
            "roles": ["member"],
            "permissions": [],
            "session_secret": "must-not-cross-domain-boundaries",
        }
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


class DesktopLinkRecordContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = load_schema("desktop-link-record.schema.json")
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def valid_record(self) -> dict:
        return {
            "schema_version": 1,
            "record_id": "link_123",
            "token_digest": "a" * 64,
            "subject_id": "user_123",
            "organization_id": "org_456",
            "device_id": "device_789",
            "issued_at": "2026-09-12T19:40:00Z",
            "expires_at": "2026-09-12T19:45:00Z",
            "status": "issued",
        }

    def test_valid_record_contains_only_digest(self) -> None:
        self.validator.validate(self.valid_record())

    def test_raw_exchange_token_is_rejected_from_persisted_record(self) -> None:
        payload = self.valid_record()
        payload["exchange_token"] = "raw-one-time-secret"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_browser_session_secret_is_rejected(self) -> None:
        payload = self.valid_record()
        payload["browser_session_secret"] = "must-never-be-handed-to-desktop"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_unknown_status_is_rejected(self) -> None:
        payload = self.valid_record()
        payload["status"] = "reusable"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)


if __name__ == "__main__":
    unittest.main()

import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "packages" / "contracts" / "schemas"


def load_validator(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


class DesktopLinkHttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.issue_request = load_validator("desktop-link-issue-request.schema.json")
        cls.issue_response = load_validator("desktop-link-issue-response.schema.json")
        cls.consume_request = load_validator("desktop-link-consume-request.schema.json")
        cls.consume_response = load_validator("desktop-link-consume-response.schema.json")
        cls.record_id = "550e8400-e29b-41d4-a716-446655440000"
        cls.token = "A" * 43

    def test_valid_issue_exchange_is_closed_and_bounded(self) -> None:
        self.issue_request.validate({"device_id": "desktop_001", "ttl_ms": 300000})
        self.issue_response.validate(
            {
                "schema_version": 1,
                "record_id": self.record_id,
                "exchange_token": self.token,
                "expires_at": "2026-09-15T00:05:00.000Z",
            }
        )

    def test_issue_request_rejects_secret_or_session_fields(self) -> None:
        with self.assertRaises(ValidationError):
            self.issue_request.validate(
                {
                    "device_id": "desktop_001",
                    "session_secret": "must-not-cross-boundary",
                }
            )

    def test_issue_ttl_cannot_escape_service_bounds(self) -> None:
        with self.assertRaises(ValidationError):
            self.issue_request.validate({"device_id": "desktop_001", "ttl_ms": 1000})
        with self.assertRaises(ValidationError):
            self.issue_request.validate({"device_id": "desktop_001", "ttl_ms": 900000})

    def test_consume_request_requires_exact_exchange_token_shape(self) -> None:
        self.consume_request.validate(
            {"device_id": "desktop_001", "exchange_token": self.token}
        )
        with self.assertRaises(ValidationError):
            self.consume_request.validate(
                {"device_id": "desktop_001", "exchange_token": "short"}
            )

    def test_consume_response_omits_subject_session_and_raw_token(self) -> None:
        payload = {
            "schema_version": 1,
            "linked": True,
            "record_id": self.record_id,
            "organization_id": "org_456",
            "device_id": "desktop_001",
            "consumed_at": "2026-09-15T00:01:00.000Z",
        }
        self.consume_response.validate(payload)

        for forbidden_field in ("subject_id", "session_id", "exchange_token"):
            widened = dict(payload)
            widened[forbidden_field] = "must-not-cross-boundary"
            with self.assertRaises(ValidationError):
                self.consume_response.validate(widened)


if __name__ == "__main__":
    unittest.main()

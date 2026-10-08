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
        cls.status_response = load_validator("desktop-link-status-response.schema.json")
        cls.inventory_response = load_validator("desktop-link-inventory-response.schema.json")
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


    def test_status_response_is_browser_safe_and_closed(self) -> None:
        payload = {
            "schema_version": 1,
            "record_id": self.record_id,
            "organization_id": "org_456",
            "device_id": "desktop_001",
            "status": "consumed",
            "expires_at": "2026-09-15T00:05:00.000Z",
            "consumed_at": "2026-09-15T00:01:00.000Z",
        }
        self.status_response.validate(payload)

        for forbidden_field in (
            "subject_id",
            "session_id",
            "exchange_token",
            "token_digest",
        ):
            widened = dict(payload)
            widened[forbidden_field] = "must-not-cross-boundary"
            with self.assertRaises(ValidationError):
                self.status_response.validate(widened)

    def test_status_response_supports_issued_and_expired_without_consumed_time(self) -> None:
        for status in ("issued", "expired", "revoked"):
            self.status_response.validate(
                {
                    "schema_version": 1,
                    "record_id": self.record_id,
                    "organization_id": "org_456",
                    "device_id": "desktop_001",
                    "status": status,
                    "expires_at": "2026-09-15T00:05:00.000Z",
                    "consumed_at": None,
                }
            )


    def test_inventory_response_is_browser_safe_and_bounded(self) -> None:
        payload = {
            "schema_version": 1,
            "organization_id": "org_456",
            "devices": [
                {
                    "schema_version": 1,
                    "record_id": self.record_id,
                    "device_id": "desktop_001",
                    "linked_at": "2026-09-15T00:01:00.000Z",
                }
            ],
            "has_more": False,
        }
        self.inventory_response.validate(payload)

        widened = dict(payload)
        widened["subject_id"] = "must-not-cross-boundary"
        with self.assertRaises(ValidationError):
            self.inventory_response.validate(widened)

        secret_device = dict(payload["devices"][0])
        secret_device["exchange_token"] = "must-not-cross-boundary"
        secret_payload = dict(payload)
        secret_payload["devices"] = [secret_device]
        with self.assertRaises(ValidationError):
            self.inventory_response.validate(secret_payload)

    def test_inventory_response_caps_visible_devices(self) -> None:
        payload = {
            "schema_version": 1,
            "organization_id": "org_456",
            "devices": [
                {
                    "schema_version": 1,
                    "record_id": self.record_id,
                    "device_id": f"desktop_{index:03d}",
                    "linked_at": "2026-09-15T00:01:00.000Z",
                }
                for index in range(51)
            ],
            "has_more": True,
        }
        with self.assertRaises(ValidationError):
            self.inventory_response.validate(payload)


if __name__ == "__main__":
    unittest.main()

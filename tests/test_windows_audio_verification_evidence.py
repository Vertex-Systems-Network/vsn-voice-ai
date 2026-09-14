import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "packages" / "contracts" / "schemas"
SCRIPT = ROOT / "scripts" / "windows" / "collect-virtual-mic-verification-evidence.ps1"


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


class WindowsAudioVerificationEvidenceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.controlled_schema = load_schema(
            "windows-audio-controlled-checks.schema.json"
        )
        cls.evidence_schema = load_schema(
            "windows-audio-verification-evidence.schema.json"
        )
        Draft202012Validator.check_schema(cls.controlled_schema)
        Draft202012Validator.check_schema(cls.evidence_schema)
        registry = Registry().with_resource(
            cls.controlled_schema["$id"],
            Resource.from_contents(cls.controlled_schema),
        )
        cls.validator = Draft202012Validator(cls.evidence_schema, registry=registry)

    def valid_controlled_checks(self) -> dict:
        return {
            "schema_version": 1,
            "test_run_id": "lab-run-001",
            "operator_attested": True,
            "calling_apps": [
                {
                    "app_id": "teams",
                    "processed_audio_received": True,
                    "safe_bypass_received": True,
                }
            ],
            "recovery_checks": [
                {
                    "event_id": "default_device_change",
                    "recovered": True,
                    "safe_bypass_usable": True,
                }
            ],
        }

    def valid_evidence(self) -> dict:
        return {
            "schema_version": 1,
            "generated_at": "2026-09-15T00:00:00.0000000+00:00",
            "scope": "controlled_machine",
            "evidence_state": "controlled_checks_passed",
            "repository_sha": "a" * 40,
            "host": {
                "os_description": "Microsoft Windows 11.0.26100",
                "os_architecture": "X64",
                "process_architecture": "X64",
                "github_actions": False,
            },
            "runtime_smoke": {
                "status": "passed",
                "reason": "installed_endpoint_and_control_handshake_verified",
                "system_error": 0,
            },
            "package": {
                "inf": {
                    "present": True,
                    "sha256": "b" * 64,
                    "signature_status": "NotSigned",
                },
                "driver": {
                    "present": True,
                    "sha256": "c" * 64,
                    "signature_status": "NotSigned",
                },
                "catalog": {
                    "present": True,
                    "sha256": "d" * 64,
                    "signature_status": "NotSigned",
                },
            },
            "controlled_checks": self.valid_controlled_checks(),
            "acceptance_evidence_candidate": True,
            "completion_claim": False,
        }

    def test_valid_content_safe_evidence(self) -> None:
        self.validator.validate(self.valid_evidence())

    def test_completion_can_never_be_claimed_by_collector_contract(self) -> None:
        payload = self.valid_evidence()
        payload["completion_claim"] = True
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_hosted_ci_cannot_smuggle_operator_or_machine_identity_fields(self) -> None:
        payload = self.valid_evidence()
        payload["scope"] = "hosted_ci"
        payload["host"]["machine_name"] = "sensitive-hostname"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_controlled_input_rejects_free_form_notes(self) -> None:
        payload = self.valid_controlled_checks()
        payload["notes"] = "free-form content is intentionally forbidden"
        controlled_validator = Draft202012Validator(self.controlled_schema)
        with self.assertRaises(ValidationError):
            controlled_validator.validate(payload)


class WindowsAudioVerificationCollectorSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_collector_never_self_declares_work_unit_completion(self) -> None:
        self.assertIn("completion_claim = $false", self.source)
        self.assertIn("WU-002 completion is never claimed by this collector", self.source)

    def test_hosted_ci_cannot_be_promoted_to_controlled_machine(self) -> None:
        self.assertIn("$ControlledMachine -and $isGithubActions", self.source)
        self.assertIn(
            "Hosted GitHub Actions must never be classified as a controlled verification machine",
            self.source,
        )

    def test_output_is_contained_and_controlled_input_is_bounded(self) -> None:
        self.assertIn('Join-Path $repoRoot "artifacts"', self.source)
        self.assertIn("GetRelativePath($artifactsRoot, $candidate)", self.source)
        self.assertIn("ControlledChecksFile exceeds the 64 KiB evidence-input limit", self.source)
        self.assertIn("Get-Content -LiteralPath $resolved -Raw -Encoding UTF8", self.source)

    def test_collector_does_not_execute_dynamic_or_network_content(self) -> None:
        self.assertNotIn("Invoke-Expression", self.source)
        self.assertNotIn("Invoke-WebRequest", self.source)
        self.assertNotIn("Invoke-RestMethod", self.source)


if __name__ == "__main__":
    unittest.main()

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
        cls.performance_schema = load_schema(
            "windows-audio-performance-measurements.schema.json"
        )
        cls.evidence_schema = load_schema(
            "windows-audio-verification-evidence.schema.json"
        )
        Draft202012Validator.check_schema(cls.controlled_schema)
        Draft202012Validator.check_schema(cls.performance_schema)
        Draft202012Validator.check_schema(cls.evidence_schema)
        registry = Registry().with_resources(
            [
                (
                    cls.controlled_schema["$id"],
                    Resource.from_contents(cls.controlled_schema),
                ),
                (
                    cls.performance_schema["$id"],
                    Resource.from_contents(cls.performance_schema),
                ),
            ]
        )
        cls.validator = Draft202012Validator(cls.evidence_schema, registry=registry)
        cls.performance_validator = Draft202012Validator(cls.performance_schema)

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

    def valid_performance_measurements(self) -> dict:
        return {
            "schema_version": 1,
            "test_run_id": "lab-run-001",
            "hardware_profile_id": "reference-win11-x64-01",
            "sample_rate_hz": 48000,
            "frame_duration_ms": 10,
            "sample_count": 1000,
            "measurement_window_seconds": 30.0,
            "processed_path_latency_p95_ms": 28.4,
            "callback_jitter_p95_ms": 1.7,
            "safe_bypass_transition_p95_ms": 117.2,
            "provider_path": "not_applicable",
            "network_profile": "not_applicable",
        }

    def valid_evidence(self) -> dict:
        return {
            "schema_version": 1,
            "generated_at": "2026-09-15T00:00:00.0000000+00:00",
            "scope": "controlled_machine",
            "evidence_state": "controlled_evidence_candidate",
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
            "performance_measurements": self.valid_performance_measurements(),
            "nfr_aud_002_target_met": True,
            "acceptance_evidence_candidate": True,
            "completion_claim": False,
        }

    def test_valid_content_safe_evidence(self) -> None:
        self.validator.validate(self.valid_evidence())

    def test_hosted_ci_evidence_can_explicitly_omit_controlled_measurements(self) -> None:
        payload = self.valid_evidence()
        payload["scope"] = "hosted_ci"
        payload["evidence_state"] = "verification_required"
        payload["controlled_checks"] = None
        payload["performance_measurements"] = None
        payload["nfr_aud_002_target_met"] = False
        payload["acceptance_evidence_candidate"] = False
        self.validator.validate(payload)

    def test_performance_measurements_are_bounded_and_content_safe(self) -> None:
        payload = self.valid_performance_measurements()
        payload["callback_jitter_p95_ms"] = 1001
        with self.assertRaises(ValidationError):
            self.performance_validator.validate(payload)

        payload = self.valid_performance_measurements()
        payload["machine_name"] = "sensitive-hostname"
        with self.assertRaises(ValidationError):
            self.performance_validator.validate(payload)

    def test_performance_measurements_require_local_non_provider_profile(self) -> None:
        payload = self.valid_performance_measurements()
        payload["provider_path"] = "external-provider"
        with self.assertRaises(ValidationError):
            self.performance_validator.validate(payload)

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

    def test_controlled_machine_requires_latency_and_jitter_evidence(self) -> None:
        self.assertIn(
            "ControlledMachine requires a PerformanceMeasurementsFile; latency and jitter evidence cannot be omitted",
            self.source,
        )
        self.assertIn(
            "Controlled checks and performance measurements must share the same test_run_id",
            self.source,
        )

    def test_safe_bypass_target_is_derived_from_existing_nfr(self) -> None:
        self.assertIn("safe_bypass_transition_p95_ms -le 250.0", self.source)
        self.assertIn("nfr_aud_002_target_met = [bool]$nfrAud002TargetMet", self.source)
        self.assertNotIn("nfr_aud_002_target_met = [bool]$measurements", self.source)

    def test_output_is_contained_and_controlled_input_is_bounded(self) -> None:
        self.assertIn('Join-Path $repoRoot "artifacts"', self.source)
        self.assertIn("GetRelativePath($artifactsRoot, $candidate)", self.source)
        self.assertIn("ControlledChecksFile exceeds the 64 KiB evidence-input limit", self.source)
        self.assertIn("PerformanceMeasurementsFile exceeds the 32 KiB evidence-input limit", self.source)
        self.assertIn("Get-Content -LiteralPath $resolved -Raw -Encoding UTF8", self.source)

    def test_collector_does_not_execute_dynamic_or_network_content(self) -> None:
        self.assertNotIn("Invoke-Expression", self.source)
        self.assertNotIn("Invoke-WebRequest", self.source)
        self.assertNotIn("Invoke-RestMethod", self.source)


if __name__ == "__main__":
    unittest.main()

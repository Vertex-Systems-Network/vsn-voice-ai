import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "windows" / "run-virtual-mic-controlled-install.ps1"
SCHEMA_PATH = (
    ROOT
    / "packages"
    / "contracts"
    / "schemas"
    / "windows-virtual-mic-controlled-install-evidence.schema.json"
)


class WindowsVirtualMicControlledInstallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SCRIPT_PATH.read_text(encoding="utf-8")
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def passed_evidence(self) -> dict:
        digest = "a" * 64
        return {
            "schema_version": 1,
            "status": "passed",
            "reason": "installed_runtime_verified",
            "observed_at_utc": "2026-09-13T00:00:00.000Z",
            "hardware_id": "ROOT\\VSNVIRTUALMIC",
            "package_hashes": {
                "inf_sha256": digest,
                "sys_sha256": digest,
                "cat_sha256": digest,
                "smoke_sha256": digest,
            },
            "catalog": {
                "signature_status": "Valid",
                "signer_thumbprint": "A" * 40,
            },
            "staging": {"exit_code": 0},
            "install": {"exit_code": 0, "restart_required": False},
            "smoke": {
                "attempts": 1,
                "status": "passed",
                "reason": "runtime_verified",
                "system_error": 0,
            },
            "cleanup": {
                "requested": True,
                "attempted": True,
                "succeeded": True,
                "exit_code": 0,
            },
        }

    def test_passed_evidence_contract_is_valid(self) -> None:
        self.validator.validate(self.passed_evidence())

    def test_early_failure_can_record_null_runtime_fields_without_machine_identity(self) -> None:
        payload = self.passed_evidence()
        payload.update(
            status="failed",
            reason="required_file_missing",
            package_hashes={
                "inf_sha256": None,
                "sys_sha256": None,
                "cat_sha256": None,
                "smoke_sha256": None,
            },
            catalog={"signature_status": None, "signer_thumbprint": None},
            staging={"exit_code": None},
            install={"exit_code": None, "restart_required": False},
            smoke={
                "attempts": 0,
                "status": None,
                "reason": None,
                "system_error": None,
            },
            cleanup={
                "requested": True,
                "attempted": False,
                "succeeded": None,
                "exit_code": None,
            },
        )
        self.validator.validate(payload)
        self.assertNotIn("hostname", payload)
        self.assertNotIn("username", payload)
        self.assertNotIn("package_path", payload)

    def test_security_trust_failures_have_closed_reason_codes(self) -> None:
        for reason in (
            "devcon_identity_not_valid",
            "smoke_hash_mismatch",
            "system_pnputil_missing",
        ):
            payload = self.passed_evidence()
            payload.update(status="failed", reason=reason)
            with self.subTest(reason=reason):
                self.validator.validate(payload)

    def test_passed_status_requires_valid_catalog_and_runtime_smoke(self) -> None:
        payload = self.passed_evidence()
        payload["catalog"]["signature_status"] = "NotSigned"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

        payload = self.passed_evidence()
        payload["smoke"]["status"] = "verification_required"
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_restart_required_evidence_is_explicit(self) -> None:
        payload = self.passed_evidence()
        payload.update(status="verification_required", reason="restart_required")
        payload["install"] = {"exit_code": 1, "restart_required": True}
        payload["smoke"] = {
            "attempts": 0,
            "status": None,
            "reason": None,
            "system_error": None,
        }
        self.validator.validate(payload)

        payload["install"]["restart_required"] = False
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_unknown_or_sensitive_evidence_fields_are_rejected(self) -> None:
        for field in ("username", "hostname", "credential", "private_key", "audio"):
            payload = self.passed_evidence()
            payload[field] = "must-not-cross-boundary"
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.validator.validate(payload)

    def test_script_has_fail_closed_controlled_machine_gates(self) -> None:
        required_fragments = (
            '"ROOT\\VSNVIRTUALMIC"',
            "WindowsBuiltInRole]::Administrator",
            "Get-AuthenticodeSignature",
            "SignatureStatus]::Valid",
            "[ValidateRange(1, 30)]",
            "[ValidateRange(0, 5)]",
            "[ValidatePattern('^[A-Fa-f0-9]{64}$')]",
            "SmokeExecutableSha256",
            "Test-MicrosoftDevConIdentity",
            'VersionInfo.OriginalFilename',
            "O=Microsoft Corporation",
            "SpecialFolder]::System",
            'Join-Path $systemDirectory "pnputil.exe"',
            "& $devcon install $inf $hardwareId",
            "& $devcon remove $hardwareId",
            "finally {",
            'Set-Failure "devcon_identity_not_valid"',
            'Set-Failure "smoke_hash_mismatch"',
            'Set-Failure "system_pnputil_missing"',
            'Set-VerificationRequired "restart_required"',
            'Set-VerificationRequired "installed_runtime_not_ready"',
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.source)

        self.assertNotIn('Get-Command "pnputil.exe"', self.source)
        self.assertNotIn("AllowVerificationRequired", self.source)

    def test_script_evidence_does_not_emit_machine_or_user_identity(self) -> None:
        lowered = self.source.lower()
        self.assertNotIn("computername", lowered)
        self.assertNotIn("username", lowered)
        self.assertNotIn("whoami", lowered)


if __name__ == "__main__":
    unittest.main()

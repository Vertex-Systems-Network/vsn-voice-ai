from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import export_vendor_repositories as exporter
import verify_vendor_handoff as verifier


class VendorHandoffVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.source = self.base / "source"
        self.output = self.base / "exports"
        self.source.mkdir()
        self.git(self.source, "init", "-b", "main")
        self.git(self.source, "config", "user.email", "tests@example.invalid")
        self.git(self.source, "config", "user.name", "ANPOS Tests")
        self.write("README.md", "canonical\n")
        self.write("scripts/bootstrap_child.py", "print('bootstrap')\n")
        self.write("scripts/vendor-only.py", "print('vendor')\n")
        self.write(
            "commercial-service/package.json",
            json.dumps(
                {
                    "name": "anpos-commercial-service",
                    "version": "0.3.2",
                    "anpos": {
                        "source_protocol_version": "1.3.9",
                        "runtime_contract": "split-github-app-v1",
                    },
                },
                indent=2,
            )
            + "\n",
        )
        self.write("commercial-service/app/api/health/route.ts", "export const GET = () => 'ok';\n")
        self.write(
            "config/licensing/vendor-source-boundary.json",
            json.dumps(
                {
                    "schema_version": 1,
                    "status": "template_blueprint",
                    "activation_scope": "canonical_vendor_source_management_only",
                    "vendor_only_paths": ["commercial-service", "scripts/vendor-only.py"],
                },
                indent=2,
            )
            + "\n",
        )
        self.git(self.source, "add", ".")
        self.git(self.source, "commit", "-m", "fixture")
        self.revision, self.tree = exporter.source_revision(self.source)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def git(self, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["git", *args], cwd=root, check=True, text=True, capture_output=True)

    def write(self, relative: str, content: str) -> Path:
        target = self.source / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
        return target

    def export(self, mode: str) -> Path:
        outputs = exporter.export_repositories(self.source, self.output, modes=(mode,))
        return outputs[mode]

    def verify_service(self, repository: Path) -> dict[str, object]:
        return verifier.verify_repository(
            repository,
            expected_mode="service",
            expected_source_revision=self.revision,
            expected_source_tree=self.tree,
            expected_service_version="0.3.2",
            expected_protocol_version="1.3.9",
            expected_runtime_contract="split-github-app-v1",
            source_root=self.source,
        )

    def test_plain_service_export_verifies_with_content_receipt(self) -> None:
        service = self.export("service")
        receipt = self.verify_service(service)
        self.assertTrue(receipt["ok"])
        self.assertEqual(receipt["export_mode"], "service")
        self.assertEqual(receipt["canonical_source_revision"], self.revision)
        self.assertEqual(receipt["canonical_source_tree"], self.tree)
        self.assertIsNone(receipt["target_repository_revision"])
        self.assertEqual(receipt["artifact_identity"]["service_version"], "0.3.2")
        self.assertEqual(len(receipt["manifest_sha256"]), 64)
        self.assertEqual(len(receipt["content_set_sha256"]), 64)

    def test_clean_private_style_git_checkout_verifies_from_committed_blobs(self) -> None:
        service = self.export("service")
        self.git(service, "init", "-b", "main")
        self.git(service, "config", "user.email", "tests@example.invalid")
        self.git(service, "config", "user.name", "Vendor Tests")
        self.git(service, "add", ".")
        self.git(service, "commit", "-m", "import certified export")
        receipt = self.verify_service(service)
        self.assertRegex(str(receipt["target_repository_revision"]), r"^[0-9a-f]{40}$")

    def test_tampered_export_bytes_are_rejected(self) -> None:
        service = self.export("service")
        (service / "package.json").write_text("{}\n", encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(verifier.VerificationError, "byte mismatch"):
            self.verify_service(service)

    def test_extra_file_is_rejected(self) -> None:
        service = self.export("service")
        (service / "unexpected.txt").write_text("unexpected\n", encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(verifier.VerificationError, "file set mismatch"):
            self.verify_service(service)

    def test_wrong_canonical_revision_is_rejected_before_target_acceptance(self) -> None:
        service = self.export("service")
        with self.assertRaisesRegex(verifier.VerificationError, "canonical checkout revision mismatch"):
            verifier.verify_repository(
                service,
                expected_mode="service",
                expected_source_revision="0" * 40,
                expected_source_tree=self.tree,
                expected_service_version="0.3.2",
                expected_protocol_version="1.3.9",
                expected_runtime_contract="split-github-app-v1",
                source_root=self.source,
            )

    def test_template_export_verifies_without_service_identity_arguments(self) -> None:
        template = self.export("template")
        receipt = verifier.verify_repository(
            template,
            expected_mode="template",
            expected_source_revision=self.revision,
            expected_source_tree=self.tree,
            source_root=self.source,
        )
        self.assertTrue(receipt["ok"])
        self.assertEqual(receipt["export_mode"], "template")
        self.assertIsNone(receipt["artifact_identity"])
        self.assertFalse((template / "commercial-service").exists())
        self.assertFalse((template / "scripts/vendor-only.py").exists())

    def test_dirty_git_checkout_is_rejected_even_when_committed_export_is_valid(self) -> None:
        service = self.export("service")
        self.git(service, "init", "-b", "main")
        self.git(service, "config", "user.email", "tests@example.invalid")
        self.git(service, "config", "user.name", "Vendor Tests")
        self.git(service, "add", ".")
        self.git(service, "commit", "-m", "import certified export")
        (service / "UNTRACKED.txt").write_text("dirty\n", encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(verifier.VerificationError, "must be clean"):
            self.verify_service(service)

    def test_ignored_untracked_file_is_rejected_in_git_checkout(self) -> None:
        service = self.export("service")
        self.git(service, "init", "-b", "main")
        self.git(service, "config", "user.email", "tests@example.invalid")
        self.git(service, "config", "user.name", "Vendor Tests")
        self.git(service, "add", ".")
        self.git(service, "commit", "-m", "import certified export")
        (service / ".git/info/exclude").write_text("IGNORED.txt\n", encoding="utf-8", newline="\n")
        (service / "IGNORED.txt").write_text("hidden dirty file\n", encoding="utf-8", newline="\n")
        self.assertEqual(self.git(service, "status", "--porcelain").stdout.strip(), "")
        with self.assertRaisesRegex(verifier.VerificationError, "ignored files"):
            self.verify_service(service)

    def test_service_identity_arguments_are_required_and_exact(self) -> None:
        service = self.export("service")
        with self.assertRaisesRegex(verifier.VerificationError, "requires expected service"):
            verifier.verify_repository(
                service,
                expected_mode="service",
                expected_source_revision=self.revision,
                expected_source_tree=self.tree,
                source_root=self.source,
            )
        with self.assertRaisesRegex(verifier.VerificationError, "artifact identity mismatch"):
            verifier.verify_repository(
                service,
                expected_mode="service",
                expected_source_revision=self.revision,
                expected_source_tree=self.tree,
                expected_service_version="9.9.9",
                expected_protocol_version="1.3.9",
                expected_runtime_contract="split-github-app-v1",
                source_root=self.source,
            )


if __name__ == "__main__":
    unittest.main()

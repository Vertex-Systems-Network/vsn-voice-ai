import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "windows-audio-controlled.yml"


class WindowsAudioControlledWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = WORKFLOW.read_text(encoding="utf-8")

    def test_workflow_is_manual_only_and_read_only(self) -> None:
        self.assertIn("workflow_dispatch:", self.source)
        self.assertNotIn("pull_request:", self.source)
        self.assertNotIn("push:", self.source)
        self.assertIn("permissions:\n  contents: read", self.source)

    def test_workflow_is_limited_to_main(self) -> None:
        self.assertIn("if: github.ref == 'refs/heads/main'", self.source)

    def test_workflow_targets_restricted_controlled_runner_group(self) -> None:
        self.assertIn("group: vsn-controlled-audio-restricted", self.source)
        self.assertIn(
            "labels: [self-hosted, windows, x64, vsn-controlled-audio]",
            self.source,
        )
        self.assertNotIn("runs-on: [self-hosted", self.source)
        self.assertIn('$env:RUNNER_ENVIRONMENT -ne "self-hosted"', self.source)
        self.assertIn('$env:RUNNER_OS -ne "Windows"', self.source)
        self.assertIn('$env:RUNNER_ARCH -ne "X64"', self.source)

    def test_operator_inputs_are_leaf_names_under_runner_local_root(self) -> None:
        self.assertIn("controlled_checks_filename:", self.source)
        self.assertIn("performance_samples_filename:", self.source)
        self.assertIn("VSN_CONTROLLED_EVIDENCE_DIR", self.source)
        self.assertIn("bounded JSON leaf filename", self.source)
        self.assertIn("path escaped the configured evidence directory", self.source)
        self.assertNotIn("ControlledChecksFile: ${{ inputs.", self.source)
        self.assertNotIn("PerformanceSamplesFile: ${{ inputs.", self.source)

    def test_workflow_builds_exact_revision_and_invokes_controlled_runner(self) -> None:
        self.assertIn("persist-credentials: false", self.source)
        self.assertIn("build-virtual-mic-test-package.ps1", self.source)
        self.assertIn("installed_runtime_smoke.cpp", self.source)
        self.assertIn("run-controlled-windows-audio-verification.ps1", self.source)
        self.assertIn('-RepositorySha "${{ github.sha }}"', self.source)
        self.assertNotIn("AllowVerificationRequired", self.source)

    def test_workflow_does_not_install_or_remove_driver(self) -> None:
        forbidden = (
            "pnputil /add-driver",
            "pnputil.exe /add-driver",
            "pnputil /delete-driver",
            "pnputil.exe /delete-driver",
            "devcon install",
        )
        lowered = self.source.lower()
        for token in forbidden:
            self.assertNotIn(token, lowered)

    def test_artifacts_exclude_raw_operator_inputs(self) -> None:
        upload_section = self.source.split(
            "- name: Retain content-safe controlled verification outputs", 1
        )[1]
        self.assertIn("windows-audio-verification-evidence.json", upload_section)
        self.assertIn("windows-audio-performance-measurements.json", upload_section)
        self.assertNotIn("CONTROLLED_CHECKS_PATH", upload_section)
        self.assertNotIn("PERFORMANCE_SAMPLES_PATH", upload_section)
        self.assertNotIn("controlled_checks_filename", upload_section)
        self.assertNotIn("performance_samples_filename", upload_section)

    def test_workflow_does_not_reference_secrets(self) -> None:
        self.assertNotIn("secrets.", self.source)


if __name__ == "__main__":
    unittest.main()

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "windows" / "run-controlled-windows-audio-verification.ps1"


class WindowsAudioControlledRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_runner_refuses_github_hosted_controlled_machine_claims(self) -> None:
        self.assertIn('$env:GITHUB_ACTIONS', self.source)
        self.assertIn('$env:RUNNER_ENVIRONMENT', self.source)
        self.assertIn('"self-hosted"', self.source)
        self.assertIn(
            "Controlled Windows verification can run in GitHub Actions only on an explicitly targeted self-hosted runner",
            self.source,
        )

    def test_runner_requires_windows_x64_for_github_actions_controlled_runs(self) -> None:
        self.assertIn('$env:RUNNER_OS', self.source)
        self.assertIn('$env:RUNNER_ARCH', self.source)
        self.assertIn('"Windows"', self.source)
        self.assertIn('"X64"', self.source)
        self.assertIn(
            "Controlled Windows verification requires a Windows self-hosted runner",
            self.source,
        )
        self.assertIn(
            "Controlled Windows verification requires an X64 self-hosted runner",
            self.source,
        )

    def test_runner_keeps_local_non_github_invocation_available(self) -> None:
        github_guard = self.source.index("if ($isGithubActions)")
        normalization = self.source.index("$normalizedRepositorySha")
        self.assertLess(github_guard, normalization)
        self.assertNotIn("GITHUB_ACTIONS must be true", self.source)

    def test_runner_binds_installed_driver_to_verified_package(self) -> None:
        self.assertIn(
            'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\VsnVirtualMic',
            self.source,
        )
        self.assertIn("Get-ItemProperty", self.source)
        self.assertIn("ImagePath", self.source)
        self.assertIn('Join-Path $packagePath "vsn_virtual_mic_control.sys"', self.source)
        self.assertGreaterEqual(self.source.count("Get-FileHash"), 2)
        self.assertIn("-Algorithm SHA256", self.source)
        self.assertIn(
            "Installed VSN virtual microphone driver binary does not match the verified package for this controlled run",
            self.source,
        )

    def test_runner_checks_driver_binding_before_measurement_and_collection(self) -> None:
        binding_index = self.source.index("$installedDriverHash")
        summarize_index = self.source.index("& $summarizer")
        collect_index = self.source.index("& $collector")
        self.assertLess(binding_index, summarize_index)
        self.assertLess(binding_index, collect_index)

    def test_runner_summarizes_samples_before_collecting_evidence(self) -> None:
        summarize_index = self.source.index("& $summarizer")
        collect_index = self.source.index("& $collector")
        self.assertLess(summarize_index, collect_index)
        self.assertIn("PerformanceMeasurementsFile = $PerformanceSummaryFile", self.source)
        self.assertIn("ControlledMachine = $true", self.source)
        self.assertNotIn("AllowVerificationRequired", self.source)

    def test_runner_requires_exact_repository_revision_binding(self) -> None:
        self.assertIn(
            "[Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$RepositorySha",
            self.source,
        )
        self.assertIn("RepositorySha = $normalizedRepositorySha", self.source)
        self.assertIn(
            "evidence.repository_sha -ne $normalizedRepositorySha",
            self.source,
        )
        self.assertIn("does not match the controlled run revision", self.source)

    def test_runner_requires_reviewable_candidate_without_claiming_completion(self) -> None:
        self.assertIn("acceptance_evidence_candidate", self.source)
        self.assertIn("completion_claim -ne $false", self.source)
        self.assertIn("exit 3", self.source)
        self.assertIn(
            "WU-002 completion remains a separate reviewed decision and is not claimed by this runner",
            self.source,
        )

    def test_runner_rechecks_test_run_binding(self) -> None:
        self.assertIn(
            "controlled_checks.test_run_id -ne $evidence.performance_measurements.test_run_id",
            self.source,
        )
        self.assertIn("mismatched test_run_id values", self.source)

    def test_runner_does_not_execute_dynamic_or_network_content(self) -> None:
        self.assertNotIn("Invoke-Expression", self.source)
        self.assertNotIn("Invoke-WebRequest", self.source)
        self.assertNotIn("Invoke-RestMethod", self.source)


if __name__ == "__main__":
    unittest.main()

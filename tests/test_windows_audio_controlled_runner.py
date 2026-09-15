import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "windows" / "run-controlled-windows-audio-verification.ps1"


class WindowsAudioControlledRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_runner_refuses_hosted_ci_controlled_machine_claims(self) -> None:
        self.assertIn('$env:GITHUB_ACTIONS', self.source)
        self.assertIn(
            "Controlled Windows verification cannot run in hosted GitHub Actions",
            self.source,
        )

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

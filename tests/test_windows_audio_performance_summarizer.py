import json
import math
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "packages" / "contracts" / "schemas"
SAMPLES_SCHEMA = SCHEMA_DIR / "windows-audio-performance-samples.schema.json"
MEASUREMENTS_SCHEMA = SCHEMA_DIR / "windows-audio-performance-measurements.schema.json"
FIXTURE = ROOT / "tests" / "fixtures" / "windows-audio-performance-samples.json"
SCRIPT = ROOT / "scripts" / "windows" / "summarize-windows-audio-performance.ps1"


def nearest_rank_p95(values: list[float]) -> float:
    ordered = sorted(values)
    rank = math.ceil(0.95 * len(ordered))
    return ordered[max(0, rank - 1)]


class WindowsAudioPerformanceSampleContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.samples_schema = json.loads(SAMPLES_SCHEMA.read_text(encoding="utf-8"))
        cls.measurements_schema = json.loads(
            MEASUREMENTS_SCHEMA.read_text(encoding="utf-8")
        )
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.samples_schema)
        Draft202012Validator.check_schema(cls.measurements_schema)
        cls.samples_validator = Draft202012Validator(cls.samples_schema)
        cls.measurements_validator = Draft202012Validator(cls.measurements_schema)

    def test_fixture_is_valid_numeric_only_sample_input(self) -> None:
        self.samples_validator.validate(self.fixture)
        self.assertEqual(len(self.fixture["processed_path_latency_ms"]), 20)
        self.assertEqual(len(self.fixture["callback_jitter_ms"]), 20)
        self.assertEqual(len(self.fixture["safe_bypass_transition_ms"]), 20)

    def test_fixture_has_deterministic_nearest_rank_p95_values(self) -> None:
        self.assertEqual(
            nearest_rank_p95(self.fixture["processed_path_latency_ms"]), 28
        )
        self.assertEqual(nearest_rank_p95(self.fixture["callback_jitter_ms"]), 1.9)
        self.assertEqual(
            nearest_rank_p95(self.fixture["safe_bypass_transition_ms"]), 118
        )

    def test_summary_shape_matches_measurement_contract(self) -> None:
        summary = {
            "schema_version": 1,
            "test_run_id": self.fixture["test_run_id"],
            "hardware_profile_id": self.fixture["hardware_profile_id"],
            "sample_rate_hz": self.fixture["sample_rate_hz"],
            "frame_duration_ms": self.fixture["frame_duration_ms"],
            "sample_count": len(self.fixture["processed_path_latency_ms"]),
            "measurement_window_seconds": self.fixture["measurement_window_seconds"],
            "processed_path_latency_p95_ms": 28,
            "callback_jitter_p95_ms": 1.9,
            "safe_bypass_transition_p95_ms": 118,
            "provider_path": "not_applicable",
            "network_profile": "not_applicable",
        }
        self.measurements_validator.validate(summary)

    def test_sample_contract_rejects_content_and_unbounded_values(self) -> None:
        payload = dict(self.fixture)
        payload["notes"] = "free-form text is forbidden"
        with self.assertRaises(ValidationError):
            self.samples_validator.validate(payload)

        payload = dict(self.fixture)
        payload["callback_jitter_ms"] = [0.1] * 19
        with self.assertRaises(ValidationError):
            self.samples_validator.validate(payload)

        payload = dict(self.fixture)
        payload["processed_path_latency_ms"] = [10001] * 20
        with self.assertRaises(ValidationError):
            self.samples_validator.validate(payload)


class WindowsAudioPerformanceSummarizerSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_summarizer_uses_bounded_numeric_input_and_equal_sample_counts(self) -> None:
        self.assertIn("InputFile exceeds the 2 MiB numeric-sample limit", self.source)
        self.assertIn("between 20 and 10000 numeric samples", self.source)
        self.assertIn(
            "All performance sample arrays must contain the same number of observations",
            self.source,
        )

    def test_summarizer_uses_deterministic_nearest_rank_p95(self) -> None:
        self.assertIn("Get-NearestRankP95", self.source)
        self.assertIn("[Math]::Ceiling(0.95 * $sorted.Count)", self.source)
        self.assertIn("processed_path_latency_p95_ms = Get-NearestRankP95", self.source)
        self.assertIn("callback_jitter_p95_ms = Get-NearestRankP95", self.source)
        self.assertIn("safe_bypass_transition_p95_ms = Get-NearestRankP95", self.source)

    def test_summarizer_never_executes_dynamic_or_network_content(self) -> None:
        self.assertNotIn("Invoke-Expression", self.source)
        self.assertNotIn("Invoke-WebRequest", self.source)
        self.assertNotIn("Invoke-RestMethod", self.source)

    def test_summarizer_makes_no_acceptance_or_completion_claim(self) -> None:
        self.assertIn("no acceptance or completion claim was made", self.source)
        self.assertNotIn("completion_claim = $true", self.source)


if __name__ == "__main__":
    unittest.main()

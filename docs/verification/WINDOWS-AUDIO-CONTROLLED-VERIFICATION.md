# WU-002 Controlled Windows Audio Verification

**Scope:** controlled-machine evidence for MOD-002 / WU-002 only.  
**Status:** verification procedure; running this procedure does not complete WU-002 automatically.

## Purpose

Use this procedure on a real controlled Windows machine after the VSN virtual microphone package is installed. It binds three evidence classes to one `test_run_id`:

1. installed endpoint/control runtime smoke;
2. approved calling-app and device-lifecycle checks;
3. numeric processed-path latency, callback-jitter and safe-bypass transition samples.

The final collector output is a content-safe **acceptance evidence candidate** only. `completion_claim` remains `false`; WU-002 completion is a separate reviewed decision.

Hosted GitHub Actions cannot run this procedure as a controlled machine.

## Preconditions

Before starting a run:

- use a controlled physical Windows machine appropriate for the supported test profile;
- install the virtual microphone package built from the repository revision being verified;
- keep the compiled `virtual_mic_installed_runtime_smoke.exe` and package directory available under the repository `artifacts/` area;
- choose one unique non-sensitive `test_run_id`, for example `lab-run-20260915-01`;
- use an opaque `hardware_profile_id` such as `reference-win11-x64-01`; do not use a hostname, operator name, asset tag, serial number or other identifying value;
- identify the calling applications approved for this verification run;
- define the measurement method and stage boundaries before collecting numeric samples. Do not substitute hosted-CI timing or provider marketing claims for controlled measurements.

## 1. Record controlled checks

Create `artifacts/windows-audio-controlled-checks.json` using the closed contract in `packages/contracts/schemas/windows-audio-controlled-checks.schema.json`.

The example below is deliberately fail-closed. Keep every result `false` until the corresponding behavior is actually observed on the controlled machine.

```json
{
  "schema_version": 1,
  "test_run_id": "lab-run-20260915-01",
  "operator_attested": false,
  "calling_apps": [
    {
      "app_id": "approved_calling_app_1",
      "processed_audio_received": false,
      "safe_bypass_received": false
    }
  ],
  "recovery_checks": [
    {
      "event_id": "default_device_change",
      "recovered": false,
      "safe_bypass_usable": false
    }
  ]
}
```

Set a result to `true` only after it is actually observed. Set `operator_attested` to `true` only after all entries in the file represent the completed controlled run. Include every lifecycle event applicable to the controlled test profile. Supported event identifiers are:

- `usb_unplug_replug`
- `default_device_change`
- `disable_enable`
- `sleep_wake`
- `audio_service_restart`
- `bluetooth_disconnect`

The evidence input intentionally has no free-form notes field.

## 2. Record raw performance samples

Create `artifacts/windows-audio-performance-samples.json` using `packages/contracts/schemas/windows-audio-performance-samples.schema.json`.

Each metric requires 20–10,000 numeric observations. All three arrays must contain the same number of observations.

The structure below is intentionally **schema-invalid until real measurements replace every placeholder**. This prevents a copied template from becoming an acceptance candidate by accident.

```json
{
  "schema_version": 1,
  "test_run_id": "lab-run-20260915-01",
  "hardware_profile_id": "reference-win11-x64-01",
  "sample_rate_hz": 48000,
  "frame_duration_ms": 10,
  "measurement_window_seconds": 30.0,
  "processed_path_latency_ms": ["REPLACE_WITH_20_OR_MORE_MEASURED_NUMBERS"],
  "callback_jitter_ms": ["REPLACE_WITH_20_OR_MORE_MEASURED_NUMBERS"],
  "safe_bypass_transition_ms": ["REPLACE_WITH_20_OR_MORE_MEASURED_NUMBERS"],
  "provider_path": "not_applicable",
  "network_profile": "not_applicable"
}
```

Do not run verification until every placeholder has been replaced by observed numeric measurements from the defined controlled test method and all three arrays have equal length.

The summarizer computes deterministic nearest-rank p95 values. Operators do not enter p95 values manually.

## 3. Run the controlled verifier

From the repository root in PowerShell:

```powershell
./scripts/windows/run-controlled-windows-audio-verification.ps1 `
  -ControlledChecksFile artifacts/windows-audio-controlled-checks.json `
  -PerformanceSamplesFile artifacts/windows-audio-performance-samples.json `
  -RepositorySha <40-character-repository-sha>
```

The runner performs these steps in order:

1. rejects hosted GitHub Actions;
2. summarizes raw numeric samples into `artifacts/windows-audio-performance-measurements.json`;
3. runs the installed endpoint/control smoke;
4. collects package hashes/signature status and controlled checks;
5. binds controlled checks and performance measurements by identical `test_run_id`;
6. binds the emitted evidence to the exact supplied repository SHA;
7. derives `nfr_aud_002_target_met` from the existing `safe_bypass_transition_p95_ms <= 250` engineering target;
8. emits `artifacts/windows-audio-verification-evidence.json`;
9. returns non-zero if the run does not produce an acceptance evidence candidate.

No generic processed-path latency or jitter pass threshold is invented by this runner. Those measured values remain review evidence unless an approved requirement defines a threshold.

## 4. Review the emitted evidence

A successful candidate must retain all of these properties:

- `scope` is `controlled_machine`;
- `repository_sha` exactly matches the revision supplied to the runner;
- `runtime_smoke.status` is `passed`;
- controlled calling-app checks show processed and safe-bypass audio as observed;
- applicable recovery checks show recovery and usable safe bypass as observed;
- `performance_measurements` is present;
- controlled checks and performance measurements share the same `test_run_id`;
- `nfr_aud_002_target_met` is `true`;
- `acceptance_evidence_candidate` is `true`;
- `completion_claim` is `false`.

Preserve the emitted JSON and the exact repository SHA with the review evidence. Do not add raw audio, transcripts, credentials, machine names, operator identity or free-form customer content to the evidence file.

## What this still does not prove by itself

An acceptance evidence candidate does not itself prove release readiness or mark WU-002 complete. Review must still confirm that the selected machine, calling-app matrix, lifecycle events, measurement method and repository revision match the approved verification scope and that no required physical scenario was omitted.

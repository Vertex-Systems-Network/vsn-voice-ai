# WU-002 Controlled Windows Audio Verification

**Scope:** controlled-machine evidence for MOD-002 / WU-002 only.  
**Status:** verification procedure; running this procedure does not complete WU-002 automatically.

## Purpose

Use this procedure on a real controlled Windows machine after the VSN virtual microphone package is installed. It binds three evidence classes to one `test_run_id`:

1. installed endpoint/control runtime smoke;
2. approved calling-app and device-lifecycle checks;
3. numeric processed-path latency, callback-jitter and safe-bypass transition samples.

The final collector output is a content-safe **acceptance evidence candidate** only. `completion_claim` remains `false`; WU-002 completion is a separate reviewed decision.

GitHub-hosted runners cannot act as a controlled machine. A GitHub Actions controlled run is allowed only on an explicitly targeted self-hosted Windows x64 runner carrying the `vsn-controlled-audio` label. Local PowerShell execution on the controlled machine remains supported.

## Preconditions

Before starting a run:

- use a controlled physical Windows machine appropriate for the supported test profile;
- install the virtual microphone package built from the repository revision being verified;
- do not rely on the controlled workflow to install, remove or replace the audio driver;
- keep the controlled endpoint installed and visible to the approved calling applications before verification starts;
- choose one unique non-sensitive `test_run_id`, for example `lab-run-20260915-01`;
- use an opaque `hardware_profile_id` such as `reference-win11-x64-01`; do not use a hostname, operator name, asset tag, serial number or other identifying value;
- identify the calling applications approved for this verification run;
- define the measurement method and stage boundaries before collecting numeric samples. Do not substitute hosted-CI timing or provider marketing claims for controlled measurements.

For the self-hosted GitHub Actions path, the controlled machine must also have:

- a self-hosted GitHub Actions runner registered with labels `self-hosted`, `windows`, `x64`, and `vsn-controlled-audio`;
- Visual Studio/MSVC x64 build tools and the existing driver-build prerequisites used by the repository Windows validation workflow;
- a runner-local environment variable named `VSN_CONTROLLED_EVIDENCE_DIR` pointing to a directory outside the repository checkout where operator-prepared JSON inputs are stored;
- the GitHub Actions runner service restarted after setting or changing `VSN_CONTROLLED_EVIDENCE_DIR`, so the runner process inherits the value.

The manual workflow accepts only bounded `.json` leaf filenames. It resolves those filenames underneath `VSN_CONTROLLED_EVIDENCE_DIR`; path separators, rooted paths and traversal-style input are not accepted. Raw operator input files are not uploaded as workflow artifacts.

## 1. Record controlled checks

Create a JSON file using the closed contract in `packages/contracts/schemas/windows-audio-controlled-checks.schema.json`. For local execution it can be stored at `artifacts/windows-audio-controlled-checks.json`. For the self-hosted workflow, place it under `VSN_CONTROLLED_EVIDENCE_DIR` and keep only its leaf filename for workflow dispatch.

The baseline lifecycle matrix always requires these four recovery scenarios:

- `default_device_change`
- `disable_enable`
- `sleep_wake`
- `audio_service_restart`

Add `usb_unplug_replug` and/or `bluetooth_disconnect` when those device classes are part of the supported controlled test profile. They are additional checks, not substitutes for the four baseline events.

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
    },
    {
      "event_id": "disable_enable",
      "recovered": false,
      "safe_bypass_usable": false
    },
    {
      "event_id": "sleep_wake",
      "recovered": false,
      "safe_bypass_usable": false
    },
    {
      "event_id": "audio_service_restart",
      "recovered": false,
      "safe_bypass_usable": false
    }
  ]
}
```

Set a result to `true` only after it is actually observed. Set `operator_attested` to `true` only after all entries in the file represent the completed controlled run. The schema and collector both reject a controlled-check file that omits any of the four baseline recovery events.

Supported recovery event identifiers are:

- `usb_unplug_replug`
- `default_device_change`
- `disable_enable`
- `sleep_wake`
- `audio_service_restart`
- `bluetooth_disconnect`

The evidence input intentionally has no free-form notes field.

## 2. Record raw performance samples

Create a JSON file using `packages/contracts/schemas/windows-audio-performance-samples.schema.json`. For local execution it can be stored at `artifacts/windows-audio-performance-samples.json`. For the self-hosted workflow, place it under `VSN_CONTROLLED_EVIDENCE_DIR` and dispatch only its leaf filename.

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

## 3A. Run locally on the controlled machine

From the repository root in PowerShell:

```powershell
./scripts/windows/run-controlled-windows-audio-verification.ps1 `
  -ControlledChecksFile artifacts/windows-audio-controlled-checks.json `
  -PerformanceSamplesFile artifacts/windows-audio-performance-samples.json `
  -RepositorySha <40-character-repository-sha>
```

Local invocation is allowed when the machine is not running under GitHub Actions. The supplied SHA must identify the exact checked-out revision being reviewed.

## 3B. Run through the controlled self-hosted workflow

Use the GitHub Actions workflow **Controlled Windows Audio Verification** (`.github/workflows/windows-audio-controlled.yml`) and choose **Run workflow** on the exact repository revision intended for review.

Provide only these two inputs:

- `controlled_checks_filename`: leaf filename of the controlled-check JSON under `VSN_CONTROLLED_EVIDENCE_DIR`;
- `performance_samples_filename`: leaf filename of the performance-sample JSON under `VSN_CONTROLLED_EVIDENCE_DIR`.

The workflow is manual-only and targets `[self-hosted, windows, x64, vsn-controlled-audio]`. If no controlled runner with those labels is online, the job must remain queued rather than fall back to a GitHub-hosted runner.

The workflow:

1. checks out the exact selected repository revision with persisted Git credentials disabled;
2. independently verifies `RUNNER_ENVIRONMENT=self-hosted`, `RUNNER_OS=Windows`, and `RUNNER_ARCH=X64`;
3. resolves only safe JSON leaf filenames under `VSN_CONTROLLED_EVIDENCE_DIR`;
4. builds the virtual-microphone driver/package and installed-runtime smoke harness from the checked-out revision;
5. does **not** install, remove or replace the driver on the machine;
6. invokes `run-controlled-windows-audio-verification.ps1` with `${{ github.sha }}` as the exact evidence revision;
7. uploads only the generated content-safe verification evidence and performance summary, not the raw controlled-check or raw performance-sample inputs.

The PowerShell runner repeats the self-hosted Windows x64 boundary check when invoked inside GitHub Actions, so a workflow configuration mistake cannot silently turn a GitHub-hosted job into controlled acceptance evidence.

## 4. What the controlled runner verifies

The runner performs these steps in order:

1. rejects GitHub Actions execution unless `RUNNER_ENVIRONMENT` is `self-hosted`, `RUNNER_OS` is `Windows`, and `RUNNER_ARCH` is `X64`;
2. summarizes raw numeric samples into `artifacts/windows-audio-performance-measurements.json`;
3. runs the installed endpoint/control smoke;
4. collects package hashes/signature status and controlled checks;
5. requires the four baseline lifecycle recovery events and any applicable profile-specific additions;
6. binds controlled checks and performance measurements by identical `test_run_id`;
7. binds the emitted evidence to the exact supplied repository SHA;
8. derives `nfr_aud_002_target_met` from the existing `safe_bypass_transition_p95_ms <= 250` engineering target;
9. emits `artifacts/windows-audio-verification-evidence.json`;
10. returns non-zero if the run does not produce an acceptance evidence candidate.

No generic processed-path latency or jitter pass threshold is invented by this runner. Those measured values remain review evidence unless an approved requirement defines a threshold.

## 5. Review the emitted evidence

A successful candidate must retain all of these properties:

- `scope` is `controlled_machine`;
- `repository_sha` exactly matches the revision supplied to the runner;
- `runtime_smoke.status` is `passed`;
- controlled calling-app checks show processed and safe-bypass audio as observed;
- all four baseline lifecycle recovery checks are present and show recovery plus usable safe bypass;
- USB/Bluetooth recovery checks are included when those scenarios are part of the supported profile;
- `performance_measurements` is present;
- controlled checks and performance measurements share the same `test_run_id`;
- `nfr_aud_002_target_met` is `true`;
- `acceptance_evidence_candidate` is `true`;
- `completion_claim` is `false`.

Preserve the emitted JSON and the exact repository SHA with the review evidence. Do not add raw audio, transcripts, credentials, machine names, operator identity or free-form customer content to the evidence file.

## What this still does not prove by itself

An acceptance evidence candidate does not itself prove release readiness or mark WU-002 complete. Review must still confirm that the selected physical machine, calling-app matrix, lifecycle events, measurement method and repository revision match the approved verification scope and that no required physical scenario was omitted.

[CmdletBinding()]
param(
    [string]$SmokeExecutable = "artifacts/virtual_mic_installed_runtime_smoke.exe",
    [string]$PackageDirectory = "artifacts/vsn-virtual-mic-test-package",
    [string]$OutputFile = "artifacts/windows-audio-verification-evidence.json",
    [string]$ControlledChecksFile = "",
    [string]$PerformanceMeasurementsFile = "",
    [string]$RepositorySha = $env:GITHUB_SHA,
    [switch]$ControlledMachine,
    [switch]$AllowVerificationRequired
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
$isGithubActions = [string]::Equals($env:GITHUB_ACTIONS, "true", [System.StringComparison]::OrdinalIgnoreCase)

if ($ControlledMachine -and $isGithubActions) {
    throw "Hosted GitHub Actions must never be classified as a controlled verification machine."
}

function Resolve-ContainedArtifactPath {
    param([Parameter(Mandatory = $true)][string]$Value)

    $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
        [System.IO.Path]::GetFullPath($Value)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
    }

    $relative = [System.IO.Path]::GetRelativePath($artifactsRoot, $candidate)
    $parentPrefix = "..$([System.IO.Path]::DirectorySeparatorChar)"
    $altParentPrefix = "..$([System.IO.Path]::AltDirectorySeparatorChar)"
    if (
        $relative -eq "." -or
        $relative -eq ".." -or
        [System.IO.Path]::IsPathRooted($relative) -or
        $relative.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $relative.StartsWith($altParentPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        throw "OutputFile must be a child of the repository artifacts directory."
    }
    return $candidate
}

function Resolve-InputPath {
    param([Parameter(Mandatory = $true)][string]$Value)

    $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
        [System.IO.Path]::GetFullPath($Value)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Required input file was not found: $candidate"
    }
    return $candidate
}

function Assert-ExactObjectKeys {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string]$Context
    )

    if ($null -eq $Object -or $Object -isnot [pscustomobject]) {
        throw "$Context must be a JSON object."
    }
    $actual = @($Object.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if (($actual -join "|") -ne ($wanted -join "|")) {
        throw "$Context contains missing or unsupported fields."
    }
}

function Test-JsonInteger {
    param($Value)

    return (
        $Value -is [byte] -or
        $Value -is [sbyte] -or
        $Value -is [int16] -or
        $Value -is [uint16] -or
        $Value -is [int32] -or
        $Value -is [uint32] -or
        $Value -is [int64] -or
        $Value -is [uint64]
    )
}

function Test-JsonNumber {
    param($Value)

    return (
        (Test-JsonInteger -Value $Value) -or
        $Value -is [single] -or
        $Value -is [double] -or
        $Value -is [decimal]
    )
}

function Get-PackageFileEvidence {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ present = $false }
    }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    return [ordered]@{
        present = $true
        sha256 = $hash
        signature_status = [string]$signature.Status
    }
}

function Read-ControlledChecks {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = Resolve-InputPath -Value $Path
    $raw = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8
    if ($raw.Length -gt 65536) {
        throw "ControlledChecksFile exceeds the 64 KiB evidence-input limit."
    }
    $checks = $raw | ConvertFrom-Json
    Assert-ExactObjectKeys -Object $checks -Expected @(
        "schema_version",
        "test_run_id",
        "operator_attested",
        "calling_apps",
        "recovery_checks"
    ) -Context "controlled checks"

    if ($checks.schema_version -ne 1) {
        throw "Controlled checks schema_version must be 1."
    }
    if ($checks.test_run_id -isnot [string] -or $checks.test_run_id -notmatch '^[A-Za-z0-9._-]{1,64}$') {
        throw "Controlled checks test_run_id is invalid."
    }
    if ($checks.operator_attested -isnot [bool]) {
        throw "Controlled checks operator_attested must be boolean."
    }

    $callingApps = @($checks.calling_apps)
    if ($callingApps.Count -lt 1 -or $callingApps.Count -gt 16) {
        throw "Controlled checks must contain between 1 and 16 calling-app checks."
    }
    $seenApps = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $safeApps = @()
    foreach ($item in $callingApps) {
        Assert-ExactObjectKeys -Object $item -Expected @(
            "app_id",
            "processed_audio_received",
            "safe_bypass_received"
        ) -Context "calling-app check"
        if ($item.app_id -isnot [string] -or $item.app_id -notmatch '^[a-z0-9._-]{1,64}$') {
            throw "Controlled calling-app app_id is invalid."
        }
        if (-not $seenApps.Add($item.app_id)) {
            throw "Controlled calling-app app_id values must be unique."
        }
        if ($item.processed_audio_received -isnot [bool] -or $item.safe_bypass_received -isnot [bool]) {
            throw "Controlled calling-app results must be boolean."
        }
        $safeApps += [ordered]@{
            app_id = $item.app_id
            processed_audio_received = [bool]$item.processed_audio_received
            safe_bypass_received = [bool]$item.safe_bypass_received
        }
    }

    $allowedRecoveryEvents = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@(
            "usb_unplug_replug",
            "default_device_change",
            "disable_enable",
            "sleep_wake",
            "audio_service_restart",
            "bluetooth_disconnect"
        ),
        [System.StringComparer]::Ordinal
    )
    $requiredRecoveryEvents = [string[]]@(
        "default_device_change",
        "disable_enable",
        "sleep_wake",
        "audio_service_restart"
    )
    $recoveryChecks = @($checks.recovery_checks)
    if ($recoveryChecks.Count -lt $requiredRecoveryEvents.Count -or $recoveryChecks.Count -gt $allowedRecoveryEvents.Count) {
        throw "Controlled checks must contain the four required baseline recovery checks and at most two applicable profile-specific checks."
    }
    $seenRecovery = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $safeRecovery = @()
    foreach ($item in $recoveryChecks) {
        Assert-ExactObjectKeys -Object $item -Expected @(
            "event_id",
            "recovered",
            "safe_bypass_usable"
        ) -Context "recovery check"
        if ($item.event_id -isnot [string] -or -not $allowedRecoveryEvents.Contains($item.event_id)) {
            throw "Controlled recovery event_id is invalid."
        }
        if (-not $seenRecovery.Add($item.event_id)) {
            throw "Controlled recovery event_id values must be unique."
        }
        if ($item.recovered -isnot [bool] -or $item.safe_bypass_usable -isnot [bool]) {
            throw "Controlled recovery results must be boolean."
        }
        $safeRecovery += [ordered]@{
            event_id = $item.event_id
            recovered = [bool]$item.recovered
            safe_bypass_usable = [bool]$item.safe_bypass_usable
        }
    }
    foreach ($requiredEvent in $requiredRecoveryEvents) {
        if (-not $seenRecovery.Contains($requiredEvent)) {
            throw "Controlled checks must include required recovery event '$requiredEvent'."
        }
    }

    return [ordered]@{
        schema_version = 1
        test_run_id = $checks.test_run_id
        operator_attested = [bool]$checks.operator_attested
        calling_apps = $safeApps
        recovery_checks = $safeRecovery
    }
}

function Read-PerformanceMeasurements {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = Resolve-InputPath -Value $Path
    $raw = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8
    if ($raw.Length -gt 32768) {
        throw "PerformanceMeasurementsFile exceeds the 32 KiB evidence-input limit."
    }
    $measurements = $raw | ConvertFrom-Json
    Assert-ExactObjectKeys -Object $measurements -Expected @(
        "schema_version",
        "test_run_id",
        "hardware_profile_id",
        "sample_rate_hz",
        "frame_duration_ms",
        "sample_count",
        "measurement_window_seconds",
        "processed_path_latency_p95_ms",
        "callback_jitter_p95_ms",
        "safe_bypass_transition_p95_ms",
        "provider_path",
        "network_profile"
    ) -Context "performance measurements"

    if ($measurements.schema_version -ne 1) {
        throw "Performance measurements schema_version must be 1."
    }
    if ($measurements.test_run_id -isnot [string] -or $measurements.test_run_id -notmatch '^[A-Za-z0-9._-]{1,64}$') {
        throw "Performance measurements test_run_id is invalid."
    }
    if ($measurements.hardware_profile_id -isnot [string] -or $measurements.hardware_profile_id -notmatch '^[a-z0-9._-]{1,96}$') {
        throw "Performance measurements hardware_profile_id is invalid."
    }
    if (-not (Test-JsonInteger -Value $measurements.sample_rate_hz) -or [long]$measurements.sample_rate_hz -lt 8000 -or [long]$measurements.sample_rate_hz -gt 192000) {
        throw "Performance measurements sample_rate_hz is out of range."
    }
    if (-not (Test-JsonInteger -Value $measurements.frame_duration_ms) -or [long]$measurements.frame_duration_ms -lt 1 -or [long]$measurements.frame_duration_ms -gt 100) {
        throw "Performance measurements frame_duration_ms is out of range."
    }
    if (-not (Test-JsonInteger -Value $measurements.sample_count) -or [long]$measurements.sample_count -lt 20 -or [long]$measurements.sample_count -gt 1000000) {
        throw "Performance measurements sample_count is out of range."
    }
    if (-not (Test-JsonNumber -Value $measurements.measurement_window_seconds) -or [double]$measurements.measurement_window_seconds -le 0 -or [double]$measurements.measurement_window_seconds -gt 3600) {
        throw "Performance measurements measurement_window_seconds is out of range."
    }
    if (-not (Test-JsonNumber -Value $measurements.processed_path_latency_p95_ms) -or [double]$measurements.processed_path_latency_p95_ms -lt 0 -or [double]$measurements.processed_path_latency_p95_ms -gt 10000) {
        throw "Performance measurements processed_path_latency_p95_ms is out of range."
    }
    if (-not (Test-JsonNumber -Value $measurements.callback_jitter_p95_ms) -or [double]$measurements.callback_jitter_p95_ms -lt 0 -or [double]$measurements.callback_jitter_p95_ms -gt 1000) {
        throw "Performance measurements callback_jitter_p95_ms is out of range."
    }
    if (-not (Test-JsonNumber -Value $measurements.safe_bypass_transition_p95_ms) -or [double]$measurements.safe_bypass_transition_p95_ms -lt 0 -or [double]$measurements.safe_bypass_transition_p95_ms -gt 10000) {
        throw "Performance measurements safe_bypass_transition_p95_ms is out of range."
    }
    if ($measurements.provider_path -ne "not_applicable" -or $measurements.network_profile -ne "not_applicable") {
        throw "WU-002 local virtual-mic performance evidence must mark provider and network as not_applicable."
    }

    return [ordered]@{
        schema_version = 1
        test_run_id = $measurements.test_run_id
        hardware_profile_id = $measurements.hardware_profile_id
        sample_rate_hz = [int]$measurements.sample_rate_hz
        frame_duration_ms = [int]$measurements.frame_duration_ms
        sample_count = [long]$measurements.sample_count
        measurement_window_seconds = [double]$measurements.measurement_window_seconds
        processed_path_latency_p95_ms = [double]$measurements.processed_path_latency_p95_ms
        callback_jitter_p95_ms = [double]$measurements.callback_jitter_p95_ms
        safe_bypass_transition_p95_ms = [double]$measurements.safe_bypass_transition_p95_ms
        provider_path = "not_applicable"
        network_profile = "not_applicable"
    }
}

function Test-ControlledChecksPassed {
    param($Checks)

    if ($null -eq $Checks -or -not $Checks.operator_attested) {
        return $false
    }
    foreach ($item in @($Checks.calling_apps)) {
        if (-not $item.processed_audio_received -or -not $item.safe_bypass_received) {
            return $false
        }
    }

    $requiredRecoveryEvents = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@(
            "default_device_change",
            "disable_enable",
            "sleep_wake",
            "audio_service_restart"
        ),
        [System.StringComparer]::Ordinal
    )
    $seenRecovery = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($item in @($Checks.recovery_checks)) {
        if (-not $item.recovered -or -not $item.safe_bypass_usable) {
            return $false
        }
        [void]$seenRecovery.Add([string]$item.event_id)
    }
    foreach ($requiredEvent in $requiredRecoveryEvents) {
        if (-not $seenRecovery.Contains($requiredEvent)) {
            return $false
        }
    }
    return $true
}

$smokePath = Resolve-InputPath -Value $SmokeExecutable
$outputPath = Resolve-ContainedArtifactPath -Value $OutputFile
$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$smokeOutput = @(& $smokePath 2>&1)
$smokeExitCode = $LASTEXITCODE
$jsonLine = @($smokeOutput | Where-Object { ([string]$_).TrimStart().StartsWith("{") } | Select-Object -Last 1)
if ($jsonLine.Count -ne 1) {
    throw "Installed runtime smoke did not emit exactly one parseable result payload."
}
$smokePayload = ([string]$jsonLine[0]) | ConvertFrom-Json
Assert-ExactObjectKeys -Object $smokePayload -Expected @("status", "reason", "system_error") -Context "runtime smoke result"
if ($smokePayload.status -notin @("passed", "failed", "verification_required")) {
    throw "Runtime smoke status is invalid."
}
if ($smokePayload.reason -isnot [string] -or $smokePayload.reason -notmatch '^[a-z0-9_]{1,96}$') {
    throw "Runtime smoke reason is not content-safe."
}
if ($smokePayload.system_error -isnot [long] -and $smokePayload.system_error -isnot [int]) {
    throw "Runtime smoke system_error must be an integer."
}
if ([long]$smokePayload.system_error -lt 0 -or [long]$smokePayload.system_error -gt [uint32]::MaxValue) {
    throw "Runtime smoke system_error is out of range."
}
if (
    ($smokeExitCode -eq 0 -and $smokePayload.status -ne "passed") -or
    ($smokeExitCode -eq 2 -and $smokePayload.status -ne "verification_required") -or
    ($smokeExitCode -notin @(0, 2) -and $smokePayload.status -ne "failed")
) {
    throw "Runtime smoke exit code and status payload disagree."
}

$packageRoot = if ([System.IO.Path]::IsPathRooted($PackageDirectory)) {
    [System.IO.Path]::GetFullPath($PackageDirectory)
}
else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $PackageDirectory))
}
$packageEvidence = [ordered]@{
    inf = Get-PackageFileEvidence -Path (Join-Path $packageRoot "vsn_virtual_mic.inf")
    driver = Get-PackageFileEvidence -Path (Join-Path $packageRoot "vsn_virtual_mic_control.sys")
    catalog = Get-PackageFileEvidence -Path (Join-Path $packageRoot "vsn_virtual_mic.cat")
}

$controlledChecks = $null
if (-not [string]::IsNullOrWhiteSpace($ControlledChecksFile)) {
    $controlledChecks = Read-ControlledChecks -Path $ControlledChecksFile
}
$performanceMeasurements = $null
if (-not [string]::IsNullOrWhiteSpace($PerformanceMeasurementsFile)) {
    $performanceMeasurements = Read-PerformanceMeasurements -Path $PerformanceMeasurementsFile
}
if ($ControlledMachine -and $null -eq $controlledChecks) {
    throw "ControlledMachine requires a ControlledChecksFile; unattended machines cannot self-attest."
}
if ($ControlledMachine -and $null -eq $performanceMeasurements) {
    throw "ControlledMachine requires a PerformanceMeasurementsFile; latency and jitter evidence cannot be omitted."
}
if (
    $null -ne $controlledChecks -and
    $null -ne $performanceMeasurements -and
    $controlledChecks.test_run_id -ne $performanceMeasurements.test_run_id
) {
    throw "Controlled checks and performance measurements must share the same test_run_id."
}

$scope = if ($isGithubActions) {
    "hosted_ci"
}
elseif ($ControlledMachine) {
    "controlled_machine"
}
else {
    "local_unattested"
}

$controlledChecksPassed = Test-ControlledChecksPassed -Checks $controlledChecks
$nfrAud002TargetMet =
    $null -ne $performanceMeasurements -and
    [double]$performanceMeasurements.safe_bypass_transition_p95_ms -le 250.0
$acceptanceEvidenceCandidate =
    $scope -eq "controlled_machine" -and
    $smokePayload.status -eq "passed" -and
    $controlledChecksPassed -and
    $null -ne $performanceMeasurements -and
    $nfrAud002TargetMet

$evidenceState = if ($smokePayload.status -eq "failed") {
    "failed"
}
elseif ($acceptanceEvidenceCandidate) {
    "controlled_evidence_candidate"
}
elseif ($scope -eq "controlled_machine" -and $smokePayload.status -eq "passed" -and $controlledChecksPassed) {
    "controlled_checks_passed"
}
elseif ($smokePayload.status -eq "passed") {
    "runtime_smoke_passed"
}
else {
    "verification_required"
}

$normalizedSha = $null
if (-not [string]::IsNullOrWhiteSpace($RepositorySha)) {
    if ($RepositorySha -notmatch '^[0-9a-fA-F]{40}$') {
        throw "RepositorySha must be exactly 40 hexadecimal characters when provided."
    }
    $normalizedSha = $RepositorySha.ToLowerInvariant()
}

$evidence = [ordered]@{
    schema_version = 1
    generated_at = [DateTimeOffset]::UtcNow.ToString("o")
    scope = $scope
    evidence_state = $evidenceState
    repository_sha = $normalizedSha
    host = [ordered]@{
        os_description = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
        os_architecture = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
        process_architecture = [string][System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
        github_actions = $isGithubActions
    }
    runtime_smoke = [ordered]@{
        status = [string]$smokePayload.status
        reason = [string]$smokePayload.reason
        system_error = [uint32]$smokePayload.system_error
    }
    package = $packageEvidence
    controlled_checks = $controlledChecks
    performance_measurements = $performanceMeasurements
    nfr_aud_002_target_met = [bool]$nfrAud002TargetMet
    acceptance_evidence_candidate = $acceptanceEvidenceCandidate
    completion_claim = $false
}

$json = $evidence | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($outputPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "Windows audio verification evidence written: $outputPath"
Write-Host "Evidence state: $evidenceState; scope: $scope; WU-002 completion is never claimed by this collector."

if ($smokePayload.status -eq "failed") {
    exit 1
}
if ($smokePayload.status -eq "verification_required" -and -not $AllowVerificationRequired) {
    exit 2
}
exit 0

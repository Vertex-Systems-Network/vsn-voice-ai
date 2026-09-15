[CmdletBinding()]
param(
    [string]$SmokeExecutable = "artifacts/virtual_mic_installed_runtime_smoke.exe",
    [string]$PackageDirectory = "artifacts/vsn-virtual-mic-test-package",
    [Parameter(Mandatory = $true)][string]$ControlledChecksFile,
    [Parameter(Mandatory = $true)][string]$PerformanceSamplesFile,
    [string]$PerformanceSummaryFile = "artifacts/windows-audio-performance-measurements.json",
    [string]$OutputFile = "artifacts/windows-audio-verification-evidence.json",
    [string]$RepositorySha = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$isGithubActions = [string]::Equals(
    $env:GITHUB_ACTIONS,
    "true",
    [System.StringComparison]::OrdinalIgnoreCase
)
if ($isGithubActions) {
    throw "Controlled Windows verification cannot run in hosted GitHub Actions."
}

$summarizer = Join-Path $PSScriptRoot "summarize-windows-audio-performance.ps1"
$collector = Join-Path $PSScriptRoot "collect-virtual-mic-verification-evidence.ps1"
if (-not (Test-Path -LiteralPath $summarizer -PathType Leaf)) {
    throw "Performance summarizer was not found."
}
if (-not (Test-Path -LiteralPath $collector -PathType Leaf)) {
    throw "Verification evidence collector was not found."
}

# The summarizer is a PowerShell script and reports validation failures by
# terminating errors. Do not inspect $LASTEXITCODE here because no native child
# process is required and that variable may contain a stale value.
& $summarizer `
    -InputFile $PerformanceSamplesFile `
    -OutputFile $PerformanceSummaryFile

$collectorArguments = @{
    SmokeExecutable = $SmokeExecutable
    PackageDirectory = $PackageDirectory
    ControlledChecksFile = $ControlledChecksFile
    PerformanceMeasurementsFile = $PerformanceSummaryFile
    OutputFile = $OutputFile
    ControlledMachine = $true
}
if (-not [string]::IsNullOrWhiteSpace($RepositorySha)) {
    $collectorArguments.RepositorySha = $RepositorySha
}

& $collector @collectorArguments
$collectorExitCode = $LASTEXITCODE
if ($collectorExitCode -ne 0) {
    exit $collectorExitCode
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$evidencePath = if ([System.IO.Path]::IsPathRooted($OutputFile)) {
    [System.IO.Path]::GetFullPath($OutputFile)
}
else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputFile))
}
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) {
    throw "Verification collector completed without producing evidence."
}

$rawEvidence = Get-Content -LiteralPath $evidencePath -Raw -Encoding UTF8
if ($rawEvidence.Length -gt 131072) {
    throw "Verification evidence exceeds the 128 KiB review boundary."
}
$evidence = $rawEvidence | ConvertFrom-Json
$expectedFields = @(
    "schema_version",
    "generated_at",
    "scope",
    "evidence_state",
    "repository_sha",
    "host",
    "runtime_smoke",
    "package",
    "controlled_checks",
    "performance_measurements",
    "nfr_aud_002_target_met",
    "acceptance_evidence_candidate",
    "completion_claim"
) | Sort-Object
$actualFields = @($evidence.PSObject.Properties.Name | Sort-Object)
if (($actualFields -join "|") -ne ($expectedFields -join "|")) {
    throw "Verification evidence contains missing or unsupported fields."
}

if ($evidence.scope -ne "controlled_machine") {
    throw "Verification evidence did not preserve controlled_machine scope."
}
if ($evidence.completion_claim -ne $false) {
    throw "Verification evidence must never claim WU-002 completion."
}
if ($null -eq $evidence.controlled_checks -or $null -eq $evidence.performance_measurements) {
    throw "Controlled verification evidence is missing required check or performance data."
}
if ($evidence.controlled_checks.test_run_id -ne $evidence.performance_measurements.test_run_id) {
    throw "Controlled verification evidence contains mismatched test_run_id values."
}

if (-not [bool]$evidence.acceptance_evidence_candidate) {
    Write-Error "Controlled verification completed but did not produce an acceptance evidence candidate. Review the emitted content-safe evidence."
    exit 3
}

Write-Host "Controlled Windows audio verification produced an acceptance evidence candidate."
Write-Host "WU-002 completion remains a separate reviewed decision and is not claimed by this runner."
exit 0

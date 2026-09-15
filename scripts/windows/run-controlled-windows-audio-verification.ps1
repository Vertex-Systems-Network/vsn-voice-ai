[CmdletBinding()]
param(
    [string]$SmokeExecutable = "artifacts/virtual_mic_installed_runtime_smoke.exe",
    [string]$PackageDirectory = "artifacts/vsn-virtual-mic-test-package",
    [Parameter(Mandatory = $true)][string]$ControlledChecksFile,
    [Parameter(Mandatory = $true)][string]$PerformanceSamplesFile,
    [string]$PerformanceSummaryFile = "artifacts/windows-audio-performance-measurements.json",
    [string]$OutputFile = "artifacts/windows-audio-verification-evidence.json",
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$RepositorySha
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RepositoryPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $script:repoRoot $Path))
}

function Resolve-InstalledVirtualMicDriverPath {
    $serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\VsnVirtualMic"
    if (-not (Test-Path -LiteralPath $serviceKey)) {
        throw "Installed VSN virtual microphone service was not found."
    }

    $service = Get-ItemProperty -LiteralPath $serviceKey -Name ImagePath -ErrorAction Stop
    $rawImagePath = [string]$service.ImagePath
    if ([string]::IsNullOrWhiteSpace($rawImagePath)) {
        throw "Installed VSN virtual microphone service has no driver image path."
    }

    $candidate = [System.Environment]::ExpandEnvironmentVariables($rawImagePath).Trim()
    if ($candidate.StartsWith('"') -and $candidate.EndsWith('"')) {
        $candidate = $candidate.Substring(1, $candidate.Length - 2)
    }
    if ($candidate.StartsWith("\??\", [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = $candidate.Substring(4)
    }
    elseif ($candidate.StartsWith("\\?\", [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = $candidate.Substring(4)
    }

    if ($candidate.StartsWith("\SystemRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = Join-Path $env:SystemRoot $candidate.Substring("\SystemRoot\".Length)
    }
    elseif ($candidate.StartsWith("System32\", [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = Join-Path $env:SystemRoot $candidate
    }

    if (-not [System.IO.Path]::IsPathRooted($candidate) -or
        -not $candidate.EndsWith(".sys", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Installed VSN virtual microphone driver image path is not an absolute .sys path."
    }

    $resolved = [System.IO.Path]::GetFullPath($candidate)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Installed VSN virtual microphone driver binary was not found."
    }
    return $resolved
}

$isGithubActions = [string]::Equals(
    $env:GITHUB_ACTIONS,
    "true",
    [System.StringComparison]::OrdinalIgnoreCase
)
if ($isGithubActions) {
    $isSelfHosted = [string]::Equals(
        $env:RUNNER_ENVIRONMENT,
        "self-hosted",
        [System.StringComparison]::OrdinalIgnoreCase
    )
    if (-not $isSelfHosted) {
        throw "Controlled Windows verification can run in GitHub Actions only on an explicitly targeted self-hosted runner."
    }

    $isWindowsRunner = [string]::Equals(
        $env:RUNNER_OS,
        "Windows",
        [System.StringComparison]::OrdinalIgnoreCase
    )
    if (-not $isWindowsRunner) {
        throw "Controlled Windows verification requires a Windows self-hosted runner."
    }

    $isX64Runner = [string]::Equals(
        $env:RUNNER_ARCH,
        "X64",
        [System.StringComparison]::OrdinalIgnoreCase
    )
    if (-not $isX64Runner) {
        throw "Controlled Windows verification requires an X64 self-hosted runner."
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$packagePath = Resolve-RepositoryPath -Path $PackageDirectory
$packageDriverPath = Join-Path $packagePath "vsn_virtual_mic_control.sys"
if (-not (Test-Path -LiteralPath $packageDriverPath -PathType Leaf)) {
    throw "Verified VSN virtual microphone package driver binary was not found."
}
$installedDriverPath = Resolve-InstalledVirtualMicDriverPath
$packageDriverHash = (Get-FileHash -LiteralPath $packageDriverPath -Algorithm SHA256).Hash
$installedDriverHash = (Get-FileHash -LiteralPath $installedDriverPath -Algorithm SHA256).Hash
if (-not [string]::Equals(
        $packageDriverHash,
        $installedDriverHash,
        [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Installed VSN virtual microphone driver binary does not match the verified package for this controlled run."
}

$normalizedRepositorySha = $RepositorySha.ToLowerInvariant()
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
    RepositorySha = $normalizedRepositorySha
    ControlledMachine = $true
}

& $collector @collectorArguments
$collectorExitCode = $LASTEXITCODE
if ($collectorExitCode -ne 0) {
    exit $collectorExitCode
}

$evidencePath = Resolve-RepositoryPath -Path $OutputFile
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
if ($evidence.repository_sha -ne $normalizedRepositorySha) {
    throw "Verification evidence repository_sha does not match the controlled run revision."
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

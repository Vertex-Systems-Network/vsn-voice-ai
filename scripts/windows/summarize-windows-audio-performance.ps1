[CmdletBinding()]
param(
    [string]$InputFile = "artifacts/windows-audio-performance-samples.json",
    [string]$OutputFile = "artifacts/windows-audio-performance-measurements.json"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))

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

function Read-BoundedSamples {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][double]$Maximum
    )

    $items = @($Value)
    if ($items.Count -lt 20 -or $items.Count -gt 10000) {
        throw "$Name must contain between 20 and 10000 numeric samples."
    }
    $safe = [System.Collections.Generic.List[double]]::new($items.Count)
    foreach ($item in $items) {
        if (-not (Test-JsonNumber -Value $item)) {
            throw "$Name contains a non-numeric sample."
        }
        $number = [double]$item
        if ($number -lt 0.0 -or $number -gt $Maximum) {
            throw "$Name contains an out-of-range sample."
        }
        $safe.Add($number)
    }
    return $safe.ToArray()
}

function Get-NearestRankP95 {
    param([Parameter(Mandatory = $true)][double[]]$Values)

    if ($Values.Count -lt 1) {
        throw "Cannot summarize an empty sample set."
    }
    $sorted = [double[]]@($Values | Sort-Object)
    $rank = [int][Math]::Ceiling(0.95 * $sorted.Count)
    $index = [Math]::Max(0, $rank - 1)
    return [double]$sorted[$index]
}

$inputPath = Resolve-InputPath -Value $InputFile
$raw = Get-Content -LiteralPath $inputPath -Raw -Encoding UTF8
if ($raw.Length -gt 2097152) {
    throw "InputFile exceeds the 2 MiB numeric-sample limit."
}
$input = $raw | ConvertFrom-Json
Assert-ExactObjectKeys -Object $input -Expected @(
    "schema_version",
    "test_run_id",
    "hardware_profile_id",
    "sample_rate_hz",
    "frame_duration_ms",
    "measurement_window_seconds",
    "processed_path_latency_ms",
    "callback_jitter_ms",
    "safe_bypass_transition_ms",
    "provider_path",
    "network_profile"
) -Context "performance samples"

if ($input.schema_version -ne 1) {
    throw "Performance samples schema_version must be 1."
}
if ($input.test_run_id -isnot [string] -or $input.test_run_id -notmatch '^[A-Za-z0-9._-]{1,64}$') {
    throw "Performance samples test_run_id is invalid."
}
if ($input.hardware_profile_id -isnot [string] -or $input.hardware_profile_id -notmatch '^[a-z0-9._-]{1,96}$') {
    throw "Performance samples hardware_profile_id is invalid."
}
if (-not (Test-JsonInteger -Value $input.sample_rate_hz) -or [long]$input.sample_rate_hz -lt 8000 -or [long]$input.sample_rate_hz -gt 192000) {
    throw "Performance samples sample_rate_hz is out of range."
}
if (-not (Test-JsonInteger -Value $input.frame_duration_ms) -or [long]$input.frame_duration_ms -lt 1 -or [long]$input.frame_duration_ms -gt 100) {
    throw "Performance samples frame_duration_ms is out of range."
}
if (-not (Test-JsonNumber -Value $input.measurement_window_seconds) -or [double]$input.measurement_window_seconds -le 0 -or [double]$input.measurement_window_seconds -gt 3600) {
    throw "Performance samples measurement_window_seconds is out of range."
}
if ($input.provider_path -ne "not_applicable" -or $input.network_profile -ne "not_applicable") {
    throw "WU-002 local virtual-mic samples must mark provider and network as not_applicable."
}

$processed = Read-BoundedSamples -Value $input.processed_path_latency_ms -Name "processed_path_latency_ms" -Maximum 10000
$jitter = Read-BoundedSamples -Value $input.callback_jitter_ms -Name "callback_jitter_ms" -Maximum 1000
$bypass = Read-BoundedSamples -Value $input.safe_bypass_transition_ms -Name "safe_bypass_transition_ms" -Maximum 10000
if ($processed.Count -ne $jitter.Count -or $processed.Count -ne $bypass.Count) {
    throw "All performance sample arrays must contain the same number of observations."
}

$outputPath = Resolve-ContainedArtifactPath -Value $OutputFile
$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$summary = [ordered]@{
    schema_version = 1
    test_run_id = $input.test_run_id
    hardware_profile_id = $input.hardware_profile_id
    sample_rate_hz = [int]$input.sample_rate_hz
    frame_duration_ms = [int]$input.frame_duration_ms
    sample_count = [int]$processed.Count
    measurement_window_seconds = [double]$input.measurement_window_seconds
    processed_path_latency_p95_ms = Get-NearestRankP95 -Values $processed
    callback_jitter_p95_ms = Get-NearestRankP95 -Values $jitter
    safe_bypass_transition_p95_ms = Get-NearestRankP95 -Values $bypass
    provider_path = "not_applicable"
    network_profile = "not_applicable"
}

$json = $summary | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($outputPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "Windows audio performance summary written: $outputPath"
Write-Host "Samples: $($processed.Count); deterministic nearest-rank p95 values emitted; no acceptance or completion claim was made."

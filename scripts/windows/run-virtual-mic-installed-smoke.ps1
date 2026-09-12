[CmdletBinding()]
param(
    [string]$Executable = "artifacts/virtual_mic_installed_runtime_smoke.exe",
    [switch]$AllowVerificationRequired
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$exePath = [System.IO.Path]::GetFullPath($Executable)
if (-not (Test-Path $exePath)) {
    throw "Installed virtual-mic smoke executable was not found: $exePath"
}

$output = @(& $exePath 2>&1)
$exitCode = $LASTEXITCODE
$output | ForEach-Object { Write-Host $_ }

$joined = $output -join "`n"
if ($exitCode -eq 0) {
    if ($joined -notmatch '"status":"passed"') {
        throw "Runtime smoke returned success without a passed status payload."
    }
    Write-Host "Installed VSN virtual microphone runtime smoke passed."
    exit 0
}

if ($exitCode -eq 2) {
    if ($joined -notmatch '"status":"verification_required"') {
        throw "Runtime smoke used verification-required exit code without the required status payload."
    }
    if ($AllowVerificationRequired) {
        Write-Host "Installed runtime verification is still required; classification behavior was verified."
        exit 0
    }
    Write-Error "Installed VSN virtual microphone runtime verification is required on a controlled elevated Windows test machine."
    exit 2
}

throw "Installed VSN virtual microphone runtime smoke failed with exit code $exitCode."

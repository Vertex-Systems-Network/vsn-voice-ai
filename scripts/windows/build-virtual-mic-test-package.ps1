[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DriverBinary,

    [string]$OutputDirectory = "artifacts/vsn-virtual-mic-test-package",

    [string]$CertificateThumbprint = "",

    [string]$Inf2CatOs = "10_VB_X64,10_CO_X64,10_NI_X64,10_GE_X64,10_25H2_X64"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$restoredWdkRoot = Join-Path $repoRoot "native\windows-virtual-mic\driver\packages"
$systemKitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"

function Resolve-WindowsKitTool {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    $searchRoots = @($restoredWdkRoot, $systemKitsRoot)
    foreach ($root in $searchRoots) {
        if (-not (Test-Path $root)) {
            continue
        }

        $candidates = @(Get-ChildItem $root -Recurse -File -Filter $Name -ErrorAction SilentlyContinue)
        if ($candidates.Count -eq 0) {
            continue
        }

        # Prefer an x64-hosted tool when the package exposes architecture-specific
        # copies. Fall back to any restored SDK/WDK copy so NuGet layouts that use
        # a neutral tools directory remain supported.
        $candidate = $candidates |
            Where-Object { $_.FullName -match "\\x64\\" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($null -eq $candidate) {
            $candidate = $candidates |
                Sort-Object FullName -Descending |
                Select-Object -First 1
        }
        if ($null -ne $candidate) {
            Write-Host "Resolved $Name from $($candidate.FullName)"
            return $candidate.FullName
        }
    }

    throw "$Name was not found in PATH or search roots: $($searchRoots -join '; ')"
}

$driverPath = (Resolve-Path $DriverBinary).Path
$infPath = Join-Path $repoRoot "native\windows-virtual-mic\package\vsn_virtual_mic.inf"
if (-not (Test-Path $infPath)) {
    throw "VSN virtual microphone INF was not found: $infPath"
}

$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
if (Test-Path $outputPath) {
    Remove-Item $outputPath -Recurse -Force
}
New-Item -ItemType Directory -Path $outputPath | Out-Null

Copy-Item $infPath (Join-Path $outputPath "vsn_virtual_mic.inf")
Copy-Item $driverPath (Join-Path $outputPath "vsn_virtual_mic_control.sys")

$infVerif = Resolve-WindowsKitTool "infverif.exe"
$inf2Cat = Resolve-WindowsKitTool "inf2cat.exe"

& $infVerif /w (Join-Path $outputPath "vsn_virtual_mic.inf")
if ($LASTEXITCODE -ne 0) {
    throw "InfVerif rejected the VSN virtual microphone INF (exit $LASTEXITCODE)."
}

& $inf2Cat "/driver:$outputPath" "/os:$Inf2CatOs" /verbose
if ($LASTEXITCODE -ne 0) {
    throw "Inf2Cat rejected the VSN virtual microphone package (exit $LASTEXITCODE)."
}

$catalogPath = Join-Path $outputPath "vsn_virtual_mic.cat"
if (-not (Test-Path $catalogPath)) {
    throw "Inf2Cat completed without creating vsn_virtual_mic.cat"
}

if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    $signTool = Resolve-WindowsKitTool "signtool.exe"
    $normalizedThumbprint = $CertificateThumbprint.Replace(" ", "")
    & $signTool sign /v /fd SHA256 /sha1 $normalizedThumbprint $catalogPath
    if ($LASTEXITCODE -ne 0) {
        throw "SignTool could not test-sign the package catalog (exit $LASTEXITCODE)."
    }
}

Write-Host "VSN virtual microphone test package ready: $outputPath"
Write-Host "Production signing is intentionally not performed by this script."

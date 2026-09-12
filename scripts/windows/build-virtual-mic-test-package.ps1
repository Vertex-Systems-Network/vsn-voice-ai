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

function Resolve-WindowsKitTool {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (-not (Test-Path $kitsRoot)) {
        throw "Windows Kits bin directory was not found: $kitsRoot"
    }

    $candidate = Get-ChildItem $kitsRoot -Recurse -File -Filter $Name |
        Where-Object { $_.FullName -match "\\x64\\|\\x86\\" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($null -eq $candidate) {
        throw "$Name was not found under $kitsRoot"
    }
    return $candidate.FullName
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
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

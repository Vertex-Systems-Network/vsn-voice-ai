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
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
$trustedWdkPackageVersion = "10.0.28000.2526"
$trustedWdkPackageRoot = Join-Path $restoredWdkRoot "Microsoft.Windows.WDK.x64.$trustedWdkPackageVersion"
$trustedInf2CatPath = Join-Path $trustedWdkPackageRoot "c\bin\10.0.28000.0\x86\Inf2Cat.exe"
$trustedInf2CatSha256 = "82c302fc9069783674b51665ce80e769f8500db7fc737a4b8a3773c521950b86"

function Test-MicrosoftSignedExecutable {
    param([Parameter(Mandatory = $true)][string]$Path)

    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        return $false
    }
    if ($null -eq $signature.SignerCertificate) {
        return $false
    }
    return [string]$signature.SignerCertificate.Subject -match '(?i)(?:^|,\s*)O=Microsoft Corporation(?:,|$)'
}

function Resolve-PinnedInf2Cat {
    if (-not (Test-Path -LiteralPath $trustedInf2CatPath -PathType Leaf)) {
        throw "Pinned Inf2Cat was not found in Microsoft.Windows.WDK.x64 $trustedWdkPackageVersion."
    }

    $digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $trustedInf2CatPath).Hash.ToLowerInvariant()
    if ($digest -ne $trustedInf2CatSha256) {
        throw "Pinned Inf2Cat SHA-256 did not match the approved Microsoft WDK binary."
    }

    Write-Host "Resolved inf2cat.exe from pinned Microsoft WDK package with verified SHA-256."
    return $trustedInf2CatPath
}

function Resolve-WindowsKitTool {
    param([Parameter(Mandatory = $true)][string]$Name)

    if ([string]::Equals($Name, "inf2cat.exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        return Resolve-PinnedInf2Cat
    }

    # Security boundary: never trust ambient PATH for verification/signing
    # tooling. Other WDK tools must come from the restored WDK tree or the
    # standard Windows Kits root and carry a valid Microsoft Authenticode
    # signature before execution.
    $searchRoots = @($restoredWdkRoot, $systemKitsRoot)
    foreach ($root in $searchRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) {
            continue
        }

        $candidates = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $Name -ErrorAction SilentlyContinue)
        if ($candidates.Count -eq 0) {
            continue
        }

        $orderedCandidates = @(
            $candidates |
                Sort-Object @{ Expression = { if ($_.FullName -match "\\x64\\") { 0 } else { 1 } } }, FullName
        )
        foreach ($candidate in $orderedCandidates) {
            if (-not (Test-MicrosoftSignedExecutable -Path $candidate.FullName)) {
                continue
            }
            Write-Host "Resolved $Name from Microsoft-signed WDK tool: $($candidate.FullName)"
            return $candidate.FullName
        }
    }

    throw "$Name was not found as a valid Microsoft-signed executable in trusted WDK roots: $($searchRoots -join '; ')"
}

function Resolve-ContainedOutputDirectory {
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
        throw "OutputDirectory must be a child of the repository artifacts directory."
    }
    return $candidate
}

$driverPath = (Resolve-Path -LiteralPath $DriverBinary).Path
$infPath = Join-Path $repoRoot "native\windows-virtual-mic\package\vsn_virtual_mic.inf"
if (-not (Test-Path -LiteralPath $infPath -PathType Leaf)) {
    throw "VSN virtual microphone INF was not found: $infPath"
}

$outputPath = Resolve-ContainedOutputDirectory -Value $OutputDirectory
if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

Copy-Item -LiteralPath $infPath -Destination (Join-Path $outputPath "vsn_virtual_mic.inf")
Copy-Item -LiteralPath $driverPath -Destination (Join-Path $outputPath "vsn_virtual_mic_control.sys")

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
if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) {
    throw "Inf2Cat completed without creating vsn_virtual_mic.cat"
}

if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    $normalizedThumbprint = $CertificateThumbprint.Replace(" ", "")
    if ($normalizedThumbprint -notmatch '^[A-Fa-f0-9]{40}$') {
        throw "CertificateThumbprint must normalize to exactly 40 hexadecimal characters."
    }
    $signTool = Resolve-WindowsKitTool "signtool.exe"
    & $signTool sign /v /fd SHA256 /sha1 $normalizedThumbprint $catalogPath
    if ($LASTEXITCODE -ne 0) {
        throw "SignTool could not test-sign the package catalog (exit $LASTEXITCODE)."
    }
}

Write-Host "VSN virtual microphone test package ready: $outputPath"
Write-Host "Production signing is intentionally not performed by this script."

[CmdletBinding()]
param(
    [string]$PackageDirectory = "artifacts/vsn-virtual-mic-test-package",

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$DriverBinarySha256,

    [Parameter(Mandatory = $true)]
    [string]$DevConPath,

    [string]$SmokeExecutable = "artifacts/virtual_mic_installed_runtime_smoke.exe",

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$SmokeExecutableSha256,

    [string]$EvidencePath = "artifacts/virtual-mic-controlled-install-evidence.json",

    [ValidateRange(1, 30)]
    [int]$SmokeAttempts = 10,

    [ValidateRange(0, 5)]
    [int]$SmokeDelaySeconds = 1,

    [switch]$KeepInstalled
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
$canonicalInf = Join-Path $repoRoot "native\windows-virtual-mic\package\vsn_virtual_mic.inf"
$hardwareId = "ROOT\VSNVIRTUALMIC"
$deviceInstallAttempted = $false
$finalExitCode = 1
$evidenceFile = Join-Path $artifactsRoot "virtual-mic-controlled-install-evidence.json"

$evidence = [ordered]@{
    schema_version = 1
    status = "failed"
    reason = "not_started"
    observed_at_utc = $null
    hardware_id = $hardwareId
    package_hashes = [ordered]@{
        inf_sha256 = $null
        sys_sha256 = $null
        cat_sha256 = $null
        smoke_sha256 = $null
    }
    catalog = [ordered]@{
        signature_status = $null
        signer_thumbprint = $null
    }
    staging = [ordered]@{
        exit_code = $null
    }
    install = [ordered]@{
        exit_code = $null
        restart_required = $false
    }
    smoke = [ordered]@{
        attempts = 0
        status = $null
        reason = $null
        system_error = $null
    }
    cleanup = [ordered]@{
        requested = (-not $KeepInstalled.IsPresent)
        attempted = $false
        succeeded = $null
        exit_code = $null
    }
}

function Set-Failure {
    param([Parameter(Mandatory = $true)][string]$Reason)

    $script:evidence.status = "failed"
    $script:evidence.reason = $Reason
    $script:finalExitCode = 1
}

function Set-VerificationRequired {
    param([Parameter(Mandatory = $true)][string]$Reason)

    $script:evidence.status = "verification_required"
    $script:evidence.reason = $Reason
    $script:finalExitCode = 2
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
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
        throw [System.ArgumentException]::new("path_outside_artifacts")
    }
    return $candidate
}

function Test-MicrosoftDevConIdentity {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not [string]::Equals(
        [System.IO.Path]::GetFileName($Path),
        "devcon.exe",
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        return $false
    }

    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    if (-not [string]::Equals(
        [string]$file.VersionInfo.OriginalFilename,
        "devcon.exe",
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        return $false
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if (
        $signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate
    ) {
        return $false
    }

    return [string]$signature.SignerCertificate.Subject -match '(?i)(?:^|,\s*)O=Microsoft Corporation(?:,|$)'
}

function Get-SafeSmokePayload {
    param([Parameter(Mandatory = $true)][object[]]$Output)

    $jsonLine = $Output |
        ForEach-Object { [string]$_ } |
        Where-Object { $_ -match '^\s*\{.*\}\s*$' } |
        Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($jsonLine)) {
        return $null
    }

    try {
        $payload = $jsonLine | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return $null
    }

    if ($payload.status -notin @("passed", "failed", "verification_required")) {
        return $null
    }
    if ([string]$payload.reason -notmatch '^[a-z0-9_]{1,64}$') {
        return $null
    }

    [uint32]$systemError = 0
    if (-not [uint32]::TryParse([string]$payload.system_error, [ref]$systemError)) {
        return $null
    }

    return [pscustomobject]@{
        status = [string]$payload.status
        reason = [string]$payload.reason
        system_error = [uint32]$systemError
    }
}

try {
    if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
        Set-Failure "windows_required"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Set-Failure "administrator_required"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    try {
        $packagePath = Resolve-ContainedArtifactPath -Value $PackageDirectory
    }
    catch {
        Set-Failure "package_path_not_allowed"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }
    try {
        $requestedEvidencePath = Resolve-ContainedArtifactPath -Value $EvidencePath
        if (-not [string]::Equals(
            [System.IO.Path]::GetExtension($requestedEvidencePath),
            ".json",
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw [System.ArgumentException]::new("evidence_extension_not_json")
        }
        $evidenceFile = $requestedEvidencePath
    }
    catch {
        Set-Failure "evidence_path_not_allowed"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    $devcon = [System.IO.Path]::GetFullPath($DevConPath)
    $smoke = [System.IO.Path]::GetFullPath($SmokeExecutable)

    $inf = Join-Path $packagePath "vsn_virtual_mic.inf"
    $sys = Join-Path $packagePath "vsn_virtual_mic_control.sys"
    $cat = Join-Path $packagePath "vsn_virtual_mic.cat"

    foreach ($requiredFile in @($canonicalInf, $inf, $sys, $cat, $devcon, $smoke)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            Set-Failure "required_file_missing"
            throw [System.InvalidOperationException]::new("controlled_install_stopped")
        }
    }

    if (-not (Test-MicrosoftDevConIdentity $devcon)) {
        Set-Failure "devcon_identity_not_valid"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    $evidence.package_hashes.inf_sha256 = Get-Sha256 $inf
    $evidence.package_hashes.sys_sha256 = Get-Sha256 $sys
    $evidence.package_hashes.cat_sha256 = Get-Sha256 $cat
    $evidence.package_hashes.smoke_sha256 = Get-Sha256 $smoke
    if ($evidence.package_hashes.inf_sha256 -ne (Get-Sha256 $canonicalInf)) {
        Set-Failure "package_inf_mismatch"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }
    if ($evidence.package_hashes.sys_sha256 -ne $DriverBinarySha256.ToLowerInvariant()) {
        Set-Failure "driver_hash_mismatch"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }
    if ($evidence.package_hashes.smoke_sha256 -ne $SmokeExecutableSha256.ToLowerInvariant()) {
        Set-Failure "smoke_hash_mismatch"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    $catalogSignature = Get-AuthenticodeSignature -LiteralPath $cat
    $evidence.catalog.signature_status = [string]$catalogSignature.Status
    if ($null -ne $catalogSignature.SignerCertificate) {
        $evidence.catalog.signer_thumbprint = $catalogSignature.SignerCertificate.Thumbprint
    }
    if ($catalogSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        Set-Failure "catalog_signature_not_valid"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    $systemDirectory = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::System)
    $pnputil = Join-Path $systemDirectory "pnputil.exe"
    if (-not (Test-Path -LiteralPath $pnputil -PathType Leaf)) {
        Set-Failure "system_pnputil_missing"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    & $pnputil /add-driver $inf
    $evidence.staging.exit_code = $LASTEXITCODE
    if ($LASTEXITCODE -ne 0) {
        Set-Failure "driver_store_staging_failed"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    $deviceInstallAttempted = $true
    & $devcon install $inf $hardwareId
    $evidence.install.exit_code = $LASTEXITCODE
    if ($LASTEXITCODE -eq 1) {
        $evidence.install.restart_required = $true
        Set-VerificationRequired "restart_required"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }
    if ($LASTEXITCODE -ne 0) {
        Set-Failure "root_device_install_failed"
        throw [System.InvalidOperationException]::new("controlled_install_stopped")
    }

    for ($attempt = 1; $attempt -le $SmokeAttempts; $attempt++) {
        $evidence.smoke.attempts = $attempt
        $output = @(& $smoke 2>&1)
        $smokeExitCode = $LASTEXITCODE
        $payload = Get-SafeSmokePayload $output
        if ($null -eq $payload) {
            Set-Failure "smoke_payload_invalid"
            break
        }

        $evidence.smoke.status = $payload.status
        $evidence.smoke.reason = $payload.reason
        $evidence.smoke.system_error = $payload.system_error

        if ($smokeExitCode -eq 0 -and $payload.status -eq "passed") {
            $evidence.status = "passed"
            $evidence.reason = "installed_runtime_verified"
            $finalExitCode = 0
            break
        }

        if ($smokeExitCode -eq 2 -and $payload.status -eq "verification_required") {
            if ($attempt -lt $SmokeAttempts) {
                if ($SmokeDelaySeconds -gt 0) {
                    Start-Sleep -Seconds $SmokeDelaySeconds
                }
                continue
            }
            Set-VerificationRequired "installed_runtime_not_ready"
            break
        }

        Set-Failure "installed_runtime_smoke_failed"
        break
    }
}
catch {
    if ($evidence.reason -eq "not_started") {
        Set-Failure "controlled_install_exception"
    }
}
finally {
    if (-not $KeepInstalled.IsPresent -and $deviceInstallAttempted) {
        $evidence.cleanup.attempted = $true
        try {
            & $devcon remove $hardwareId
            $evidence.cleanup.exit_code = $LASTEXITCODE
            $evidence.cleanup.succeeded = ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 1)
        }
        catch {
            $evidence.cleanup.succeeded = $false
        }

        if ($evidence.cleanup.succeeded -ne $true -and $evidence.status -eq "passed") {
            Set-Failure "cleanup_failed"
        }
    }

    $evidence.observed_at_utc = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $evidenceDirectory = Split-Path -Parent $evidenceFile
    if (-not [string]::IsNullOrWhiteSpace($evidenceDirectory)) {
        New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
    }
    $evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidenceFile -Encoding utf8
}

Write-Host "Controlled VSN virtual microphone install result: $($evidence.status) ($($evidence.reason))"
exit $finalExitCode

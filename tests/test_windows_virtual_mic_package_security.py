import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "windows" / "build-virtual-mic-test-package.ps1"


class WindowsVirtualMicPackageSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_verification_tools_do_not_resolve_from_ambient_path(self) -> None:
        self.assertNotIn("Get-Command $Name", self.source)
        self.assertIn("Get-AuthenticodeSignature -LiteralPath $Path", self.source)
        self.assertIn("SignatureStatus]::Valid", self.source)
        self.assertIn("O=Microsoft Corporation", self.source)

    def test_unsigned_inf2cat_is_exact_version_and_digest_pinned(self) -> None:
        self.assertIn('$trustedWdkPackageVersion = "10.0.28000.2526"', self.source)
        self.assertIn(
            '$trustedInf2CatSha256 = "82c302fc9069783674b51665ce80e769f8500db7fc737a4b8a3773c521950b86"',
            self.source,
        )
        self.assertIn('"c\\bin\\10.0.28000.0\\x86\\Inf2Cat.exe"', self.source)
        self.assertIn("Get-FileHash -Algorithm SHA256 -LiteralPath $trustedInf2CatPath", self.source)
        self.assertIn("if ($digest -ne $trustedInf2CatSha256)", self.source)

    def test_output_deletion_is_contained_under_artifacts(self) -> None:
        self.assertIn('Join-Path $repoRoot "artifacts"', self.source)
        self.assertIn("GetRelativePath($artifactsRoot, $candidate)", self.source)
        self.assertIn('throw "OutputDirectory must be a child of the repository artifacts directory."', self.source)
        self.assertIn("Remove-Item -LiteralPath $outputPath -Recurse -Force", self.source)

    def test_sensitive_files_are_addressed_literally(self) -> None:
        self.assertIn("Resolve-Path -LiteralPath $DriverBinary", self.source)
        self.assertIn("Test-Path -LiteralPath $infPath -PathType Leaf", self.source)
        self.assertIn("Copy-Item -LiteralPath $driverPath", self.source)

    def test_test_signing_thumbprint_is_strictly_validated(self) -> None:
        self.assertIn("CertificateThumbprint must normalize to exactly 40 hexadecimal characters", self.source)
        self.assertIn("'^[A-Fa-f0-9]{40}$'", self.source)


if __name__ == "__main__":
    unittest.main()

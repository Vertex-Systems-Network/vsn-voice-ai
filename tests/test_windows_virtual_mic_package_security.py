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
        self.assertIn("Microsoft Corporation", self.source)

    def test_output_deletion_is_contained_under_artifacts(self) -> None:
        self.assertIn('Join-Path $repoRoot "artifacts"', self.source)
        self.assertIn("GetRelativePath($artifactsRoot, $candidate)", self.source)
        self.assertIn('throw "OutputDirectory must be a child of the repository artifacts directory."', self.source)
        self.assertIn("Remove-Item -LiteralPath $outputPath -Recurse -Force", self.source)

    def test_sensitive_files_are_addressed_literally(self) -> None:
        self.assertIn("Resolve-Path -LiteralPath $DriverBinary", self.source)
        self.assertIn("Test-Path -LiteralPath $infPath -PathType Leaf", self.source)
        self.assertIn("Copy-Item -LiteralPath $driverPath", self.source)


if __name__ == "__main__":
    unittest.main()

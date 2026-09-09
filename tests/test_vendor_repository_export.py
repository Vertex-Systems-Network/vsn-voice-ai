from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import export_vendor_repositories as exporter


class VendorRepositoryExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.source = self.base / "source"
        self.output = self.base / "exports"
        self.source.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.email", "tests@example.invalid")
        self.git("config", "user.name", "ANPOS Tests")
        self.write("README.md", "canonical\n")
        self.write("scripts/bootstrap_child.py", "print('bootstrap')\n")
        self.write("scripts/vendor-operator.py", "print('vendor only')\n")
        self.write("commercial-service/package.json", '{"name":"service","version":"0.2.1"}\n')
        self.write("commercial-service/.env.example", "DATABASE_URL=\n")
        self.write(
            "config/licensing/vendor-source-boundary.json",
            json.dumps(
                {
                    "schema_version": 1,
                    "status": "template_blueprint",
                    "activation_scope": "canonical_vendor_source_management_only",
                    "vendor_only_paths": ["commercial-service", "scripts/vendor-operator.py"],
                },
                indent=2,
            )
            + "\n",
        )
        self.git("add", ".")
        self.git("commit", "-m", "fixture")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args], cwd=self.source, check=True, text=True, capture_output=True
        )

    def write(self, relative: str, content: str) -> Path:
        target = self.source / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
        return target

    def manifest(self, repository: Path) -> dict[str, object]:
        return json.loads((repository / exporter.MANIFEST_NAME).read_text(encoding="utf-8"))

    def test_service_export_strips_prefix_and_uses_committed_blob_provenance(self) -> None:
        outputs = exporter.export_repositories(self.source, self.output, modes=("service",))
        service = outputs["service"]
        self.assertTrue((service / "package.json").is_file())
        self.assertFalse((service / "commercial-service").exists())
        self.assertEqual((service / "package.json").read_text(encoding="utf-8"), '{"name":"service","version":"0.2.1"}\n')
        manifest = self.manifest(service)
        self.assertEqual(manifest["export_mode"], "service")
        self.assertEqual(manifest["source_material"], "committed_git_blobs_at_head")
        package = next(item for item in manifest["files"] if item["path"] == "package.json")
        self.assertEqual(package["origin"], "commercial-service/package.json")
        self.assertEqual(package["git_mode"], "100644")
        self.assertEqual(len(package["git_object"]), 40)

    def test_template_export_excludes_all_vendor_only_paths(self) -> None:
        outputs = exporter.export_repositories(self.source, self.output, modes=("template",))
        template = outputs["template"]
        self.assertTrue((template / "README.md").is_file())
        self.assertTrue((template / "scripts/bootstrap_child.py").is_file())
        self.assertFalse((template / "commercial-service").exists())
        self.assertFalse((template / "scripts/vendor-operator.py").exists())
        manifest = self.manifest(template)
        self.assertEqual(manifest["source_scope"], "canonical-minus-vendor-only-paths")
        origins = {str(item["origin"]) for item in manifest["files"]}
        self.assertFalse(any(origin.startswith("commercial-service/") for origin in origins))
        self.assertNotIn("scripts/vendor-operator.py", origins)

    def test_untracked_secret_is_never_exported(self) -> None:
        self.write("commercial-service/.env", "DATABASE_URL=secret\n")
        outputs = exporter.export_repositories(self.source, self.output, modes=("service",))
        service = outputs["service"]
        self.assertFalse((service / ".env").exists())
        manifest = self.manifest(service)
        self.assertFalse(manifest["contains_secrets"])
        self.assertNotIn(".env", {item["path"] for item in manifest["files"]})
        self.assertNotIn("commercial-service/.env", {item["origin"] for item in manifest["files"]})

    def test_tracked_secret_like_file_fails_closed(self) -> None:
        self.write("commercial-service/.env.production", "DATABASE_URL=secret\n")
        self.git("add", "commercial-service/.env.production")
        self.git("commit", "-m", "unsafe fixture")
        with self.assertRaisesRegex(exporter.ExportError, r"secret-like (tracked file|export target)"):
            exporter.export_repositories(self.source, self.output, modes=("service",))
        self.assertFalse((self.output / exporter.SERVICE_REPOSITORY_NAME).exists())

    def test_dirty_tracked_tree_rejected_but_override_still_exports_head_blob(self) -> None:
        package = self.source / "commercial-service/package.json"
        package.write_text('{"name":"service","version":"DIRTY"}\n', encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(exporter.ExportError, "tracked working tree is dirty"):
            exporter.export_repositories(self.source, self.output, modes=("service",))

        outputs = exporter.export_repositories(
            self.source,
            self.output,
            modes=("service",),
            allow_dirty_tracked=True,
        )
        exported = (outputs["service"] / "package.json").read_text(encoding="utf-8")
        self.assertIn('"0.2.1"', exported)
        self.assertNotIn("DIRTY", exported)

    def test_existing_target_is_non_destructive(self) -> None:
        target = self.output / exporter.SERVICE_REPOSITORY_NAME
        target.mkdir(parents=True)
        sentinel = target / "KEEP.txt"
        sentinel.write_text("keep\n", encoding="utf-8")
        with self.assertRaisesRegex(exporter.ExportError, "export target already exists"):
            exporter.export_repositories(self.source, self.output, modes=("service",))
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep\n")

    def test_output_inside_canonical_repository_is_refused(self) -> None:
        with self.assertRaisesRegex(exporter.ExportError, "outside the canonical source repository"):
            exporter.export_repositories(self.source, self.source / "exports", modes=("service",))

    def test_invalid_committed_vendor_boundary_fails_closed(self) -> None:
        self.write("config/licensing/vendor-source-boundary.json", '{"activation_scope":"wrong","vendor_only_paths":["commercial-service"]}\n')
        self.git("add", "config/licensing/vendor-source-boundary.json")
        self.git("commit", "-m", "invalid boundary fixture")
        with self.assertRaisesRegex(exporter.ExportError, "activation_scope is invalid"):
            exporter.export_repositories(self.source, self.output, modes=("template",))

    @unittest.skipIf(os.name == "nt", "symlink fixture requires POSIX semantics")
    def test_committed_symlink_is_refused(self) -> None:
        link = self.source / "commercial-service/link"
        link.symlink_to("package.json")
        self.git("add", "commercial-service/link")
        self.git("commit", "-m", "symlink fixture")
        with self.assertRaisesRegex(exporter.ExportError, "symlink export is refused"):
            exporter.export_repositories(self.source, self.output, modes=("service",))


if __name__ == "__main__":
    unittest.main()

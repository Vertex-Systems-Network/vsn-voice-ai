from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "render_operator_launch_bootstrap.py"


def load_renderer():
    name = "render_operator_launch_bootstrap"
    spec = importlib.util.spec_from_file_location(name, SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class OperatorLaunchBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.renderer = load_renderer()
        self.inputs = self.renderer.Inputs(
            organization="Vertex-Systems-Network",
            service_base_url="https://license.example.test",
            homepage_url="https://example.test/anpos",
            marketplace_app_name="ANPOS Marketplace Test",
            vendor_app_name="ANPOS Vendor Test",
            collaborator_provisioning=False,
        )

    def query(self, url: str) -> dict[str, list[str]]:
        return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)

    def test_marketplace_registration_is_public_and_uses_narrow_community_audit_permissions(self) -> None:
        data = self.renderer.render(self.inputs)
        marketplace = data["github_apps"]["marketplace"]
        query = self.query(marketplace["registration_url"])
        self.assertTrue(marketplace["public"])
        self.assertEqual(query["public"], ["true"])
        self.assertEqual(query["webhook_active"], ["false"])
        self.assertNotIn("events[]", query)
        self.assertNotIn("webhook_url", query)
        self.assertFalse(marketplace["github_app_webhook_active"])
        self.assertEqual(marketplace["events"], [])
        self.assertEqual(
            marketplace["marketplace_listing_webhook"],
            {
                "configuration_surface": "github_marketplace_listing_webhook",
                "required": True,
                "event": "marketplace_purchase",
                "url": "https://license.example.test/api/webhooks/github/marketplace",
                "secret_environment_key": "GITHUB_WEBHOOK_SECRET",
            },
        )
        self.assertEqual(query["request_oauth_on_install"], ["false"])
        self.assertEqual(query["callback_urls[]"], ["https://license.example.test/api/auth/github/callback"])
        self.assertEqual(query["setup_url"], ["https://license.example.test/setup/github"])
        self.assertEqual(query["setup_on_update"], ["true"])
        self.assertEqual(marketplace["callback_url"], "https://license.example.test/api/auth/github/callback")
        self.assertEqual(marketplace["setup_url"], "https://license.example.test/setup/github")
        self.assertFalse(marketplace["request_oauth_on_install"])
        self.assertTrue(marketplace["setup_on_update"])
        self.assertEqual(marketplace["community_auth_flow"], "marketplace_setup_url_then_pkce_github_app_oauth")
        self.assertEqual(query["single_file"], ["read"])
        self.assertEqual(query["single_file_paths[]"], self.renderer.COMMUNITY_AUDIT_PATHS)
        self.assertEqual(marketplace["repository_permissions"], {"metadata": "read", "single_file": "read"})
        self.assertEqual(marketplace["single_file_paths"], self.renderer.COMMUNITY_AUDIT_PATHS)
        self.assertFalse(marketplace["community_audit_reads_application_source"])
        self.assertNotIn("administration", query)
        self.assertNotIn("contents", query)
        self.assertEqual(len(self.renderer.COMMUNITY_AUDIT_PATHS), 10)

    def test_vendor_registration_is_private_archive_only_by_default(self) -> None:
        data = self.renderer.render(self.inputs)
        vendor = data["github_apps"]["vendor_distribution"]
        query = self.query(vendor["registration_url"])
        self.assertFalse(vendor["public"])
        self.assertEqual(query["public"], ["false"])
        self.assertEqual(query["webhook_active"], ["false"])
        self.assertEqual(query["contents"], ["read"])
        self.assertNotIn("administration", query)
        self.assertEqual(vendor["permissions"], {"contents": "read", "metadata": "read"})

    def test_collaborator_mode_explicitly_adds_administration_write(self) -> None:
        inputs = self.renderer.Inputs(**{**self.inputs.__dict__, "collaborator_provisioning": True})
        data = self.renderer.render(inputs)
        vendor = data["github_apps"]["vendor_distribution"]
        query = self.query(vendor["registration_url"])
        self.assertEqual(query["administration"], ["write"])
        self.assertEqual(vendor["permissions"]["administration"], "write")

    def test_split_environment_contract_and_legacy_rejection_are_explicit(self) -> None:
        data = self.renderer.render(self.inputs)
        marketplace_keys = set(data["github_apps"]["marketplace"]["environment_keys"])
        vendor_keys = set(data["github_apps"]["vendor_distribution"]["environment_keys"])
        service_keys = set(data["service_environment_keys"])
        self.assertIn("GITHUB_MARKETPLACE_APP_ID", marketplace_keys)
        self.assertIn("GITHUB_MARKETPLACE_APP_PRIVATE_KEY", marketplace_keys)
        self.assertIn("GITHUB_MARKETPLACE_CLIENT_ID", marketplace_keys)
        self.assertIn("GITHUB_MARKETPLACE_CLIENT_SECRET", marketplace_keys)
        self.assertIn("GITHUB_VENDOR_APP_ID", vendor_keys)
        self.assertIn("GITHUB_VENDOR_APP_PRIVATE_KEY", vendor_keys)
        self.assertIn("ANPOS_PUBLIC_BASE_URL", service_keys)
        self.assertIn("ANPOS_SESSION_SECRET", service_keys)
        self.assertIn("ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID", service_keys)
        self.assertIn("ANPOS_MARKETPLACE_PLAN_MAP", service_keys)
        self.assertIn("ANPOS_COMMERCIAL_RELEASE_REF", service_keys)
        self.assertNotEqual("ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID", "ANPOS_MARKETPLACE_PLAN_MAP")
        sequence = "\n".join(data["operator_sequence"])
        self.assertIn("/api/ready/community", sequence)
        self.assertIn("Marketplace listing webhook", sequence)
        self.assertIn("marketplace_purchase", sequence)
        self.assertIn("keep Community outside ANPOS_MARKETPLACE_PLAN_MAP", sequence)
        self.assertIn("ANPOS_COMMERCIAL_RELEASE_REF", sequence)
        self.assertIn("exact 40-character commit SHA", sequence)
        self.assertIn("/api/v1/releases/current", sequence)
        self.assertIn("/api/v1/template/archive", sequence)
        self.assertIn("full /api/ready", sequence)
        safety = "\n".join(data["safety"])
        self.assertIn("mutable refs are forbidden", safety)
        self.assertEqual(
            data["legacy_single_app_environment_keys_forbidden"],
            ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"],
        )
        self.assertFalse(data["launch_authorized"])

    def test_artifact_identity_and_verifier_args_are_package_derived(self) -> None:
        data = self.renderer.render(self.inputs)
        package = json.loads((ROOT / "commercial-service/package.json").read_text(encoding="utf-8"))
        protocol = json.loads((ROOT / "config/protocol/version.json").read_text(encoding="utf-8"))
        expected = {
            "service": package["name"],
            "service_version": package["version"],
            "source_protocol_version": package["anpos"]["source_protocol_version"],
            "runtime_contract": package["anpos"]["runtime_contract"],
        }
        self.assertEqual(data["schema_version"], 6)
        self.assertEqual(data["artifact_identity"], expected)
        self.assertEqual(expected["source_protocol_version"], protocol["version"])
        self.assertEqual(
            data["production_verifier_arguments"],
            [
                "--require-ready",
                "--expected-service-version",
                package["version"],
                "--expected-protocol-version",
                protocol["version"],
            ],
        )
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn('"0.3.0"', source)
        self.assertNotIn('"0.3.1"', source)
        self.assertNotIn('"0.3.2"', source)

    def test_vendor_handoff_identity_is_git_derived_and_binds_both_exports(self) -> None:
        data = self.renderer.render(self.inputs)
        handoff = data["vendor_repository_handoff"]
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, text=True, capture_output=True
        ).stdout.strip()
        tree = subprocess.run(
            ["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, check=True, text=True, capture_output=True
        ).stdout.strip()
        package = json.loads((ROOT / "commercial-service/package.json").read_text(encoding="utf-8"))

        self.assertEqual(handoff["canonical_source_revision"], revision)
        self.assertEqual(handoff["canonical_source_tree"], tree)
        self.assertEqual(handoff["manifest_name"], "EXPORT-MANIFEST.json")
        self.assertEqual(handoff["verifier"], "scripts/verify_vendor_handoff.py")
        self.assertEqual(handoff["service_repository"], "anpos-commercial-service")
        self.assertEqual(handoff["template_repository"], "anpos-commercial-template")

        service_args = handoff["service_verification_arguments"]
        template_args = handoff["template_verification_arguments"]
        for args in (service_args, template_args):
            self.assertIn("--expected-source-revision", args)
            self.assertIn(revision, args)
            self.assertIn("--expected-source-tree", args)
            self.assertIn(tree, args)
        self.assertIn("--expected-mode", service_args)
        self.assertIn("service", service_args)
        self.assertIn("--expected-service-version", service_args)
        self.assertIn(package["version"], service_args)
        self.assertIn("--expected-protocol-version", service_args)
        self.assertIn(package["anpos"]["source_protocol_version"], service_args)
        self.assertIn("--expected-runtime-contract", service_args)
        self.assertIn(package["anpos"]["runtime_contract"], service_args)
        self.assertIn("template", template_args)
        self.assertNotIn("--expected-service-version", template_args)

    def test_source_export_identity_rejects_invalid_injected_sha(self) -> None:
        with self.assertRaisesRegex(self.renderer.BootstrapError, "invalid canonical_source_revision"):
            self.renderer.render(
                self.inputs,
                source_export_identity={
                    "canonical_source_revision": "not-a-sha",
                    "canonical_source_tree": "0" * 40,
                },
            )

    def test_artifact_identity_fails_closed_on_package_protocol_mismatch(self) -> None:
        package = json.loads((ROOT / "commercial-service/package.json").read_text(encoding="utf-8"))
        protocol = json.loads((ROOT / "config/protocol/version.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            package_path = Path(tmp) / "package.json"
            protocol_path = Path(tmp) / "version.json"
            package["anpos"]["source_protocol_version"] = "9.9.9"
            package_path.write_text(json.dumps(package), encoding="utf-8")
            protocol_path.write_text(json.dumps(protocol), encoding="utf-8")
            with self.assertRaisesRegex(self.renderer.BootstrapError, "does not match canonical protocol"):
                self.renderer.load_artifact_identity(package_path, protocol_path)

    def test_renderer_rejects_non_https_and_credential_bearing_urls(self) -> None:
        with self.assertRaises(self.renderer.BootstrapError):
            self.renderer.normalize_https_url("http://example.test", "service base URL")
        with self.assertRaises(self.renderer.BootstrapError):
            self.renderer.normalize_https_url("https://user:pass@example.test", "homepage URL")
        with self.assertRaises(self.renderer.BootstrapError):
            self.renderer.normalize_https_url("https://example.test/path?secret=value", "homepage URL")

    def test_cli_output_contains_no_secret_values_or_secret_cli_flags(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--organization",
                "Vertex-Systems-Network",
                "--service-base-url",
                "https://license.example.test",
                "--homepage-url",
                "https://example.test/anpos",
            ],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        data = json.loads(result.stdout)
        serialized = json.dumps(data, sort_keys=True)
        self.assertNotIn("BEGIN PRIVATE KEY", serialized)
        self.assertNotIn("github_pat_", serialized)
        self.assertNotIn("ghp_", serialized)
        source = SCRIPT.read_text(encoding="utf-8")
        for forbidden in (
            "--private-key", "--webhook-secret", "--database-url", "--operator-token",
            "--client-secret", "--session-secret", "--commercial-release-ref",
        ):
            self.assertNotIn(forbidden, source)

    def test_invalid_organization_and_newline_app_names_fail(self) -> None:
        with self.assertRaises(self.renderer.BootstrapError):
            self.renderer.validate_org("bad/org")
        with self.assertRaises(self.renderer.BootstrapError):
            self.renderer.validate_app_name("bad\nname", "App name")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReleaseAssuranceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.release = json.loads((ROOT / "config/release/release-policy.json").read_text(encoding="utf-8"))
        self.instance = json.loads((ROOT / "config/protocol/instance.json").read_text(encoding="utf-8"))
        self.consents = json.loads((ROOT / "config/consent/consent-requests.json").read_text(encoding="utf-8"))

    def test_child_repository_identity_is_not_template_source(self) -> None:
        self.assertEqual(self.instance["instance_status"], "active_project")
        self.assertEqual(self.instance["repository"], "Vertex-Systems-Network/vsn-voice-ai")
        self.assertTrue(self.instance["bootstrap_completed"])

    def test_release_candidate_requires_immutable_identity_and_verification(self) -> None:
        candidate = self.release["release_candidate"]
        self.assertTrue(candidate["immutable_commit_required"])
        self.assertTrue(candidate["required_quality_and_security_checks"])
        self.assertTrue(candidate["release_notes_required"])
        self.assertTrue(candidate["deployment_plan_required"])
        self.assertTrue(candidate["rollback_or_rollforward_plan_required"])
        self.assertTrue(candidate["post_deploy_verification_required"])
        self.assertTrue(candidate["artifact_digest_required_when_artifacts_exist"])

    def test_deployment_security_is_fail_closed(self) -> None:
        security = self.release["deployment_security"]
        self.assertTrue(security["prefer_oidc_short_lived_identity"])
        self.assertTrue(security["long_lived_cloud_credentials_discouraged"])
        self.assertTrue(security["untrusted_prs_must_not_access_production_credentials"])
        self.assertTrue(security["environment_secret_separation_required"])

    def test_development_and_technology_consents_are_recorded_before_product_implementation(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        records = {row["id"]: row for row in self.consents["requests"]}

        self.assertEqual(records["CONSENT-000001"]["status"], "approved")
        self.assertEqual(records["CONSENT-000001"]["type"], "development_start")
        self.assertEqual(records["CONSENT-000002"]["status"], "approved")
        self.assertEqual(records["CONSENT-000002"]["type"], "technology_stack_approval")
        self.assertIsNotNone(records["CONSENT-000002"]["nonce_consumed_at"])
        self.assertEqual(records["CONSENT-000002"]["decision_request_hash"], records["CONSENT-000002"]["request_hash"])

        self.assertIn("Development authorization:** `APPROVED — CONSENT-000001", readme)
        self.assertIn("Technology stack:** `APPROVED — CONSENT-000002", readme)
        self.assertIn("0 / 25 modules implemented", readme)
        self.assertNotIn("TECHNOLOGY STACK APPROVAL PENDING", readme)
        self.assertNotIn("Development authorization:** `LOCKED — OWNER CONSENT REQUIRED", readme)


if __name__ == "__main__":
    unittest.main()

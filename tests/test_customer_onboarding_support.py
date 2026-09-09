from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class CustomerOnboardingSupportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scope = load("config/licensing/customer-onboarding-support.json")
        self.catalog = load("config/licensing/product-catalog.json")
        self.features = load("config/licensing/feature-catalog.json")
        self.service = load("blueprints/commercial/service-api-contract.json")
        self.matrix = load("config/licensing/provider-compatibility-matrix.json")

    def test_source_onboarding_is_documentation_not_a_customer_contract(self) -> None:
        self.assertEqual(self.scope["status"], "template_blueprint")
        self.assertEqual(self.scope["activation_scope"], "commercial_distribution_only")
        self.assertFalse(self.scope["source_is_customer_contract"])
        self.assertTrue(self.scope["operator_approval_required_before_customer_support_commitment"])
        onboarding = self.scope["developer"]["onboarding"]
        self.assertTrue(onboarding["included_as_product_documentation"])
        self.assertFalse(onboarding["contractual_support_entitlement"])
        self.assertTrue((ROOT / onboarding["guide"]).is_file())

    def test_developer_has_no_implicit_staffed_support_or_sla(self) -> None:
        developer = self.scope["developer"]["standard_support"]
        self.assertFalse(developer["included_by_default"])
        self.assertFalse(developer["sla_included"])
        self.assertFalse(developer["service_credits_included"])
        for key in [
            "support_channel",
            "support_hours",
            "support_timezone",
            "initial_response_target",
            "resolution_target",
            "security_incident_contact",
            "escalation_path",
        ]:
            self.assertIsNone(developer[key])
        self.assertEqual(developer["activation_status"], "operator_required")

        plans = {plan["id"]: plan for plan in self.catalog["plans"]}
        self.assertNotIn("commercial_support", plans["developer"]["entitlements"])

    def test_team_and_enterprise_support_remain_external_contract_claims(self) -> None:
        plans = {plan["id"]: plan for plan in self.catalog["plans"]}
        self.assertIn("commercial_support", plans["team"]["entitlements"])
        self.assertIn("priority_support_or_sla_when_contracted", plans["enterprise"]["entitlements"])

        features = {row["id"]: row for row in self.features["entitlements"]}
        self.assertEqual(features["commercial_support"]["availability"], "external_contract_required")
        self.assertEqual(
            features["priority_support_or_sla_when_contracted"]["availability"],
            "external_contract_required",
        )
        self.assertFalse(self.scope["team_and_enterprise"]["numeric_sla_commitments_in_source"])

    def test_onboarding_paid_api_steps_exist_in_service_contract(self) -> None:
        endpoint_paths = {row["path"] for row in self.service["endpoints"]}
        for path in [
            "/v1/entitlements/current",
            "/v1/releases/current",
            "/v1/template/archive",
        ]:
            self.assertIn(path, endpoint_paths)

        covered = set(self.scope["developer"]["onboarding"]["covered_flows"])
        self.assertIn("refresh_current_entitlement_after_github_identity_verification", covered)
        self.assertIn("request_current_certified_release_metadata", covered)
        self.assertIn("download_the_same_manifest_verified_immutable_template_release", covered)

    def test_support_data_rules_reject_secret_collection(self) -> None:
        rules = self.scope["support_request_data_rules"]
        self.assertTrue(rules["never_request_raw_passwords"])
        self.assertTrue(rules["never_request_private_keys"])
        self.assertTrue(rules["never_request_session_cookies"])
        self.assertTrue(rules["never_request_full_database_credentials"])
        self.assertTrue(rules["prefer_request_id_and_sanitized_error_code"])
        self.assertTrue(rules["customer_secrets_must_be_redacted"])

    def test_onboarding_preserves_runtime_dependent_provider_truth(self) -> None:
        self.assertFalse(self.matrix["commercial_entitlement"])
        self.assertFalse(self.matrix["bundled_integration_claim"])
        included = set(self.scope["self_service_boundaries"]["included"])
        self.assertIn("provider_compatibility_runtime_dependency_explanation", included)

    def test_no_numeric_or_guaranteed_support_commitment_is_implied(self) -> None:
        excluded = set(self.scope["self_service_boundaries"]["not_implied"])
        self.assertIn("guaranteed_response_time", excluded)
        self.assertIn("guaranteed_resolution_time", excluded)
        self.assertIn("24x7_staffing", excluded)
        self.assertIn("service_credits", excluded)
        launch = " ".join(self.scope["launch_gates"])
        self.assertIn("numeric response or resolution target", launch)
        self.assertIn("Source documentation cannot authorize", launch)


if __name__ == "__main__":
    unittest.main()

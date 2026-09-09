from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class ProviderCompatibilityMatrixTests(unittest.TestCase):
    def setUp(self) -> None:
        self.matrix = load("config/licensing/provider-compatibility-matrix.json")
        self.pm = load("config/integrations/project-management.json")
        self.agents = load("config/ai/agent-catalog.json")
        self.linear = load("config/integrations/linear-sync.json")
        self.catalog = load("config/licensing/product-catalog.json")

    def test_matrix_is_core_truth_not_a_paid_or_partnership_claim(self) -> None:
        self.assertEqual(self.matrix["status"], "template_blueprint")
        self.assertEqual(self.matrix["activation_scope"], "core_protocol_truth_only")
        self.assertFalse(self.matrix["commercial_entitlement"])
        self.assertFalse(self.matrix["bundled_integration_claim"])
        self.assertFalse(self.matrix["vendor_partnership_or_certification_claim"])
        self.assertEqual(self.matrix["source_template_connection_state"], "unconnected")
        for plan in self.catalog["plans"]:
            self.assertNotIn("standard_provider_adapters", plan["entitlements"])

    def test_project_management_provider_catalog_matches_exactly(self) -> None:
        source = self.pm["providers"]
        matrix = self.matrix["project_management"]["providers"]
        self.assertEqual([row["id"] for row in matrix], [row["id"] for row in source])
        self.assertEqual(len({row["id"] for row in matrix}), len(matrix))

        source_by_id = {row["id"]: row for row in source}
        for row in matrix:
            expected = source_by_id[row["id"]]
            self.assertEqual(row["name"], expected["name"])
            self.assertEqual(row["connection_modes"], expected["connection_modes"])
            self.assertEqual(row["availability"], expected["availability"])
            self.assertFalse(row["provider_specific_execution_adapter_shipped"])
            self.assertFalse(row["live_connection_bundled"])

    def test_only_linear_claims_a_dedicated_sync_blueprint(self) -> None:
        providers = {row["id"]: row for row in self.matrix["project_management"]["providers"]}
        linear = providers["linear"]
        self.assertEqual(linear["support_level"], "dedicated_sync_blueprint_runtime_required")
        self.assertEqual(linear["dedicated_blueprint"], "config/integrations/linear-sync.json")
        self.assertTrue((ROOT / linear["dedicated_blueprint"]).is_file())
        self.assertEqual(self.linear["provider_id"], "linear")
        self.assertFalse(self.linear["enabled"])

        for provider_id, row in providers.items():
            if provider_id == "linear":
                continue
            self.assertEqual(row["support_level"], "generic_contract_runtime_discovery_only")
            self.assertIsNone(row["dedicated_blueprint"])

    def test_generic_adapter_contract_is_not_provider_implementation_evidence(self) -> None:
        self.assertEqual(
            self.matrix["project_management"]["generic_adapter_contract_status"],
            "contract_only_until_runtime_verified",
        )
        contract = self.pm["adapter_contract"]
        self.assertGreater(len(contract), 10)
        runtime_rules = " ".join(self.matrix["runtime_rules"])
        self.assertIn("interface requirements", runtime_rules)
        self.assertIn("not evidence", runtime_rules)
        self.assertIn("runtime", runtime_rules.lower())

    def test_development_ai_candidates_match_agent_catalog_and_remain_runtime_discovered(self) -> None:
        ai = self.matrix["development_ai"]
        self.assertEqual(ai["candidates"], self.agents["candidate_examples"])
        self.assertEqual(ai["support_level"], "host_capability_discovery_only")
        self.assertFalse(ai["provider_specific_execution_adapter_shipped"])
        self.assertFalse(ai["selection_is_authorization"])
        self.assertTrue(ai["runtime_identity_verification_required"])
        self.assertTrue(ai["least_privilege_permission_profile_required"])
        self.assertEqual(self.agents["available_agents"], [])
        self.assertEqual(self.agents["selected_agents"], [])

    def test_repository_authority_remains_canonical_for_engineering_state(self) -> None:
        authority = load("config/integrations/sync-authority.json")["default_authority"]
        for field in [
            "code",
            "branch",
            "pull_or_merge_request",
            "merge_state",
            "test_and_check_state",
            "release_evidence",
            "work_unit_completion",
        ]:
            self.assertEqual(authority[field], "repository")


if __name__ == "__main__":
    unittest.main()

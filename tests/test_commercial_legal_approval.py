from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class CommercialLegalApprovalTests(unittest.TestCase):
    def test_canonical_legal_approval_is_fail_closed(self) -> None:
        approval = load("config/licensing/legal-approval.json")
        self.assertEqual(approval["status"], "operator_review_required")
        self.assertEqual(approval["activation_scope"], "commercial_distribution_only")
        self.assertTrue(approval["binding_legal_authority_is_external_to_repository"])
        self.assertTrue(approval["source_may_not_self_approve"])
        self.assertFalse(approval["approved_for_sale"])
        self.assertFalse(approval["approval"]["operator_explicit_sale_approval"])
        self.assertIsNone(approval["approval"]["approved_by"])
        self.assertIsNone(approval["approval"]["approved_at"])
        self.assertIsNone(approval["approval"]["approval_evidence"])

    def test_operator_identity_and_review_evidence_are_not_invented(self) -> None:
        approval = load("config/licensing/legal-approval.json")
        identity = approval["operator_identity"]
        self.assertEqual(identity["status"], "pending")
        for key in [
            "legal_entity",
            "registered_address",
            "country_or_jurisdiction",
            "publisher_contact",
            "legal_privacy_contact",
            "support_contact",
            "tax_or_vat_identifiers",
        ]:
            self.assertIsNone(identity[key], key)

        review = approval["review"]
        self.assertFalse(review["operator_review_completed"])
        self.assertFalse(review["qualified_legal_review_completed"])
        self.assertFalse(review["accounting_or_tax_review_completed_when_applicable"])
        self.assertIsNone(review["reviewer_identity"])
        self.assertIsNone(review["review_completed_at"])
        self.assertIsNone(review["approved_release_version"])

    def test_customer_legal_documents_remain_unapproved_templates(self) -> None:
        approval = load("config/licensing/legal-approval.json")
        documents = approval["documents"]
        for key in [
            "terms_of_service",
            "commercial_license_eula",
            "privacy_policy",
            "refund_cancellation_policy",
        ]:
            document = documents[key]
            self.assertEqual(document["status"], "template_only_pending_review")
            self.assertIsNone(document["customer_url"])
            self.assertIsNone(document["approved_version"])
            self.assertIsNone(document["effective_date"])
            self.assertIsNone(document["review_evidence"])

        support = documents["support_sla_policy"]
        self.assertEqual(support["status"], "not_activated")
        self.assertFalse(support["staffed_support_committed"])
        self.assertFalse(support["numeric_sla_committed"])
        self.assertIsNone(support["customer_url"])
        self.assertIsNone(support["approved_version"])
        self.assertIsNone(support["effective_date"])
        self.assertIsNone(support["review_evidence"])

    def test_business_privacy_and_operations_decisions_remain_pending(self) -> None:
        approval = load("config/licensing/legal-approval.json")
        for value in approval["business_decisions"].values():
            self.assertIs(value, False)
        for value in approval["privacy_and_operations_decisions"].values():
            self.assertIs(value, False)

    def test_required_gate_set_is_explicit_and_non_destructive_rule_is_locked(self) -> None:
        approval = load("config/licensing/legal-approval.json")
        required = {
            "operator_identity_complete",
            "terms_of_service_approved",
            "commercial_license_eula_approved",
            "privacy_policy_approved",
            "refund_cancellation_policy_approved",
            "pricing_and_marketplace_plan_mapping_approved",
            "tax_treatment_approved_when_applicable",
            "production_data_flow_and_subprocessors_verified",
            "retention_deletion_and_customer_rights_process_approved",
            "support_commitments_match_actual_operations",
            "qualified_legal_review_completed",
            "operator_explicit_sale_approval_recorded",
        }
        self.assertEqual(set(approval["required_gates"]), required)

        safety = approval["non_destructive_license_rule"]
        self.assertTrue(safety["expiry_or_cancellation_may_gate_future_premium_access"])
        self.assertTrue(safety["generated_customer_repositories_must_not_be_deleted"])
        self.assertTrue(safety["generated_customer_code_must_not_be_encrypted_or_intentionally_broken"])

    def test_legal_checklist_preserves_source_vs_approval_boundary(self) -> None:
        checklist = (ROOT / "docs/commercial/legal-approval-checklist.md").read_text(encoding="utf-8")
        for marker in [
            "not legal advice and not sale authorization",
            "approved_for_sale = false",
            "operator_explicit_sale_approval = false",
            "Source certification proves that this fail-closed state is internally consistent",
            "Legal approval is necessary but not sufficient",
        ]:
            self.assertIn(marker, checklist)

    def test_product_catalog_and_role_router_load_the_legal_gate(self) -> None:
        catalog = load("config/licensing/product-catalog.json")
        self.assertEqual(catalog["legal_approval_ref"], "config/licensing/legal-approval.json")
        for plan in catalog["plans"]:
            self.assertEqual(plan["sale_status"], "draft")
            self.assertIsNone(plan["marketplace_plan_id"])
            self.assertIsNone(plan["monthly_price_usd"])
            self.assertIsNone(plan["annual_price_usd"])

        manifest = load(".ai/manifest.json")
        commercial = set(manifest["roles"]["commercial_distribution"])
        for path in [
            "config/licensing/legal-approval.json",
            "docs/commercial/legal-approval-checklist.md",
            "blueprints/commercial/legal-pack.template.md",
        ]:
            self.assertIn(path, commercial)


if __name__ == "__main__":
    unittest.main()

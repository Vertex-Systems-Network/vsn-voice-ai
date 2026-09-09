from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class TeamProductizationTests(unittest.TestCase):
    def test_team_source_surface_exists(self) -> None:
        for path in [
            "commercial-service/app/api/v1/team/summary/route.ts",
            "commercial-service/app/team/page.tsx",
            "commercial-service/app/team/TeamClient.tsx",
            "commercial-service/lib/team-dashboard.ts",
            "commercial-service/lib/team-installation.ts",
            "commercial-service/tests/team-dashboard.test.ts",
            "docs/commercial/team-administration.md",
        ]:
            self.assertTrue((ROOT / path).is_file(), path)

    def test_team_feature_remains_partial_and_evidence_bound(self) -> None:
        features = {row["id"]: row for row in load("config/licensing/feature-catalog.json")["entitlements"]}
        team = features["organization_team_features"]
        self.assertEqual(team["availability"], "partial_implementation")
        evidence = set(team["evidence"])
        for path in [
            "commercial-service/app/api/v1/seats/route.ts",
            "commercial-service/app/api/v1/team/summary/route.ts",
            "commercial-service/app/team/TeamClient.tsx",
            "commercial-service/lib/team-dashboard.ts",
            "commercial-service/lib/team-installation.ts",
            "commercial-service/tests/team-dashboard.test.ts",
            "docs/commercial/team-administration.md",
        ]:
            self.assertIn(path, evidence)
        notes = team["notes"].lower()
        self.assertIn("no real team marketplace plan", notes)
        self.assertIn("production organization e2e is not verified", notes)
        self.assertIn("pro premium dependencies remain unimplemented", notes)

    def test_team_plan_stays_draft_unpriced_and_support_is_not_source_activated(self) -> None:
        catalog = load("config/licensing/product-catalog.json")
        plans = {plan["id"]: plan for plan in catalog["plans"]}
        team = plans["team"]
        self.assertEqual(team["sale_status"], "draft")
        self.assertIsNone(team["marketplace_plan_id"])
        self.assertIsNone(team["monthly_price_usd"])
        self.assertIsNone(team["annual_price_usd"])
        self.assertIn("organization_team_features", team["entitlements"])
        self.assertIn("commercial_support", team["entitlements"])

        features = {row["id"]: row for row in load("config/licensing/feature-catalog.json")["entitlements"]}
        self.assertEqual(features["commercial_support"]["availability"], "external_contract_required")

    def test_team_summary_is_admin_entitlement_and_marketplace_reconciliation_gated(self) -> None:
        source = (ROOT / "commercial-service/app/api/v1/team/summary/route.ts").read_text(encoding="utf-8")
        for marker in [
            "githubSessionFromRequest",
            "resolveUserInstallationAccount",
            "requireGithubOrganizationAdmin",
            "reconcileEntitlement",
            "ORGANIZATION_TEAM_FEATURE",
            "loadTeamEntitlementRecord",
            "listSeats",
            '"Cache-Control": "no-store"',
        ]:
            self.assertIn(marker, source)
        self.assertNotIn("getMarketplaceSubscription", source)

        dashboard = (ROOT / "commercial-service/lib/team-dashboard.ts").read_text(encoding="utf-8")
        self.assertIn("SELECT github_account_id,github_login,github_account_type,plan_id,marketplace_plan_id,seats,state,features", dashboard)
        self.assertIn('billing_authority: "github_marketplace"', dashboard)
        self.assertIn("contractual_support_activated_by_source: false", dashboard)

    def test_team_ui_reuses_server_side_seat_lifecycle_and_does_not_claim_billing_mutation(self) -> None:
        source = (ROOT / "commercial-service/app/team/TeamClient.tsx").read_text(encoding="utf-8")
        self.assertIn('fetch("/api/v1/seats"', source)
        self.assertIn('method: "POST"', source)
        self.assertIn('method: "DELETE"', source)
        self.assertIn("GitHub Marketplace remains the billing authority", source)
        self.assertIn("does not activate a staffed support channel", source)
        for forbidden in [
            "Change billing cycle",
            "Cancel subscription",
            "Start trial",
            "Charge card",
        ]:
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()

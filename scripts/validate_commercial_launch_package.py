#!/usr/bin/env python3
"""Static validation for the ANPOS commercial production-launch package."""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []

LEGACY_APP_BLUEPRINT = ROOT / "blueprints/commercial/github-app-manifest.example.json"
MARKETPLACE_APP_BLUEPRINT = ROOT / "blueprints/commercial/github-marketplace-app-manifest.example.json"
VENDOR_APP_BLUEPRINT = ROOT / "blueprints/commercial/github-vendor-app-manifest.example.json"
COMPLIANCE = ROOT / "blueprints/commercial/github-marketplace-compliance.json"
CHECKLIST = ROOT / "blueprints/commercial/production-launch-checklist.json"
LISTING = ROOT / "blueprints/commercial/marketplace-listing-draft.md"
LEGAL = ROOT / "blueprints/commercial/legal-pack.template.md"
VERIFIER = ROOT / "scripts/verify_commercial_production.py"
TESTS = ROOT / "tests/test_commercial_launch_package.py"
VENDOR_QUALITY = ROOT / "blueprints/commercial/vendor-launch-quality.yml"
CHILD_QUALITY = ROOT / "blueprints/github/workflows/repository-quality.yml"
BOUNDARY = ROOT / "config/licensing/vendor-source-boundary.json"


def fail(message: str) -> None:
    ERRORS.append(message)


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"{path.relative_to(ROOT)} is not valid JSON: {exc}")
        return {}
    if not isinstance(data, dict):
        fail(f"{path.relative_to(ROOT)} must contain a JSON object")
        return {}
    return data


def require_text(path: Path, markers: tuple[str, ...]) -> str:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
        return ""
    text = path.read_text(encoding="utf-8")
    for marker in markers:
        if marker not in text:
            fail(f"{path.relative_to(ROOT)} missing marker: {marker}")
    return text


def main() -> int:
    for path in (
        LEGACY_APP_BLUEPRINT,
        MARKETPLACE_APP_BLUEPRINT,
        VENDOR_APP_BLUEPRINT,
        COMPLIANCE,
        CHECKLIST,
        LISTING,
        LEGAL,
        VERIFIER,
        TESTS,
        VENDOR_QUALITY,
        BOUNDARY,
    ):
        if not path.is_file():
            fail(f"missing {path.relative_to(ROOT)}")

    legacy = load_json(LEGACY_APP_BLUEPRINT) if LEGACY_APP_BLUEPRINT.is_file() else {}
    if legacy.get("status") != "deprecated_do_not_use_for_production":
        fail("legacy single-App blueprint must remain explicitly deprecated")
    replacements = set(legacy.get("replacements") or [])
    expected_replacements = {
        "blueprints/commercial/github-marketplace-app-manifest.example.json",
        "blueprints/commercial/github-vendor-app-manifest.example.json",
    }
    if expected_replacements - replacements:
        fail("legacy single-App blueprint must point to both split App replacements")

    marketplace_app = load_json(MARKETPLACE_APP_BLUEPRINT) if MARKETPLACE_APP_BLUEPRINT.is_file() else {}
    if marketplace_app.get("status") != "operator_configuration_required":
        fail("Marketplace App blueprint must remain operator_configuration_required")
    if marketplace_app.get("role") != "customer_marketplace_app":
        fail("Marketplace App blueprint role must remain customer_marketplace_app")
    marketplace_defaults = marketplace_app.get("required_defaults") or {}
    if marketplace_defaults.get("public") is not True:
        fail("customer-facing Marketplace App blueprint must require public visibility")
    if marketplace_defaults.get("webhook_active") is not False:
        fail("Marketplace App blueprint must keep the ordinary GitHub App webhook disabled for Marketplace purchase handling")
    if marketplace_app.get("event_subscriptions") != []:
        fail("Marketplace App blueprint must not model marketplace_purchase as a normal GitHub App event subscription")
    listing_webhook = marketplace_app.get("marketplace_listing_webhook") or {}
    if listing_webhook.get("configuration_surface") != "github_marketplace_listing_webhook":
        fail("Marketplace App blueprint must identify the separate Marketplace listing webhook surface")
    if listing_webhook.get("required") is not True or listing_webhook.get("event") != "marketplace_purchase":
        fail("Marketplace listing webhook must require marketplace_purchase")
    if listing_webhook.get("url_path") != "/api/webhooks/github/marketplace":
        fail("Marketplace listing webhook must target the canonical commercial webhook route")
    if listing_webhook.get("secret_environment_key") != "GITHUB_WEBHOOK_SECRET":
        fail("Marketplace listing webhook must bind the canonical webhook secret environment key")
    marketplace_text = json.dumps(marketplace_app, sort_keys=True)
    if "administration:write_for_private_template_distribution" not in marketplace_text:
        fail("Marketplace App blueprint must explicitly forbid vendor Administration scope")

    vendor_app = load_json(VENDOR_APP_BLUEPRINT) if VENDOR_APP_BLUEPRINT.is_file() else {}
    if vendor_app.get("status") != "operator_configuration_required":
        fail("Vendor App blueprint must remain operator_configuration_required")
    if vendor_app.get("role") != "vendor_distribution_app":
        fail("Vendor App blueprint role must remain vendor_distribution_app")
    vendor_defaults = vendor_app.get("required_defaults") or {}
    if vendor_defaults.get("public") is not False:
        fail("vendor distribution App must remain private/non-public")
    if vendor_app.get("event_subscriptions") != []:
        fail("vendor distribution App must not subscribe to Marketplace events")
    permissions = vendor_app.get("minimum_permissions_by_capability") or {}
    archive = permissions.get("archive_first_delivery") or {}
    if archive.get("contents") != "read" or archive.get("metadata") != "read":
        fail("vendor archive-first delivery must define contents/metadata read permissions")
    if "administration" in archive:
        fail("vendor archive-only capability must not require administration permission")
    collaborator = permissions.get("optional_collaborator_provisioning") or {}
    if collaborator.get("administration") != "write":
        fail("optional vendor collaborator provisioning must make administration write explicit")

    compliance = load_json(COMPLIANCE) if COMPLIANCE.is_file() else {}
    if compliance.get("status") != "operator_verification_required":
        fail("Marketplace compliance baseline must remain operator_verification_required")
    if compliance.get("activation_scope") != "vendor_marketplace_launch_only":
        fail("Marketplace compliance baseline must remain vendor_marketplace_launch_only")
    checked_at = compliance.get("source_checked_at")
    if not isinstance(checked_at, str) or len(checked_at) != 10:
        fail("Marketplace compliance baseline must record source_checked_at")
    official_sources = compliance.get("official_sources") or []
    if len(official_sources) < 6 or not all(isinstance(url, str) and url.startswith("https://docs.github.com/") for url in official_sources):
        fail("Marketplace compliance baseline must cite official docs.github.com sources")

    app_requirements = compliance.get("marketplace_github_app") or {}
    for key in (
        "must_be_public_installable_by_other_accounts",
        "must_be_separate_from_vendor_distribution_app",
        "must_not_require_vendor_template_administration_for_customer_installations",
    ):
        if app_requirements.get(key) is not True:
            fail(f"Marketplace GitHub App baseline missing requirement: {key}")

    paid = compliance.get("paid_github_app") or {}
    if paid.get("must_be_organization_owned") is not True:
        fail("paid GitHub App baseline must require organization ownership")
    if paid.get("listing_submitter_must_be_organization_owner") is not True:
        fail("paid GitHub App baseline must require organization-owner listing submission")
    if paid.get("verified_publisher_required") is not True:
        fail("paid GitHub App baseline must require verified publisher")
    prerequisites = set(paid.get("verified_publisher_prerequisites") or [])
    expected_prerequisites = {
        "verified_organization_domain",
        "confirmed_contact_email",
        "organization_two_factor_authentication_required",
    }
    if expected_prerequisites - prerequisites:
        fail("verified publisher baseline must include domain, contact email, and organization 2FA")
    if paid.get("minimum_installations_before_paid_listing") != 100:
        fail("2026-09-04 paid GitHub App baseline must record 100-install minimum")
    if paid.get("financial_onboarding_required") is not True:
        fail("paid GitHub App baseline must require financial onboarding")

    listing_requirements = set((compliance.get("listing") or {}).get("required") or [])
    expected_listing = {
        "valid_publisher_contact_information",
        "relevant_product_description",
        "pricing_plan",
        "valid_privacy_policy_url",
        "support_url_or_support_email",
        "working_relevant_additional_links",
        "integration_value_beyond_authentication",
        "github_app_public_installability",
        "public_availability_not_preview_or_invite_only",
        "marketplace_plan_change_and_cancellation_webhook",
        "logo",
        "feature_card",
        "screenshots",
    }
    missing_listing = sorted(expected_listing - listing_requirements)
    if missing_listing:
        fail(f"Marketplace listing baseline missing requirements: {', '.join(missing_listing)}")

    pricing = compliance.get("pricing") or {}
    if pricing.get("maximum_plans") != 10:
        fail("Marketplace pricing baseline must record maximum 10 plans")
    if pricing.get("paid_plan_currency") != "USD":
        fail("Marketplace pricing baseline must record USD paid-plan currency")
    if pricing.get("paid_plan_monthly_price_required") is not True or pricing.get("paid_plan_annual_price_required") is not True:
        fail("every paid Marketplace plan must require monthly and annual pricing")
    if pricing.get("repository_must_not_define_live_prices") is not True:
        fail("repository must not become live Marketplace pricing authority")

    event_actions = set((compliance.get("marketplace_events") or {}).get("required_actions_for_paid_plans") or [])
    if {"purchased", "changed", "cancelled"} - event_actions:
        fail("Marketplace event baseline must cover purchased, changed, and cancelled")
    customer_billing = compliance.get("customer_billing_experience") or {}
    for key in (
        "show_current_plan_and_price",
        "show_purchases_and_plan_changes",
        "show_cancellation_and_trial_state",
        "show_monthly_or_annual_billing_cycle",
        "show_usage_and_remaining_resources_when_applicable",
    ):
        if customer_billing.get(key) is not True:
            fail(f"customer billing experience missing requirement: {key}")
    trial = compliance.get("free_trial_privacy") or {}
    if trial.get("github_marketplace_trial_days_when_enabled_at_source_check") != 14:
        fail("2026-09-04 Marketplace baseline must record 14-day trial when enabled")
    if trial.get("cancelled_trial_private_customer_data_delete_within_days") != 30:
        fail("Marketplace baseline must preserve 30-day cancelled-trial private-data deletion requirement")
    if trial.get("must_reverify_before_publication") is not True:
        fail("Marketplace trial/privacy requirements must be re-verified before publication")

    checklist = load_json(CHECKLIST) if CHECKLIST.is_file() else {}
    if checklist.get("schema_version") != 2:
        fail("production launch checklist must be schema_version 2")
    if checklist.get("status") != "inactive_blueprint":
        fail("production launch checklist must remain an inactive blueprint")
    if checklist.get("launch_authorized") is not False:
        fail("source launch checklist must never authorize production sales")
    if checklist.get("non_destructive_expiry") is not True:
        fail("launch checklist must preserve non-destructive expiry")
    gates = checklist.get("required_gates") or []
    gate_ids = {item.get("id") for item in gates if isinstance(item, dict)}
    required_ids = {
        "vendor_service_repo",
        "vendor_template_repo",
        "github_marketplace_app",
        "github_vendor_app",
        "github_app_role_separation",
        "vendor_app_installation",
        "marketplace_publisher",
        "marketplace_installation_threshold",
        "marketplace_listing",
        "marketplace_listing_assets",
        "marketplace_plans",
        "customer_billing_experience",
        "free_trial_privacy",
        "legal_pack",
        "vercel_production_env",
        "webhook_public_reachability",
        "ready_endpoint",
        "real_marketplace_events",
        "reconciliation",
        "archive_delivery",
        "seat_flows",
        "cancellation_safety",
        "backup_restore",
        "production_source_boundary",
    }
    missing = sorted(required_ids - gate_ids)
    if missing:
        fail(f"production launch checklist missing gates: {', '.join(missing)}")
    if "github_app" in gate_ids or "app_installation" in gate_ids:
        fail("production launch checklist must not retain legacy single-App gates")
    for item in gates:
        if not isinstance(item, dict):
            fail("every launch gate must be an object")
            continue
        if item.get("status") == "verified":
            fail(f"source blueprint must not pre-verify launch gate {item.get('id')}")
        if item.get("evidence") is not None:
            fail(f"source blueprint must not carry live launch evidence for {item.get('id')}")

    require_text(
        LISTING,
        (
            "Draft only",
            "two distinct GitHub Apps",
            "Marketplace App — public/customer-facing",
            "Vendor Distribution App — private/vendor-only",
            "minimum of **100 GitHub App installations**",
            "monthly and annual price in USD",
            "verified organization domain",
            "Support URL and/or support email",
            "Feature card",
            "publicly available rather than public-preview/invite-only",
            "customer-facing billing experience",
            "within 30 days after a cancelled trial",
            "Developer",
            "Pro",
            "Team",
            "Enterprise",
            "Repository files are never billing authority.",
            "Organization membership alone is not a licensed seat.",
            "No final price, legal promise, uptime SLA, tax treatment, refund right, warranty, installation count, publisher verification, or Marketplace approval is created by this draft.",
        ),
    )
    require_text(
        LEGAL,
        (
            "Template only — not legal advice",
            "monthly and annual billing options",
            "14-day Marketplace free trial",
            "Customer billing visibility",
            "within **30 days**",
            "Non-destructive expiry/cancellation",
            "Privacy Policy — template",
            "Refund / Cancellation Policy — template",
            "Support / SLA Policy — template",
            "LEGAL REVIEW REQUIRED",
            "OPERATOR REQUIRED",
        ),
    )

    verifier = require_text(
        VERIFIER,
        (
            '"/api/health"',
            '"/api/ready"',
            '"/api/v1/keys"',
            '"/api/v1/entitlements/current"',
            '"/api/v1/reconcile"',
            '"--require-ready"',
            '"--github-token-env"',
            '"--operator-token-env"',
            "--require-ready passes and real Marketplace E2E evidence is recorded.",
        ),
    )
    if verifier:
        try:
            ast.parse(verifier, filename=str(VERIFIER))
        except SyntaxError as exc:
            fail(f"production verifier is not valid Python: {exc}")
        forbidden = ("--github-token\"", "--operator-token\"", "print(github_token", "print(operator_token")
        for marker in forbidden:
            if marker in verifier:
                fail(f"production verifier must not accept/print raw secret CLI values: {marker}")

    tests = require_text(
        TESTS,
        (
            "test_source_launch_checklist_is_fail_closed",
            "test_marketplace_compliance_baseline",
            "test_marketplace_compliance_gates_are_required",
            "test_split_app_blueprints_enforce_least_privilege",
            "test_legacy_single_app_blueprint_is_deprecated",
            "test_vendor_launch_assets_are_classified_vendor_only",
            "test_normalize_base_url_requires_https",
            "test_secret_values_are_read_by_environment_variable_name",
        ),
    )
    if tests:
        try:
            ast.parse(tests, filename=str(TESTS))
        except SyntaxError as exc:
            fail(f"launch package tests are not valid Python: {exc}")

    vendor_quality = require_text(
        VENDOR_QUALITY,
        (
            "python scripts/validate_commercial_launch_package.py",
            "scripts/.trusted-base-commercial-launch-validator.py",
            "tests.test_commercial_launch_package",
        ),
    )
    child_quality = CHILD_QUALITY.read_text(encoding="utf-8") if CHILD_QUALITY.is_file() else ""
    if "validate_commercial_launch_package.py" in child_quality or "test_commercial_launch_package" in child_quality:
        fail("child repository-quality blueprint must not depend on vendor-only launch package files")

    boundary = load_json(BOUNDARY) if BOUNDARY.is_file() else {}
    if boundary.get("activation_scope") != "canonical_vendor_source_management_only":
        fail("vendor source boundary must remain canonical_vendor_source_management_only")
    vendor_only = set(boundary.get("vendor_only_paths") or [])
    required_vendor_only = {
        "commercial-service",
        "blueprints/commercial/github-app-manifest.example.json",
        "blueprints/commercial/github-marketplace-app-manifest.example.json",
        "blueprints/commercial/github-vendor-app-manifest.example.json",
        "blueprints/commercial/github-marketplace-compliance.json",
        "blueprints/commercial/legal-pack.template.md",
        "blueprints/commercial/marketplace-listing-draft.md",
        "blueprints/commercial/production-launch-checklist.json",
        "blueprints/commercial/vendor-launch-quality.yml",
        "scripts/export_vendor_repositories.py",
        "scripts/validate_vendor_repository_export.py",
        "scripts/validate_commercial_service.py",
        "scripts/validate_commercial_launch_package.py",
        "scripts/verify_commercial_production.py",
        "tests/test_vendor_repository_export.py",
        "tests/test_commercial_launch_package.py",
    }
    missing_vendor = sorted(required_vendor_only - vendor_only)
    if missing_vendor:
        fail(f"vendor source boundary missing paths: {', '.join(missing_vendor)}")

    if ERRORS:
        print("ANPOS commercial launch package validation failed:", file=sys.stderr)
        for error in ERRORS:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ANPOS commercial launch package static checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

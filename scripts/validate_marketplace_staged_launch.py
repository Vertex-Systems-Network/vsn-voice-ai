#!/usr/bin/env python3
"""Static validation for the ANPOS free-first-to-paid Marketplace strategy."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STRATEGY = ROOT / "blueprints/commercial/marketplace-staged-launch.json"
CHECKLIST = ROOT / "blueprints/commercial/production-launch-checklist.json"
LISTING = ROOT / "blueprints/commercial/marketplace-listing-draft.md"
CATALOG = ROOT / "config/licensing/product-catalog.json"
BOUNDARY = ROOT / "config/licensing/vendor-source-boundary.json"
MARKETPLACE_APP = ROOT / "blueprints/commercial/github-marketplace-app-manifest.example.json"
VENDOR_APP = ROOT / "blueprints/commercial/github-vendor-app-manifest.example.json"
VENDOR_QUALITY = ROOT / "blueprints/commercial/vendor-launch-quality.yml"
CHILD_QUALITY = ROOT / "blueprints/github/workflows/repository-quality.yml"
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"{path.relative_to(ROOT)} is not valid JSON: {exc}")
        return {}
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain a JSON object")
        return {}
    return value


def main() -> int:
    for path in (STRATEGY, CHECKLIST, LISTING, CATALOG, BOUNDARY, MARKETPLACE_APP, VENDOR_APP, VENDOR_QUALITY):
        if not path.is_file():
            fail(f"missing {path.relative_to(ROOT)}")

    strategy = load_json(STRATEGY) if STRATEGY.is_file() else {}
    if strategy.get("schema_version") != 1:
        fail("staged launch strategy must be schema_version 1")
    if strategy.get("status") != "inactive_blueprint":
        fail("staged launch strategy must remain inactive_blueprint")
    if strategy.get("activation_scope") != "vendor_marketplace_launch_only":
        fail("staged launch strategy must remain vendor_marketplace_launch_only")
    if strategy.get("source_checked_at") != "2026-09-04":
        fail("staged launch strategy must record the 2026-09-04 source check")
    if strategy.get("strategy") != "free_first_then_paid":
        fail("staged launch strategy must remain free_first_then_paid")
    sources = strategy.get("official_sources") or []
    if len(sources) < 5 or not all(isinstance(url, str) and url.startswith("https://docs.github.com/") for url in sources):
        fail("staged launch strategy must cite official docs.github.com sources")

    app_architecture = strategy.get("github_app_architecture") or {}
    if app_architecture.get("marketplace_app_reference") != "blueprints/commercial/github-marketplace-app-manifest.example.json":
        fail("staged launch must reference the public Marketplace App blueprint")
    if app_architecture.get("vendor_app_reference") != "blueprints/commercial/github-vendor-app-manifest.example.json":
        fail("staged launch must reference the private Vendor App blueprint")
    for key in (
        "marketplace_app_must_be_public",
        "apps_must_remain_distinct",
        "vendor_administration_must_not_be_requested_from_customer_installations",
    ):
        if app_architecture.get(key) is not True:
            fail(f"staged launch App architecture missing required true flag: {key}")

    marketplace_app = load_json(MARKETPLACE_APP) if MARKETPLACE_APP.is_file() else {}
    if (marketplace_app.get("required_defaults") or {}).get("public") is not True:
        fail("free-first Marketplace App must be public/installable")
    vendor_app = load_json(VENDOR_APP) if VENDOR_APP.is_file() else {}
    if (vendor_app.get("required_defaults") or {}).get("public") is not False:
        fail("vendor distribution App must remain private during staged launch")

    free = strategy.get("phase_1_free_listing") or {}
    for key in (
        "supported_by_source_checked_docs",
        "requires_general_marketplace_listing_compliance",
        "requires_public_marketplace_app_installability",
        "requires_public_availability",
        "requires_value_beyond_authentication",
    ):
        if free.get(key) is not True:
            fail(f"free-first phase missing required true flag: {key}")
    events = set(free.get("required_marketplace_events_when_free_only") or [])
    if {"purchased", "cancelled"} - events:
        fail("free-only phase must handle purchased and cancelled Marketplace events")
    if free.get("paid_trial_upgrade_downgrade_handling_required_while_free_only") is not False:
        fail("free-only phase must not falsely require paid trial/upgrade/downgrade handling")
    free_plan = free.get("free_plan_definition") or {}
    if free_plan.get("status") != "operator_decision_required":
        fail("free plan definition must remain operator_decision_required")
    if free_plan.get("catalog_plan_id") is not None or free_plan.get("marketplace_plan_id") is not None:
        fail("staged blueprint must not invent free catalog/Marketplace plan IDs")
    if free_plan.get("entitlements") != []:
        fail("staged blueprint must not invent free entitlements")

    paid = strategy.get("phase_2_paid_eligibility") or {}
    if paid.get("current_minimum_github_app_installations") != 100:
        fail("2026-09-04 staged paid eligibility baseline must record 100 installations")
    for key in (
        "verified_publisher_required",
        "financial_onboarding_required",
        "organization_owner_listing_control_required",
        "paid_plans_can_be_added_to_existing_free_listing",
    ):
        if paid.get(key) is not True:
            fail(f"paid conversion phase missing required true flag: {key}")
    if paid.get("paid_plan_requirements_reference") != "blueprints/commercial/github-marketplace-compliance.json":
        fail("paid conversion must reference the Marketplace compliance baseline")

    conversion = strategy.get("conversion") or {}
    if conversion.get("automatic") is not False:
        fail("paid conversion must never be automatic")
    if conversion.get("operator_approval_required") is not True:
        fail("paid conversion must require operator approval")
    if conversion.get("repository_can_authorize_paid_conversion") is not False:
        fail("repository state must not authorize paid conversion")
    if conversion.get("paid_product_catalog_mutation_allowed_by_this_blueprint") is not False:
        fail("staged blueprint must not mutate paid product catalog")

    catalog = load_json(CATALOG) if CATALOG.is_file() else {}
    plan_ids = [str(item.get("id")) for item in catalog.get("plans", []) if isinstance(item, dict)]
    for required in ("developer", "pro", "team", "enterprise"):
        if required not in plan_ids:
            fail(f"paid draft catalog missing existing tier: {required}")
    if any(plan_id.lower() in {"free", "community"} for plan_id in plan_ids):
        fail("staged launch patch must not silently add a free/community catalog plan")

    checklist = load_json(CHECKLIST) if CHECKLIST.is_file() else {}
    if checklist.get("launch_authorized") is not False:
        fail("production launch checklist must remain launch_authorized=false")
    publication = checklist.get("recommended_publication_path") or {}
    if publication.get("strategy") != "free_first_then_paid":
        fail("production checklist must reference free_first_then_paid strategy")
    if publication.get("reference") != "blueprints/commercial/marketplace-staged-launch.json":
        fail("production checklist staged strategy reference is missing")
    if publication.get("operator_override_allowed") is not True:
        fail("staged path must remain a recommendation rather than a forced commercial decision")
    gate_ids = {item.get("id") for item in checklist.get("required_gates", []) if isinstance(item, dict)}
    for required in ("github_marketplace_app", "github_vendor_app", "github_app_role_separation", "vendor_app_installation"):
        if required not in gate_ids:
            fail(f"staged launch checklist missing split GitHub App gate: {required}")
    if "github_app" in gate_ids or "app_installation" in gate_ids:
        fail("staged launch checklist must not retain legacy single-App gates")

    listing = LISTING.read_text(encoding="utf-8") if LISTING.is_file() else ""
    for marker in (
        "Recommended staged publication path",
        "free-first then paid",
        "real free offering",
        "two distinct GitHub Apps",
        "Marketplace App — public/customer-facing",
        "never manufacture or buy installations",
        "does **not** alter the draft Developer, Pro, Team, or Enterprise product catalog",
    ):
        if marker not in listing:
            fail(f"Marketplace listing draft missing staged-launch marker: {marker}")

    boundary = load_json(BOUNDARY) if BOUNDARY.is_file() else {}
    vendor_only = set(boundary.get("vendor_only_paths") or [])
    for path in (
        "blueprints/commercial/marketplace-staged-launch.json",
        "blueprints/commercial/github-marketplace-app-manifest.example.json",
        "blueprints/commercial/github-vendor-app-manifest.example.json",
        "scripts/validate_marketplace_staged_launch.py",
    ):
        if path not in vendor_only:
            fail(f"vendor source boundary missing staged-launch path: {path}")

    vendor_quality = VENDOR_QUALITY.read_text(encoding="utf-8") if VENDOR_QUALITY.is_file() else ""
    if "python scripts/validate_marketplace_staged_launch.py" not in vendor_quality:
        fail("vendor launch quality blueprint must run staged launch validator")
    child_quality = CHILD_QUALITY.read_text(encoding="utf-8") if CHILD_QUALITY.is_file() else ""
    if "validate_marketplace_staged_launch.py" in child_quality:
        fail("child quality blueprint must not depend on vendor-only staged launch validator")

    if ERRORS:
        print("ANPOS Marketplace staged launch validation failed:", file=sys.stderr)
        for error in ERRORS:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ANPOS Marketplace staged launch static checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# GitHub Marketplace Listing Evidence

Status: **partially verified; artwork retention and genuine product screenshots remain pending**.

ANPOS already has a requirements baseline in `blueprints/commercial/github-marketplace-compliance.json` and a listing draft. This evidence layer answers a different question: whether the actual assets, URLs, contacts, public App behavior, and webhook configuration needed for submission have been verified.

Machine-readable state lives in `config/licensing/marketplace-listing-evidence.json`.

## Verified external evidence — 2026-09-06

The following live evidence has been checked against the current draft listing and production flow:

- company/homepage URL is reachable;
- privacy policy URL is reachable;
- Terms URL is reachable;
- Marketplace support contact is configured;
- Marketplace publisher contact information is saved;
- the public customer-facing GitHub App is installable and a real organization installation completed;
- Setup URL → PKCE OAuth → callback → installation-bound private-repository discovery works in production;
- a real authenticated Community readiness audit completed with `application_source_read=false` and `not_persisted_by_repository_audit`;
- installation permission-boundary smoke verified all ten approved ANPOS control files and denied broad `README.md` access with HTTP 403;
- the separate Marketplace listing webhook is reachable and verifies signed payloads; negative signature/JSON/account paths fail closed;
- smoke webhook validation did not persist fake Marketplace purchase rows.

## Evidence still required before submission

Before Marketplace submission, retain verified evidence for:

- final logo with a durable artifact reference and SHA-256 when possible;
- final feature card with a durable artifact reference and SHA-256 when possible;
- genuine product screenshots captured from the live Community flow, replacing draft/mock imagery;
- genuine draft-listing Marketplace purchase/cancellation lifecycle evidence once GitHub billing permits the test flow;
- final operator review and explicit launch authorization.

GitHub currently reports an account-level billing-information review state that blocks the draft purchase simulation. This is an external GitHub account gate, not an ANPOS runtime-readiness failure.

## Fail-closed rule

Draft copy, placeholder URLs, repository files, mocked images, or a green source build do not prove the Marketplace listing is ready. `listing_evidence_complete` stays false until the external evidence is actually supplied and reviewed.

GitHub requirements can change. Re-check official GitHub Marketplace documentation immediately before submission even when all local evidence items are complete.

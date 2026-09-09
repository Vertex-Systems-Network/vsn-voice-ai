# ANPOS Commercial Service

Vendor-only deployable reference backend for ANPOS GitHub Marketplace billing, licensing, seat control, private distribution, and the source-implemented ANPOS Community repository-readiness surface.

## Product-state boundary

The Community Repository Readiness / Conformance Audit is implemented in source but is **not** proof of Marketplace activation. A live Community claim still requires a real public Marketplace App, a real operator-approved free Marketplace plan ID, production Community configuration, deployment, Marketplace Setup/OAuth E2E evidence, and explicit operator activation.

Developer now has evidence-backed source value through verified private-template delivery and a certified protocol release/update channel, but it remains **draft/not for sale** until the external Marketplace, legal, pricing, private-vendor, deployment, and production-E2E gates pass. Pro/Team/Enterprise remain draft and their additional premium/orchestration/support claims must not be marketed as implemented until separately evidenced.

## Responsibilities

- receive and HMAC-verify bounded `marketplace_purchase` webhook bodies;
- bind `X-GitHub-Delivery` to a payload hash, deduplicate concurrent delivery, and safely retry failed/stale processing;
- reconcile account subscription state against GitHub Marketplace REST using the customer-facing Marketplace GitHub App JWT;
- persist a PostgreSQL entitlement, audit, rate-limit, seat, provisioning, and access-reconciliation ledger;
- use explicit checksum-locked database migrations instead of request-path schema mutation;
- issue short-lived Ed25519 signed entitlement envelopes for paid entitlements only;
- issue format-v2 seat-bound signed entitlements for paid organization users so an organization token is not freely shareable between members;
- expose public verification keys;
- expose non-secret deployment identity so stale/wrong service artifacts cannot pass production verification merely because health is green;
- allow authenticated paid customers to refresh current entitlement;
- let verified organization admins assign/list/revoke seats, with active-member verification and capacity enforcement;
- provide operator reconciliation for missed/ambiguous webhook deliveries and failed collaborator revocations;
- expose entitlement-gated certified release metadata from an immutable, manifest-verified private vendor-template commit;
- deliver the same verified private release through a short-lived GitHub archive redirect using a separate vendor-only GitHub App;
- optionally provision users as private-template collaborators when explicitly enabled on the vendor App only;
- reference-count collaborator grants before revocation so another active purchase/seat is not accidentally removed;
- implement the Community Marketplace Setup URL -> PKCE GitHub App OAuth -> encrypted short-lived browser session -> installation-bound repository discovery -> read-only readiness audit flow;
- reconcile the real Community Marketplace plan as `plan_id=community` with zero paid entitlements, no signed license token, and no organization-seat requirement;
- read only the ten approved ANPOS Community control files and never treat the free readiness audit as permission to inspect application source code;
- never delete, encrypt, modify, or intentionally break already-generated customer projects because a commercial entitlement ends.

## ANPOS Community flow

Community v1 uses the public Marketplace App as the consent boundary and a GitHub **user access token** as the repository-read authority.

1. GitHub Marketplace redirects a new/updated installation to `/setup/github?installation_id=...`.
2. The Setup route treats `installation_id` as untrusted, creates encrypted short-lived state plus a PKCE verifier, and redirects to `https://github.com/login/oauth/authorize`.
3. `/api/auth/github/callback` exchanges the authorization code with PKCE, verifies the GitHub user, and verifies that user against the selected installation.
4. The service creates an encrypted `HttpOnly; Secure; SameSite=Lax` browser session, capped to the short-lived GitHub access-token lifetime. Community v1 deliberately does not persist the GitHub refresh token.
5. `/community` discovers repositories through `/api/v1/audit/repositories` for that verified installation/user.
6. `POST /api/v1/audit/repository` verifies the target Marketplace installation has the exact ten-file `single_file: read` permission set, then reads those ten control files with the authenticated user token.

The approved Community audit files are documented in `docs/commercial/community-readiness-audit.md`. Audit results are not persisted by the repository-audit endpoint; application source is not read.

### Community plan identity

Community is deliberately outside the paid `ANPOS_MARKETPLACE_PLAN_MAP`. After the genuine free Marketplace plan exists, configure its real numeric ID as:

- `ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID`

The service resolves that ID to `plan_id=community`, `entitlements=[]`, and `paid=false`. The same Marketplace plan ID cannot also appear in `ANPOS_MARKETPLACE_PLAN_MAP`, and `community` is not accepted as a paid-map target. Do not invent a placeholder production plan ID merely to make readiness pass.

## Two-App trust architecture

Production uses two distinct GitHub App registrations and the full commercial service fails closed if their App IDs or private keys are reused.

### Marketplace App — public/customer-facing

The Marketplace App owns the GitHub Marketplace listing and handles Marketplace account reconciliation plus the Community consent surface. It must be installable by customer accounts when the listing is published.

Community permission set:

- baseline repository metadata read;
- **single file: read** for exactly the ten approved ANPOS control paths;
- no broad repository Contents permission for Community readiness;
- no vendor-template Administration permission.

Marketplace Setup/OAuth configuration:

- Setup URL: `/setup/github` on the deployed public HTTPS origin;
- callback URL: `/api/auth/github/callback` on the same origin;
- `request_oauth_on_install=false` so the Marketplace Setup URL remains the explicit entrypoint;
- Setup on update enabled;
- OAuth protected with PKCE and encrypted state.

Community runtime credentials/configuration:

- `DATABASE_URL`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_MARKETPLACE_APP_ID`
- `GITHUB_MARKETPLACE_APP_PRIVATE_KEY`
- `GITHUB_MARKETPLACE_CLIENT_ID`
- `GITHUB_MARKETPLACE_CLIENT_SECRET`
- `ANPOS_PUBLIC_BASE_URL`
- `ANPOS_SESSION_SECRET`
- `ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID`

These values are sufficient for the Community configuration boundary; they intentionally do not include Vendor App credentials, entitlement-signing keys, paid plan mapping, organization-seat policy, or a private-template repository.

### Vendor Distribution App — private/vendor-only

The Vendor App exists only to access the vendor-controlled private commercial template. Keep it private to the publisher account/organization and install it only on the vendor template repository.

Runtime credentials/configuration:

- `GITHUB_VENDOR_APP_ID`
- `GITHUB_VENDOR_APP_PRIVATE_KEY`
- `GITHUB_VENDOR_INSTALLATION_ID`
- `ANPOS_PRIVATE_TEMPLATE_REPO`
- `ANPOS_COMMERCIAL_RELEASE_REF`

`ANPOS_COMMERCIAL_RELEASE_REF` must be the exact 40-character commit SHA of a private template repository state populated from a handoff-verified deterministic template export. `main`, branch names, movable tags, and other mutable refs are rejected.

Minimum permissions:

- archive-first delivery: **Contents: read** on the private template repository;
- optional collaborator provision/revoke: **Administration: write** on the private template repository only when that fallback is explicitly enabled.

This split prevents a customer-facing Marketplace installation from inheriting vendor repository administration capability and prevents a compromise of the Marketplace App credential from automatically granting access to the private template repository.

## Readiness and deployment identity

`GET /api/version` is public and intentionally secret-free. It reports the commercial-service package version, the ANPOS source protocol version embedded into the exported artifact, and the runtime-contract identifier. The response is `Cache-Control: no-store` and does not read deployment secrets.

Production verification must not treat `/api/health` alone as proof that the intended artifact is deployed. `scripts/verify_commercial_production.py --require-ready` requires both `--expected-service-version` and `--expected-protocol-version`; it checks `/api/version` before readiness so a healthy but stale/wrong artifact fails certification.

There are two readiness scopes:

- `GET /api/ready/community` — verifies only the Community/free-first configuration boundary: Marketplace App/OAuth configuration, webhook secret, real Community plan ID, required database migration/schema, and database connectivity. It does **not** require Vendor App, paid entitlement signing, paid plan mapping, organization seats, or private-template distribution.
- `GET /api/ready` — verifies the full paid/vendor commercial configuration, including split-App role/key separation, entitlement signing, paid plan/seat policy, immutable `ANPOS_COMMERCIAL_RELEASE_REF`, migrations/schema, and database readiness.

A green `/api/ready/community` is not evidence that paid plans or vendor distribution are ready. A green full `/api/ready` does not replace the required real Marketplace E2E checks.

Generate exact expected values and GitHub App registration settings from the canonical vendor/operator handoff instead of copying release numbers or URLs manually:

```bash
python scripts/render_operator_launch_bootstrap.py \
  --organization YOUR_GITHUB_ORG \
  --service-base-url https://YOUR-SERVICE.example.com \
  --homepage-url https://YOUR-PRODUCT.example.com
```

The generated public Marketplace App registration URL includes the Setup URL, OAuth callback URL, Setup-on-update behavior, and exact ten-file Community permission scope. The generated environment-key handoff includes the immutable paid release ref requirement. It contains no credentials or live business-authority values.

## Certified Developer release channel

Developer source value is intentionally narrower than future higher tiers and consists of two implemented paid entitlements:

- `private_template_access`
- `protocol_update_channel`

Standard PM/AI provider compatibility is core/capability-dependent ANPOS behavior and is **not** sold as `standard_provider_adapters`.

The paid release flow is fail-closed:

1. Export the customer-facing template deterministically from the certified canonical source.
2. Verify the export with `scripts/verify_vendor_handoff.py` and retain its receipt.
3. Push only those verified bytes to the private vendor template repository and verify a clean checkout again.
4. Set `ANPOS_COMMERCIAL_RELEASE_REF` to that private repository's exact commit SHA.
5. `GET /api/v1/releases/current` reconciles billing, verifies the paid `protocol_update_channel` entitlement and organization seat when applicable, fetches `EXPORT-MANIFEST.json` at that exact ref, and validates deterministic-export identity before returning sanitized release metadata.
6. `GET /api/v1/template/archive` repeats the manifest verification and redirects only to the same exact immutable release for accounts entitled to `private_template_access`.

The manifest gate requires template export mode, exact canonical source revision/tree identities, committed-Git-blob provenance, `tracked_source_only=true`, `contains_secrets=false`, exact file count/byte totals, safe paths/modes, and SHA-256 digests. Failure does not silently fall back to a branch or another release.

This is source implementation evidence, not proof that Developer is live. Real private repositories, real GitHub Apps, real paid Marketplace plan IDs/prices, legal terms, deployment, and paid E2E are still launch gates.

## Recommended distribution architecture

Use `GET /api/v1/template/archive` as the default paid delivery mechanism. GitHub returns a temporary private-repository archive URL for the exact configured release. This avoids permanent repository access and avoids relying on collaborator invitations as the primary scale path.

`POST /api/v1/provision` is an optional collaborator fallback and is disabled unless `ANPOS_COLLABORATOR_PROVISIONING_ENABLED=true`. GitHub limits repository invitations and collaborator mutations require stronger repository permissions, so this mode should not be the default sales path.

## GitHub permissions

Use the minimum permissions needed for each trust boundary:

- Community Marketplace installation: metadata plus `single_file: read` for the exact ten ANPOS control files; actual file reads remain authenticated-user-token-bound.
- Marketplace billing reconciliation: Marketplace App authorization required by GitHub Marketplace.
- Customer identity: GitHub user access token; organization seat administration also requires **Members: read** when that customer-facing capability is used so active organization membership can be verified.
- Vendor release metadata + private-template archive: Vendor App **Contents: read** on the private template repository.
- Optional collaborator provision/revoke: Vendor App **Administration: write** on the private template repository. The service requests operation-scoped installation tokens instead of using the full installation permission set.

Never add vendor-template Administration permission to the Marketplace App merely to support vendor-side provisioning.

## Database migrations

Database DDL is never run by normal API requests. Run migrations explicitly from `commercial-service/`:

```bash
npm run migrate
```

The migrator takes a PostgreSQL advisory lock, applies ordered migrations transactionally, records SHA-256 checksums, and refuses edited applied migrations. Never edit an applied migration in place.

## Deploy

### Community free-first

1. Create/configure the public Marketplace GitHub App using the generated registration URL; verify Setup URL, callback URL, exact ten-file permission scope, webhook, and public visibility.
2. Generate the Marketplace App OAuth client secret and a strong webhook secret; store them only in the deployment secret manager.
3. Create a durable PostgreSQL database, configure `DATABASE_URL`, and run `npm run migrate`.
4. After the genuine free Marketplace plan exists, set its real ID in `ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID`. Keep Community outside `ANPOS_MARKETPLACE_PLAN_MAP`.
5. Configure `ANPOS_PUBLIC_BASE_URL` and a high-entropy `ANPOS_SESSION_SECRET`.
6. Deploy the exact certified service artifact and verify `/api/version` identity.
7. Require `/api/ready/community` HTTP 200.
8. Exercise the real Setup -> PKCE OAuth -> installation-bound repository discovery -> bounded audit flow before activating Community.

### Paid/vendor extension

1. Create the separate private Vendor Distribution GitHub App.
2. Create/populate the verified private commercial-template source and install only the Vendor App with **Contents: read**; add **Administration: write** only if collaborator provisioning is deliberately enabled.
3. Verify the exact private template commit and configure that 40-character SHA as `ANPOS_COMMERCIAL_RELEASE_REF`; do not use a branch/tag.
4. Configure entitlement signing, operator token, Vendor App credentials, paid `ANPOS_MARKETPLACE_PLAN_MAP`, and `ANPOS_ORG_SEAT_LIMITS` using real approved values.
5. Require exact `/api/version`, full `/api/ready`, and authenticated production verification.
6. Exercise `/api/v1/releases/current` and `/api/v1/template/archive` and verify their canonical source revision/tree against retained handoff evidence.
7. Exercise paid purchase, plan-change, cancellation, duplicate delivery, failed-delivery retry, seat assignment/revocation, and access-reconciliation before enabling paid sales.

## API

- `GET /api/health` — process liveness; does not imply artifact identity or readiness.
- `GET /api/version` — public, secret-free service/protocol/runtime-contract identity for deployment attestation.
- `GET /api/ready/community` — Community-only configuration/database readiness; deliberately independent of paid/vendor secrets.
- `GET /api/ready` — full commercial configuration, split GitHub App key types/role separation, paid plan/seat/release policy, migration/schema, and database readiness.
- `POST /api/webhooks/github/marketplace` — GitHub Marketplace webhook receiver.
- `GET /setup/github` — Marketplace Setup entrypoint; starts PKCE GitHub App OAuth from an untrusted setup installation ID.
- `GET /api/auth/github/callback` — OAuth callback; verifies user + installation and creates encrypted short-lived browser session.
- `GET /api/v1/audit/repositories` — list repositories available to the authenticated user for the selected Marketplace installation.
- `POST /api/v1/audit/repository` — run the bounded ten-control-file Community readiness audit; no paid entitlement required.
- `GET /api/v1/keys` — public entitlement verification key for paid portable claims.
- `GET /api/v1/entitlements/current` — refresh a paid entitlement after GitHub identity verification; send `X-ANPOS-Account-Id`. Organization callers need an active assigned seat to receive a signed consumption token.
- `GET /api/v1/releases/current` — entitlement-gated sanitized metadata for the current immutable, deterministic-manifest-verified certified release.
- `GET /api/v1/template/archive` — short-lived archive redirect for the same exact verified release.
- `GET /api/v1/seats` — organization-admin seat list.
- `POST /api/v1/seats` — organization-admin seat assignment by GitHub username.
- `DELETE /api/v1/seats` — organization-admin seat revocation by assigned GitHub user ID.
- `POST /api/v1/reconcile` — operator-only billing reconciliation with `ANPOS_OPERATOR_TOKEN`.
- `POST /api/v1/access/reconcile` — operator-only retry of pending collaborator access revocations.
- `POST /api/v1/provision` — optional authenticated/idempotent collaborator provisioning; disabled by default.

## Organization seats

Organization membership alone is not a paid seat. An organization admin must explicitly assign an active organization member. Seat capacity is taken from GitHub Marketplace `unit_count` when present; otherwise the operator-defined `ANPOS_ORG_SEAT_LIMITS` mapping is required and the service fails closed if capacity cannot be determined.

Community organization installations do not receive paid seat entitlements merely because the Marketplace account type is `Organization`.

Organization paid-consumption entitlements use signed envelope format v2, containing both the canonical organization `subject` and the assigned GitHub user `principal`.

## Expiry and revocation boundary

Cancellation, expiry, or seat revocation may stop future paid entitlement refresh, private archives, certified update metadata, hosted capabilities, premium updates, support, and vendor-template access. They must not remotely modify, delete, encrypt, or intentionally break repositories/code already generated for the customer.

A paid-to-Community transition removes paid feature claims and queues any necessary vendor-template collaborator cleanup without turning ordinary Community use into a Vendor App dependency.

## Commercial boundary

This backend implements technical distribution/entitlement controls, the source implementation of Community readiness, and source-level Developer release-channel value. Product prices, Marketplace plan IDs, taxes, refunds, legal license terms, privacy terms, SLA/support commitments, actual listing publication, external installation evidence, private vendor repository reality, production deployment, and plan activation remain operator-controlled business reality.

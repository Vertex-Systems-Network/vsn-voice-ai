# ANPOS Community — Repository Readiness / Conformance Audit

## Product state

ANPOS Community is source-implemented but **not Marketplace-activated**. Source code, tests, blueprints, or generated GitHub App registration URLs are not evidence of a real public listing, installation, operator activation, or production E2E success.

## Customer flow

1. Customer acquires/installs the public ANPOS Marketplace GitHub App.
2. GitHub redirects to the configured Setup URL: `/setup/github?installation_id=...`.
3. The Setup handler treats `installation_id` as untrusted, creates encrypted short-lived OAuth state plus a PKCE verifier, and redirects to GitHub App OAuth.
4. `/api/auth/github/callback` exchanges the authorization code with PKCE, verifies the GitHub user, and verifies that user can access the selected installation.
5. The service creates an encrypted `HttpOnly; Secure; SameSite=Lax` browser session, capped to the short-lived GitHub access-token window. Community v1 does not persist the GitHub refresh token.
6. `/community` lists repositories available to that authenticated user through the selected installation.
7. The user selects a repository and runs the bounded readiness audit.

## Audit scope

The audit reads exactly these ten ANPOS control files:

- `.ai/manifest.json`
- `config/protocol/instance.json`
- `config/protocol/version.json`
- `config/quality/quality-policy.json`
- `config/security/control-plane-policy.json`
- `config/github/ruleset-policy.json`
- `config/design/design-assurance.json`
- `config/data/data-governance.json`
- `config/release/release-policy.json`
- `config/operations/operations-policy.json`

Application source code is not read by the Community v1 audit.

## Authorization model

Two independent facts are required:

- the target repository must have the public Marketplace App installed with `single_file: read` for the exact ten control paths;
- the requesting GitHub user must independently have repository access.

The Marketplace App installation establishes the approved consent/permission surface. Actual control-file reads use the authenticated GitHub **user access token**, not an app-wide installation token. Browser sessions are additionally bound to the verified Marketplace installation.

A repository name, setup redirect `installation_id`, or cached browser state is never authorization by itself.

## Output

The audit reports one classification:

- `not_anpos`
- `canonical_source`
- `uninitialized_child`
- `active_child`
- `partial_or_malformed`

It also reports readiness, detected protocol state, per-control-file presence/JSON validity, actionable gaps, and limitations.

The v1 audit endpoint does not persist the audit result. The rate limiter stores only its normal bounded request-count window in the commercial database.

## What the audit does not prove

The audit does not inspect or prove:

- application source correctness;
- GitHub branch-protection/ruleset enforcement;
- successful GitHub Actions execution;
- repository secrets or environments;
- deployments or production runtime health;
- PM connection state;
- attached AI runtime availability;
- paid entitlement state;
- Marketplace publication or billing readiness.

File presence is repository configuration evidence only; it is not proof that an external GitHub/platform capability is active.

## Launch gates still required

Before ANPOS Community can be represented as live:

- register/configure the real public Marketplace App with the generated Setup URL, callback URL, webhook and exact ten-file permission set;
- generate/store the App private key, OAuth client secret, webhook secret and session secret only in approved secret management;
- configure the production HTTPS public base URL;
- deploy the exact certified commercial-service artifact;
- run the real Setup URL -> PKCE OAuth -> installation verification -> repository discovery -> audit flow on public/private test repositories;
- verify permission denial, missing installation, suspended installation, malformed ANPOS state, non-ANPOS repository, session mismatch and token-expiry behavior;
- confirm Marketplace listing/compliance requirements against current GitHub documentation immediately before submission;
- explicitly activate the Community plan/listing through operator-controlled Marketplace configuration.

Until those gates pass, `config/licensing/product-catalog.json` intentionally keeps Community outside the active paid plan array and without a Marketplace plan ID.

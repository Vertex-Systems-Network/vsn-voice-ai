# ANPOS Developer Customer Onboarding & Support Boundary

Status: source product documentation blueprint; not evidence that paid Marketplace sales or production onboarding are active.

This guide defines the intended ANPOS Developer onboarding journey and the support boundary that can be represented without inventing a staffed support service or SLA. Customer-facing URLs, screenshots, plan names/prices, support contacts, and billing instructions must be finalized against the real production/Marketplace configuration before publication.

## What Developer onboarding includes

Developer onboarding is **self-service product documentation**. It explains how an entitled customer should move from a verified GitHub Marketplace purchase to the exact certified ANPOS commercial release while preserving provenance.

It does not, by itself, create a contractual support entitlement.

### 1. Confirm the real paid account and entitlement

After the paid Developer plan actually exists and is enabled, the service must reconcile the customer's GitHub Marketplace account server-side. Repository files, a copied plan name, a URL parameter, or a local entitlement cache are not billing authority.

The authenticated entitlement refresh surface is:

- `GET /api/v1/entitlements/current`

The customer must use their verified GitHub identity and the applicable ANPOS account ID. Organization customers may require an explicitly assigned active seat.

### 2. Request the current certified release

For an active entitlement containing `protocol_update_channel`, the intended release metadata surface is:

- `GET /api/v1/releases/current`

The service must resolve the operator-configured `ANPOS_COMMERCIAL_RELEASE_REF`, which is required to be an exact immutable private-template Git commit SHA. The service verifies that commit's deterministic `EXPORT-MANIFEST.json` before returning sanitized release evidence.

A mutable `main`, branch name, or mutable tag is not an acceptable paid release identity.

### 3. Download the same verified release

For an active entitlement containing `private_template_access`, the intended archive surface is:

- `GET /api/v1/template/archive`

Archive delivery must use the same manifest-verified immutable release selected by `ANPOS_COMMERCIAL_RELEASE_REF`; it must not silently redirect the customer to a newer mutable branch.

### 4. Preserve provenance

Customers/operators should preserve the release metadata needed to identify what was delivered, including the sanitized canonical source revision/tree and the immutable vendor release reference where appropriate. Do not treat a filename such as `latest.zip` as release evidence.

The canonical vendor handoff process separately verifies deterministic service/template exports before private repositories are accepted as sources of record.

### 5. Bootstrap or adopt a project

After lawfully obtaining the commercial template, use the ANPOS repository guidance for new-project bootstrap or existing-project adoption. Commercial onboarding does not override the normal read-first/adoption audit, project safety, consent, quality, security, or repository-integrity requirements.

### 6. Provider compatibility is runtime-dependent

Use `config/licensing/provider-compatibility-matrix.json` when explaining Project Management or development-AI compatibility.

- Linear has a dedicated synchronization blueprint, not a bundled provider-specific execution service.
- Other listed PM providers currently use the generic contract/runtime-discovery model.
- Development-AI hosts are selectable only when the active runtime can really invoke/attach/handoff to them and identity/permissions are verified.

Do not promise that every provider is connected or that every generic adapter operation is implemented for every provider.

## Common self-service failure classes

The onboarding material may explain these classes without requiring the customer to expose secrets:

- `entitlement_not_found` — no local/current entitlement record exists for the supplied account; billing/account reality must be reconciled.
- `private_template_not_entitled` or release-channel entitlement denial — the current Marketplace plan does not authorize that paid capability.
- `organization_seat_required` — an organization purchase requires an assigned active seat for consumption.
- release verification/delivery unavailable — the private vendor source, immutable release ref, deterministic manifest, Vendor App access, or production configuration is not valid/available; the service must fail closed rather than serve an unverified mutable release.
- provider unavailable — the current host lacks the declared real connection/invocation path; ANPOS should degrade to repository-canonical operation rather than pretend the provider is attached.

Exact customer-facing error wording may evolve with the service, so published troubleshooting must be verified against the deployed release.

## Information a support request may safely include

When the operator later activates a real support channel, customers should prefer:

- ANPOS request ID;
- sanitized error code;
- service/release version and non-secret release evidence;
- GitHub account type/login only where needed to diagnose account binding;
- affected operation and timestamp;
- redacted logs or screenshots that contain no credentials.

Do **not** request raw passwords, private keys, session cookies, full database connection strings, entitlement signing private keys, GitHub App private keys, webhook secrets, or other customer secrets in ordinary support communications.

## Developer standard support decision

Canonical source does **not** include a staffed Developer support/SLA commitment by default.

Developer can therefore be positioned as:

- certified commercial distribution/update access once external launch gates pass; plus
- self-service onboarding/product documentation.

It must **not** automatically be positioned as including:

- guaranteed initial response times;
- guaranteed resolution times;
- 24/7 staffing;
- live implementation/debugging services;
- custom consulting;
- third-party provider support on behalf of GitHub/Linear/Atlassian/etc.;
- security-incident SLA;
- service credits.

If the operator chooses to include any staffed support, the real support channel, hours/time zone, severity model, response target, escalation path, privacy/retention handling, maintenance/incident communications, exclusions, and legal wording must be approved before sale and must match actual operations.

## Team / Enterprise boundary

The draft catalog contains `commercial_support` for Team and priority/SLA language for Enterprise, but repository source classifies those as **external contract required**. They are not activated merely by appearing in a plan definition.

A Team/Enterprise support offer must be separately operationalized and contracted. Numeric SLA commitments must not be copied from examples or invented for launch readiness.

## Non-destructive cancellation remains mandatory

Loss of entitlement may stop future premium release access, updates, hosted capabilities, provisioning, or support where applicable. It must not delete, encrypt, remotely modify, or intentionally break customer repositories already generated or lawfully obtained while entitled.

## Publication gate

Before this guide becomes customer-facing onboarding material, verify all of the following:

1. the real Marketplace plan and purchase/account flow exist;
2. the deployed service exposes the expected current endpoints and exact artifact identity;
3. the private service/template repositories exist and have independently verified immutable source-of-record commits;
4. `ANPOS_COMMERCIAL_RELEASE_REF` is configured to the exact verified private-template commit;
5. paid entitlement/release/archive flows pass real production E2E;
6. all URLs, support contacts and screenshots match production;
7. any support commitment shown to customers is real, monitored, operationally supportable and legally approved.

Until those gates pass, this document is source productization evidence only, not proof of live paid onboarding.

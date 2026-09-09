# ANPOS Commercial Package Architecture

Status: productization design; not launch authorization.

This document translates the capabilities that ANPOS actually implements into a commercial package strategy. It deliberately separates current product truth from future promises. Prices, Marketplace plan IDs, legal rights, support commitments, private-repository reality, production deployment, and launch approval remain operator-controlled.

## Product truth discovered by the repository audit

ANPOS currently provides a broad AI-native project operating protocol rather than a single prompt or coding-agent wrapper. Its core customer-facing capability surface includes:

- free-form project intake followed by research, market comparison, comparable-system audit, planning, architecture, technology consent, professional UI/UX, development/DevOps, SQA, and security hardening;
- runtime-discovered project-management selection, including Linear, GitHub Projects, Jira, ClickUp, GitLab, Azure DevOps, Plane, Asana, monday.com, and Notion when the current host has a real connection path;
- runtime-discovered development-AI selection, including Codex/ChatGPT, Claude Code, GitHub Copilot, Gemini, Cursor, Windsurf, and other verified compatible agents;
- Supervisor/Worker multi-agent coordination with identity, permission, claim/lease, fencing, review, and merge controls;
- repository-integrity and stack-specific quality gates plus optional CodeQL, Dependency Review, OSSF Scorecard, Dependabot, governance audit, innovation watch, and technology/protocol update workflows;
- design assurance with responsive evidence, visual-regression expectations, and a default WCAG 2.2 AA web accessibility target;
- data classification/governance, release governance, operational readiness, incident/recovery policy, and continuous-improvement controls;
- a source-implemented Community Marketplace flow for authenticated, installation-bound, read-only ANPOS repository readiness auditing;
- an implemented commercial runtime for GitHub Marketplace webhook handling, entitlement reconciliation, signed paid entitlements, organization seats, private-template distribution, certified paid release metadata, and non-destructive cancellation.

These are the strongest current product assets and should be the basis of positioning.

## Audit correction to the draft paid catalog

The Developer, Pro, Team, and Enterprise IDs remain useful compatibility anchors, but entitlement labels may be marketed only when repository evidence and external launch evidence support them.

Standard provider compatibility is part of the **core/capability-dependent ANPOS product**, not a paid `standard_provider_adapters` entitlement. ANPOS can select/use providers only when the active host/runtime exposes a real compatible connection or invocation path. A future paid provider claim must be a separately implemented premium adapter with explicit support/evidence.

### Provider compatibility truth levels

`config/licensing/provider-compatibility-matrix.json` is the machine-readable authority for how those provider names may be described commercially. It is deliberately conservative:

- **Linear** has a dedicated ANPOS synchronization blueprint (`config/integrations/linear-sync.json`), but that blueprint still requires a real runtime connection and does **not** mean a complete provider-specific execution adapter, OAuth service, hosted integration, or vendor-certified integration is bundled.
- **GitHub Projects, Jira, ClickUp, GitLab, Azure DevOps, Plane, Asana, monday.com, and Notion** currently have the generic provider-agnostic adapter contract plus declared connection modes only. Their status is runtime-discovery/contract-only until a real host connection and provider-specific behavior are verified.
- **Codex/ChatGPT, Claude Code, GitHub Copilot, Gemini, Cursor, Windsurf, and other compatible development agents** are runtime-discovery candidates, not bundled ANPOS adapters. Selection is not authorization; runtime identity and least-privilege permissions remain required.
- The matrix explicitly makes no vendor-partnership/certification claim and no paid-entitlement claim. Tests bind provider IDs, names and connection modes back to the canonical PM/AI catalogs so marketing truth cannot silently drift from repository truth.

This matrix is a support/compatibility truth boundary, not a promise that every operation in the generic adapter interface is implemented for every provider. Premium provider adapters remain a future Pro-or-higher differentiator only after separate implementation, versioning, tests and evidence exist.

### Onboarding and support truth

`config/licensing/customer-onboarding-support.json` and `docs/commercial/customer-onboarding-support.md` define the Developer onboarding/support boundary.

Developer source includes **self-service onboarding/product documentation** for entitlement refresh, certified release discovery, immutable archive delivery, provenance preservation and runtime-dependent provider troubleshooting. This onboarding documentation is product material; it is not a staffed support entitlement.

Canonical Developer therefore does **not** include a guaranteed response time, guaranteed resolution time, 24/7 staffing, live implementation/debugging service, security-incident SLA or service credits by default. Any real staffed support offer requires an operator-approved channel, hours/time zone, response/escalation policy, privacy handling and customer-facing legal terms before sale.

Team `commercial_support` and Enterprise priority/SLA claims remain external-contract-required. Numeric SLA commitments are not defined in canonical source.

The following higher-tier labels are not yet independently productized enough to sell without qualification:

- `premium_blueprints` — canonical source now defines a private Premium Pack manifest/schema/verifier boundary, but no private premium repository or blueprint payload is evidenced yet;
- `premium_provider_adapters` — canonical source now defines provider-specific private-pack verification requirements, but no private premium adapter payload or live provider evidence is implemented yet;
- `hosted_orchestrator_when_offered` — orchestration protocol exists, but no ANPOS-operated hosted orchestrator is implemented;
- `hosted_or_self_hosted_orchestrator_when_offered` — no supported hosted/self-hosted commercial distribution package exists yet;
- `enterprise_policy_controls` — strong policy foundations exist, but no enterprise-only administration/policy product surface is separately implemented;
- `commercial_support` and `priority_support_or_sla_when_contracted` — these require deliberate operator service terms and legal/operational commitments.

The Pro private-pack preparation boundary is defined by `config/licensing/premium-pack-contract.json`, `schemas/premium-pack-manifest.schema.json`, `scripts/verify_premium_pack.py`, and `docs/commercial/premium-pack-boundary.md`. This contract rejects unmanifested/tampered files, symlinks/path traversal, selected secret markers, invalid provider/capability mappings, incompatible protocol ranges, mutable-release assumptions, and byte-for-byte copies of canonical tracked files. A passing receipt certifies pack integrity only; it does not prove that premium assets exist in the vendor's private source, activate Pro billing, or establish production entitlement-gated distribution.

`private_template_access` and `protocol_update_channel` now have implemented commercial-service source paths. Paid delivery is bound to an exact `ANPOS_COMMERCIAL_RELEASE_REF` commit in the private vendor template repository, and the service verifies that commit's deterministic `EXPORT-MANIFEST.json` before returning certified release metadata or redirecting the archive. These are meaningful Developer source capabilities, but they are **not sale activation evidence** until the private repositories, Apps, paid Marketplace configuration, prices/legal terms, production deployment, and E2E are real and verified.

The authoritative implementation/readiness classification is recorded in `config/licensing/feature-catalog.json`.

## Recommended package model

### ANPOS Community — free acquisition product

Purpose: provide genuine GitHub-integrated value, build adoption, and create the installation base needed for later paid Marketplace eligibility.

Implemented source value:

- public Marketplace App registration/setup blueprint;
- Marketplace Setup URL → PKCE GitHub App OAuth flow;
- encrypted short-lived browser session;
- installation-bound repository discovery;
- read-only ANPOS Repository Readiness / Conformance Audit over exactly ten approved ANPOS control files;
- structured result covering ANPOS presence/version, bootstrap state, repository-integrity posture, available quality/security capabilities, and actionable setup gaps;
- no application-source-code read by the audit;
- no private-template entitlement, paid organization seat, premium content, hosted orchestration, or paid support.

Current state: **source implemented; externally unlaunched**. A genuine free Marketplace plan ID, real public App/configuration, production deployment, `/api/ready/community`, Setup/OAuth/repository/audit E2E, listing assets/policies, and explicit operator activation are still required. Source implementation must not be represented as a live Marketplace product.

Community remains outside the paid `plans` array and outside `ANPOS_MARKETPLACE_PLAN_MAP`; its real free plan identity is configured separately through `ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID` after that plan exists.

### ANPOS Developer — individual commercial foundation

Target: solo developers, founders, consultants, and small technical projects that want an entitlement-controlled certified ANPOS commercial distribution/update channel.

Implemented source value:

- one-seat-compatible paid entitlement model;
- `private_template_access`;
- `protocol_update_channel`;
- server-side Marketplace reconciliation before release access;
- immutable paid release selection through exact 40-character `ANPOS_COMMERCIAL_RELEASE_REF`;
- deterministic `EXPORT-MANIFEST.json` verification at that exact private-repository commit;
- entitlement-gated `GET /api/v1/releases/current` returning sanitized canonical source revision/tree and release evidence;
- entitlement-gated `GET /api/v1/template/archive` serving the same exact verified release;
- organization-seat enforcement when the paid purchaser is an organization;
- non-destructive cancellation/expiry;
- tested self-service onboarding documentation with a fail-closed support boundary and no implicit SLA.

Core compatibility available alongside every package is governed by `config/licensing/provider-compatibility-matrix.json`; it is not a Developer-only paid entitlement and must not be used to inflate Developer differentiation.

Still required before sale:

- operator-approved commercial license/EULA, Privacy/Terms/refund/cancellation boundaries;
- real private vendor service/template repositories populated only from verified deterministic exports;
- real Marketplace/Vendor GitHub Apps and production secrets;
- real paid Marketplace plan ID and approved monthly/annual pricing;
- deployed current commercial-service identity and full `/api/ready`;
- real paid purchase/change/cancel/trial and Developer release/archive E2E;
- if staffed support is offered, real monitored contact/escalation operations plus approved customer-facing support terms.

Current state: **source value implemented, not yet sale-ready**. The remaining Developer blockers are mainly external commercial/infrastructure/legal/production evidence rather than missing release-channel, provider-truth, or self-service-onboarding subsystems.

### ANPOS Pro — advanced automation and premium assets

Target: power users and professional AI-native developers who need more reusable premium automation than Developer.

Target deliverables:

- everything in Developer;
- a real versioned Premium Blueprint Pack with clearly enumerated files/capabilities;
- concrete Premium Provider Adapters with a provider/version/capability matrix that is distinct from the core compatibility matrix and backed by provider-specific implementation/tests;
- advanced governance/automation recipes that are not simply copies of the public core;
- hosted orchestration only after an ANPOS-operated hosted service exists and is production-certified.

Source preparation now implemented:

- a private premium-pack contract defining allowed asset classes and paths;
- JSON Schema for `ANPOS-PREMIUM-MANIFEST.json`;
- a verifier that binds file SHA-256/bytes, capability/provider mapping, protocol compatibility, no-secret provenance, private immutable distribution intent, and rejects exact copies of canonical tracked files;
- explicit truth that passing the verifier does not set `pro_sale_ready=true`.

Current state: **contract/verifier implemented; premium payload still not implemented**. Do not market `premium_blueprints`, `premium_provider_adapters`, or hosted orchestration as active customer value until a real private premium repository contains distinct assets, passes verification, is distributed behind active entitlement, and passes production E2E.

### ANPOS Team — organization collaboration

Target: engineering teams using ANPOS across several developers.

Target deliverables:

- everything in Pro;
- organization purchasing and seat capacity;
- admin seat assign/list/revoke flows;
- principal-bound organization entitlements;
- team onboarding and access reconciliation;
- customer-facing team administration/billing experience;
- defined commercial support scope.

Current state: **partially implemented**. Seat enforcement and organization entitlement mechanics exist in the commercial service; the complete production/customer experience and all Pro dependencies still need to be finished and verified. A support entitlement remains inactive until real support operations/terms are approved.

### ANPOS Enterprise — controlled rollout and contracted service

Target: organizations requiring policy governance, self-hosting/controlled deployment, procurement, and contractual support.

Target deliverables before offering:

- everything in Team;
- enterprise-only policy/control packs or administration surfaces that are concretely distinct from the core;
- organization rollout/governance guidance and audit evidence;
- self-hosted orchestrator/distribution option only if actually productized and supportable;
- security/privacy deployment-boundary documentation;
- negotiated support/SLA, legal terms, and enterprise onboarding.

Current state: **future / contract-led**. It should not be presented as a standard self-serve Marketplace plan until the enterprise-exclusive surfaces and operating model exist. A custom external contract may be more appropriate initially.

## Recommended pricing position after applicable launch gates pass

Pricing below is a product-positioning target, not an authorized billing configuration and must not be written into live Marketplace settings without operator approval and current market/platform review.

| Package | Suggested target | Annual target | Pricing logic |
| --- | ---: | ---: | --- |
| Community | $0 | $0 | Adoption + genuine Marketplace-integrated repository audit |
| Developer | $19/month | $190/year | Verified private distribution + certified immutable release/update access + self-service onboarding |
| Pro | $39/month | $390/year | Developer + real premium blueprint/adapter layer once implemented |
| Team | $29–39/user/month | annual discount | Pro + organization seats/admin/support when complete; per-unit where suitable |
| Enterprise | Custom | Annual contract | Policy/control, deployment, procurement, SLA/support commitments |

ANPOS currently does not include bundled LLM inference/compute. Until hosted orchestration or other high-cost services exist, pricing should not assume the cost/value profile of products that bundle large AI usage quotas.

## Package implementation order

1. **Feature truth** — maintain `config/licensing/feature-catalog.json`, the tested core `provider-compatibility-matrix.json`, and the onboarding/support scope; prevent unsupported package/provider/support claims.
2. **Community source product** — implemented; finish real Marketplace App/listing/production E2E and activation.
3. **Developer source foundation** — release/update distribution, provider-claim truth, and self-service onboarding/support boundary are implemented; finish private vendor repositories, legal/pricing, Marketplace configuration, deployment, and paid E2E.
4. **Premium layer** — private-pack contract/schema/verifier are implemented; create actual private premium blueprints/adapters, certify an immutable pack, then add entitlement-gated distribution and production E2E before activating Pro differentiation.
5. **Team product** — complete production seat/admin/billing UX and operationally approved support policy.
6. **Enterprise product** — build enterprise-only control/deployment assets and contractual operating model.
7. **Pricing activation** — approve real monthly/annual prices and map actual Marketplace plan IDs only after the applicable package is operational and current GitHub requirements have been rechecked.

## Launch rules

- Do not convert an entitlement label into a marketing claim merely because it exists in `product-catalog.json` or `commercial-service/lib/plans.ts`.
- Do not call a capability hosted unless an ANPOS-operated production service actually exists and has production evidence.
- Do not call all listed PM systems or AI agents bundled integrations; use the tested provider compatibility matrix and require a real compatible connection/invocation path.
- Linear's dedicated synchronization blueprint is not evidence that a complete provider-specific execution adapter or hosted integration is bundled.
- Standard provider compatibility is core/capability-dependent and must not be charged/advertised as `standard_provider_adapters`.
- Self-service onboarding documentation is not a staffed Developer support entitlement and must not be marketed as an SLA.
- Paid release delivery must use the exact handoff-verified private-template commit in `ANPOS_COMMERCIAL_RELEASE_REF`; mutable branches/tags are forbidden.
- A premium-pack verification receipt proves integrity/provenance of an actual private pack only; it does not activate billing, entitlement, provider compatibility, hosted service, or Pro sale readiness.
- Do not represent source implementation as Marketplace activation, production deployment, pricing approval, legal readiness, or staffed support readiness.
- Do not represent the public canonical repository as open source unless an explicit approved license grants those rights; repository visibility is not itself a software license.
- Do not publish Community until its real GitHub-integrated flow passes production E2E.
- Do not publish Developer until the real private vendor source, paid Marketplace/configuration, legal/pricing, production identity/readiness, and release/archive E2E pass.
- Do not publish higher paid plans until their additional product value is separately implemented and current GitHub Marketplace requirements/all ANPOS launch gates are re-verified.
- Cancellation or expiry must remain non-destructive to already-generated customer projects.

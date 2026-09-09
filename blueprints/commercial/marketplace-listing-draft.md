# ANPOS GitHub Marketplace Listing Draft

> Draft only. Operator review, publisher verification, legal review, final pricing, tax treatment, support commitments, screenshots, and GitHub Marketplace approval are required before publication.

## Product name

ANPOS — AI Native Project Operating System

## Short description

A production-focused AI-native Git project operating system for structured planning, multi-agent development, quality, security, governance, and controlled commercial distribution.

## Full description

ANPOS helps teams start and operate software projects with a reusable AI-native protocol instead of ad-hoc prompting. It provides deterministic project initialization, provider-agnostic project-management integration, selectable development AIs, Supervisor/Worker coordination, security and quality gates, release/data/operations assurance, traceability, and optional commercial entitlement services.

Core customer projects are not remotely disabled when a commercial entitlement expires. Expiry may stop future premium updates, provisioning, hosted services, or support according to verified entitlement state and the final customer agreement.

## GitHub App trust architecture

ANPOS commercial production uses **two distinct GitHub Apps**:

1. **Marketplace App — public/customer-facing.** This App owns the GitHub Marketplace listing, is installable by customer accounts, receives Marketplace events, and is used for Marketplace account reconciliation. It must not be granted vendor private-template Administration permission merely to support vendor-side delivery.
2. **Vendor Distribution App — private/vendor-only.** This App is installed only on the vendor-controlled private commercial-template repository. Archive-first delivery requires Contents: read. Optional collaborator provisioning may require Administration: write on the vendor repository only.

The two App IDs and private keys must be different. Production readiness fails closed if the roles collapse or the same private key is reused. The deprecated single-App blueprint is retained only as a migration marker.

This separation keeps customer installation consent independent from privileged vendor repository access and reduces the blast radius of either App credential.

## GitHub Marketplace compliance baseline

The machine-readable baseline is `blueprints/commercial/github-marketplace-compliance.json`. It was checked against official GitHub documentation on **2026-09-04** and must be re-verified immediately before Marketplace submission because GitHub requirements may change.

For Marketplace publication and paid conversion, the current baseline requires or records:

- the customer-facing Marketplace GitHub App is public/installable by other GitHub accounts;
- the Marketplace App is separate from the private Vendor Distribution App;
- customer installations are not asked for vendor-template Administration permission;
- the paid Marketplace App is owned by an organization;
- an organization owner controls/submits the Marketplace listing;
- verified-publisher prerequisites include a verified organization domain, confirmed contact email, and organization-wide two-factor authentication;
- paid publication requires publisher verification and financial onboarding;
- GitHub currently documents a minimum of **100 GitHub App installations** before a paid listing can be published;
- every paid plan has both a monthly and annual price in USD and uses a Marketplace-supported pricing model;
- valid publisher contact information, relevant product description, pricing, privacy policy, support URL/email, and working relevant links;
- the product integrates with GitHub beyond authentication and is publicly available rather than public-preview/invite-only;
- Marketplace plan-change/cancellation webhook handling is configured;
- listing artwork includes a compliant logo, feature card, and screenshots;
- paid purchase/change/cancellation flows are handled, including free-trial flows when enabled;
- the customer-facing billing experience shows plan/price, plan changes, cancellation/trial state, billing cycle, and usage/remaining resources where applicable;
- if Marketplace free trials are offered, re-verify the current GitHub trial behavior and private-data deletion requirement before launch. The 2026-09-04 baseline records a 14-day trial and deletion of private customer data within 30 days after a cancelled trial.

None of these repository statements prove that the external requirements have been met. App registrations, installation count, publisher verification, financial onboarding, legal URLs, support contacts, prices, plan IDs, listing approval, and production evidence must come from real external state.

## Recommended staged publication path

While paid eligibility evidence is missing, `blueprints/commercial/marketplace-staged-launch.json` recommends **free-first then paid**:

1. Define a real free offering that provides GitHub-integrated value beyond authentication. The repository does not invent a Community plan or its entitlements.
2. Publish a free Marketplace listing only after the general listing, privacy, support, asset, public-App/installability, public-availability and purchase/cancellation webhook requirements are met.
3. Accumulate genuine installations and operating evidence; never manufacture or buy installations merely to reach an eligibility threshold.
4. Once current paid requirements are met—including the documented installation threshold—complete verified-publisher and financial onboarding.
5. Add approved paid plans to the existing free listing. GitHub's current documentation supports adding paid plans later after verification/onboarding.

This staged route does **not** alter the draft Developer, Pro, Team, or Enterprise product catalog. Any free plan definition and entitlements remain an explicit operator product decision and must be tested against runtime authorization before publication.

## Suggested plans

All prices and Marketplace plan IDs remain operator-controlled and must be configured outside this repository. The current Marketplace baseline supports at most 10 plans; ANPOS proposes four logical paid tiers. A separate free acquisition plan may be defined only if the operator deliberately approves real user value and entitlements.

### Developer

Suggested audience: individual developers.

Possible entitlements:
- one active personal GitHub account;
- premium ANPOS update access;
- private commercial template delivery;
- standard support;
- no organization seats.

### Pro

Suggested audience: professional individual developers/consultants.

Possible entitlements:
- Developer features;
- premium adapters/blueprints;
- enhanced update/support access;
- hosted orchestration features when separately offered.

### Team

Suggested audience: engineering teams.

Possible entitlements:
- explicit organization seat assignment;
- Team-level premium features;
- shared project-management integrations;
- controlled seat capacity;
- organization entitlements remain principal-bound to assigned users.

### Enterprise

Suggested audience: larger organizations.

Possible entitlements:
- negotiated seat capacity;
- self-hosting/advanced deployment options where offered;
- organization governance and audit features;
- custom support/SLA only when contractually approved.

## Required listing URLs and contacts

- Homepage: `[OPERATOR REQUIRED]`
- Documentation: `[OPERATOR REQUIRED]`
- Publisher/contact information: `[OPERATOR REQUIRED]`
- Support URL and/or support email: `[OPERATOR REQUIRED]`
- Privacy Policy: `[OPERATOR REQUIRED]`
- Terms of Service: `[OPERATOR REQUIRED]`
- License/EULA: `[OPERATOR REQUIRED]`
- Status page: `[OPTIONAL / OPERATOR REQUIRED]`

All published links must resolve to relevant working pages.

## Required listing assets

- App logo: `[OPERATOR REQUIRED]`
- Feature card: `[OPERATOR REQUIRED]`
- Screenshots: `[OPERATOR REQUIRED]`
- GitHub brand/logo usage review where GitHub marks are used: `[OPERATOR REQUIRED]`

## Required Marketplace configuration

- organization-owned **public Marketplace GitHub App** for customer installation/listing;
- separate **private Vendor Distribution GitHub App** for vendor private-template access;
- distinct App IDs and private keys; no role/key reuse;
- organization-owner control of listing submission;
- verified publisher prerequisites and approval before paid publication;
- current minimum-installation threshold for paid GitHub Apps;
- financial onboarding before paid publication;
- actual monthly and annual USD price decisions for each paid plan;
- real Marketplace plan IDs;
- Marketplace App ID/private key and strong Marketplace webhook secret;
- Vendor App ID/private key, vendor installation ID, and private commercial-template repository;
- production issuer/base URL;
- customer billing/status experience;
- support/refund/cancellation/trial policy;
- tax handling;
- final legal review.

## Safety statements

- Repository files are never billing authority.
- Existing generated customer projects are not deleted, encrypted, remotely modified, or intentionally broken when an entitlement expires or is cancelled.
- Organization membership alone is not a licensed seat.
- Archive-first private delivery is preferred; collaborator provisioning is optional and disabled by default.
- Vendor repository Administration permission belongs only to the private Vendor Distribution App when explicitly required; it must not be added to the customer-facing Marketplace App merely for vendor delivery.
- A free-first listing must deliver real product value and cannot be used as an installation-count shell.
- No final price, legal promise, uptime SLA, tax treatment, refund right, warranty, installation count, publisher verification, or Marketplace approval is created by this draft.

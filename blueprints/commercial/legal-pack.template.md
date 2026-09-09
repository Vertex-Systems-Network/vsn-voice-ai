# ANPOS Commercial Legal Pack Template

> **Template only — not legal advice and not a final customer agreement.** The operator must supply the real legal entity, jurisdiction, addresses, tax treatment, prices, refund rights, warranties, liability limits, data-controller/processor roles, subprocessors, support commitments, and any mandatory local consumer/business terms. Obtain qualified legal/accounting review before publication or sale.

## Operator identity — required before publication

- Legal entity: `[OPERATOR REQUIRED]`
- Registered address: `[OPERATOR REQUIRED]`
- Country/jurisdiction: `[OPERATOR REQUIRED]`
- Verified organization domain used for Marketplace publisher verification: `[OPERATOR REQUIRED]`
- Publisher/contact email: `[OPERATOR REQUIRED]`
- Support contact: `[OPERATOR REQUIRED]`
- Legal/privacy contact: `[OPERATOR REQUIRED]`
- Tax/VAT identifiers where applicable: `[OPERATOR REQUIRED]`
- Effective date/version: `[OPERATOR REQUIRED]`

---

# Terms of Service — template

## Service scope

Describe ANPOS commercial distribution, premium updates, private template delivery, hosted services (if any), support, seats, and any Enterprise-specific services actually sold.

## Account and eligibility

State GitHub-account requirements, organization seat assignment rules, authorized use, account security obligations, and age/business eligibility as applicable.

## Billing and subscriptions

State the actual Marketplace plans, monthly and annual billing options, taxes, upgrades/downgrades, renewal behavior, cancellation timing, refunds/credits, and GitHub Marketplace billing relationship. Repository drafts do not define price or refund rights.

If a GitHub Marketplace free trial is offered, verify the current GitHub trial duration and conversion behavior immediately before publication. The 2026-09-04 GitHub documentation baseline records a 14-day Marketplace free trial that converts to the paid plan unless cancelled before trial end. Do not promise or implement trial terms from this template without re-verification and legal review.

## Customer billing visibility

Describe where customers can see their current plan and price, purchases, upgrades/downgrades, cancellations, trial status/remaining time, monthly-vs-annual billing cycle, and usage/remaining resources when relevant to the plan. Customer-facing behavior must match verified Marketplace state.

## Entitlements

State that server-side verified entitlement is authoritative for future premium provisioning, updates, hosted services, and support. Organization membership alone does not create a licensed seat.

## Non-destructive expiry/cancellation

Cancellation or expiry may stop future premium token refresh, updates, provisioning, hosted services, or support, but must not delete, encrypt, remotely modify, or intentionally break customer repositories already generated or lawfully obtained while entitled.

## Acceptable use

Define prohibited abuse, credential sharing, unauthorized redistribution/resale, attempts to bypass licensing, attacks on the service, unlawful use, and misuse of hosted resources.

## Suspension

Define narrowly scoped suspension rights for security, fraud, abuse, legal requirements, chargeback/billing failure, or material breach. Preserve the non-destructive customer-project rule.

## Intellectual property

Define ownership of ANPOS/vendor materials, customer project code, customer inputs, third-party/open-source components, generated artifacts, trademarks, and feedback.

## Warranties / disclaimers

`[LEGAL REVIEW REQUIRED]`

## Liability / indemnity

`[LEGAL REVIEW REQUIRED]`

## Termination

Define termination effects, data retention/deletion, entitlement revocation, support termination, and surviving terms. Do not introduce a remote kill switch for generated customer repositories.

## Governing law / disputes

`[LEGAL REVIEW REQUIRED]`

---

# Commercial License / EULA — template

## Grant

Define the license granted to a customer for the private commercial template, premium ANPOS materials, updates, and documentation. Specify personal/team/enterprise scope and whether use is per account, per seat, per organization, per project, or another approved metric.

## Permitted use

Allow normal internal software development according to the purchased plan. State whether generated child/project repositories may continue to be used after subscription expiry.

## Restrictions

Define restrictions on reselling the ANPOS product itself, redistributing vendor-only commercial-service source, publishing private premium templates, removing notices where legally enforceable, credential sharing, and deliberate license circumvention.

## Customer project ownership

Clarify ownership/licensing of customer-created project code and that lawful generated projects are not remotely destroyed or disabled merely because future premium entitlement ends.

## Open-source / third-party software

State that third-party components remain governed by their respective licenses.

## Updates

Define entitlement to future versions/updates during an active plan and how discontinued/legacy versions are handled.

---

# Privacy Policy — template

## Data categories

Potential categories include GitHub numeric account ID/login/type, organization/seat assignments, Marketplace plan/subscription state, delivery identifiers/payload hashes, entitlement/audit/provisioning records, request IDs, security/rate-limit data, support communications, and minimal operational logs.

Do not claim collection of categories the deployed service does not actually collect.

## Payment data

State that payment-card handling is performed by the applicable billing provider/GitHub Marketplace when true; ANPOS commercial service should not store raw payment-card data.

## Purposes / lawful basis

`[LEGAL/JURISDICTION REVIEW REQUIRED]`

## Sharing / subprocessors

List actual providers such as GitHub, Vercel, Neon, email/support/observability providers, and any other production subprocessor only after confirmed use.

## Retention

Define retention for active subscriptions, cancelled trials, audit/security records, support tickets, backups, and legal/accounting obligations. Match configured deletion/retention behavior.

For a cancelled GitHub Marketplace free trial, the 2026-09-04 GitHub documentation baseline expects private customer data to be deleted within **30 days** of the cancellation event. Re-verify the current GitHub requirement before publication, classify what constitutes private customer data in the deployed service, document lawful retention exceptions where applicable, and implement/test deletion so the privacy policy matches reality.

## Security

Describe controls truthfully: signed webhooks, short-lived credentials/tokens, least privilege, secret storage, audit logging, rate limits, backups, and incident handling where actually deployed.

## International transfers / data residency

`[LEGAL/OPERATOR REQUIRED]`

## Rights / requests

`[LEGAL/JURISDICTION REQUIRED]`

## Contact

`[OPERATOR REQUIRED]`

---

# Refund / Cancellation Policy — template

Define:
- when cancellation becomes effective;
- whether partial-period refunds/credits are available;
- treatment of upgrades/downgrades;
- treatment of monthly vs annual billing-cycle changes;
- duplicate/erroneous charges;
- free-trial conversion/cancellation when trials are enabled;
- chargebacks;
- statutory rights that cannot be waived;
- how support requests are submitted.

The final wording must match GitHub Marketplace rules, actual configured pricing/trial behavior, and applicable law.

---

# Support / SLA Policy — template

Do not promise an SLA until operational monitoring, staffing, escalation, maintenance windows, incident communications, service credits (if any), exclusions, and response targets are approved.

Possible plan dimensions:
- support channel;
- support hours/time zone;
- initial response target;
- severity classification;
- security incident channel;
- maintenance notices;
- Enterprise escalation path.

All numeric commitments remain `[OPERATOR REQUIRED]` until approved.

---

# Publication gate

These templates may be converted into customer-facing documents only after:
1. operator identity, organization ownership and jurisdiction are known;
2. Marketplace publisher prerequisites, listing ownership/submitter role and financial onboarding are verified;
3. actual monthly/annual plans, prices, refund behavior and any trial behavior are configured;
4. production data flows/subprocessors and customer billing/status UX are verified;
5. cancelled-trial private-data deletion behavior is implemented/tested when applicable and current GitHub retention requirements are re-checked;
6. tax treatment is approved;
7. support/SLA promises are operationally supportable;
8. legal/accounting review appropriate to the business/jurisdiction is complete;
9. final URLs/versions are recorded in the production launch evidence.

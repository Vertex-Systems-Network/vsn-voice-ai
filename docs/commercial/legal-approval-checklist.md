# ANPOS Commercial Legal Approval Checklist

Status: **operator/counsel decision workflow; not legal advice and not sale authorization**.

This checklist turns the remaining commercial legal gate into an explicit evidence workflow. The customer-facing legal pack template is `blueprints/commercial/legal-pack.template.md`; the machine-readable approval state is `config/licensing/legal-approval.json`.

## What this repository can do

Canonical source may:

- define the commercial safety boundary and non-destructive licensing invariant;
- provide templates for Terms, EULA/license, Privacy, refund/cancellation and support/SLA documents;
- list the decisions and production evidence required before publication;
- validate that unapproved template source remains fail-closed;
- prevent draft pricing, source certification or Marketplace eligibility from being mistaken for legal approval.

Canonical source does **not** choose the operator's legal entity, jurisdiction, taxes, governing law, refund rights, consumer/business eligibility, liability terms, privacy lawful basis, international-transfer position or contractual support commitments.

## Approval sequence

### 1. Operator identity

Record and verify the real selling entity, registered address, jurisdiction, publisher/contact information, legal/privacy contact, support contact and applicable tax/VAT identifiers.

Do not publish a customer agreement under a placeholder or unverified seller identity.

### 2. Product and billing facts

Freeze the specific commercial release being reviewed and record the real product facts that legal text must match:

- packages actually offered;
- actual Marketplace plan IDs;
- monthly/annual prices and billing models;
- trial behavior if enabled;
- upgrade/downgrade/cancellation behavior;
- refund/credit policy;
- seat and entitlement behavior;
- what happens after cancellation/expiry;
- whether any staffed support or SLA is actually offered.

Draft targets in repository planning are not approved billing terms.

### 3. Terms and EULA/license

Convert the templates into operator-owned customer documents and review at minimum:

- license grant and permitted commercial use;
- personal/organization/seat scope;
- ownership and permitted continued use of customer-generated projects;
- restrictions on redistribution of ANPOS vendor/private premium material;
- acceptable use and narrowly scoped suspension rights;
- update entitlement during an active subscription;
- termination effects;
- warranties/disclaimers, liability and indemnity language;
- governing law and dispute process.

The non-destructive invariant remains mandatory: entitlement loss must not remotely delete, encrypt or intentionally break customer-generated repositories/code.

### 4. Privacy and data operations

Verify actual production behavior before approving Privacy text. Record:

- data categories actually processed;
- GitHub Marketplace/GitHub App account and subscription data;
- database, hosting, support and observability providers actually used;
- processor/controller roles where applicable;
- retention/deletion schedules;
- backup retention interactions;
- customer rights/request process;
- international transfer/data residency position;
- incident/security contact;
- support-communication retention.

Do not publish a privacy statement that describes planned architecture instead of deployed behavior.

### 5. Refund, cancellation and tax/accounting

Approve the real cancellation effective date, partial-period refund/credit rules, upgrade/downgrade treatment, annual/monthly changes, duplicate charges, trial conversion/cancellation and statutory rights that cannot be waived. Verify tax/VAT/accounting treatment appropriate to the selling entity and customer model.

### 6. Support/SLA

Developer self-service product documentation does not create a staffed support SLA. Team/Enterprise support remains inactive until the operator has a real monitored channel, staffing, hours/time zone, escalation path, privacy handling and any approved contractual response targets.

No numeric SLA should be copied into customer documents merely to fill a template.

### 7. Qualified review

Record appropriate legal review for the actual seller/jurisdiction and accounting/tax review where applicable. Store only non-secret review evidence/reference metadata in repository-controlled approval records; confidential legal communications should remain in their appropriate protected system.

### 8. Explicit operator approval

Only after every applicable gate is satisfied should an authorized operator record the reviewed release/version and explicit sale approval through the operator-controlled release process.

Canonical template source intentionally keeps:

- `approved_for_sale = false`;
- `operator_explicit_sale_approval = false`;
- document statuses pending/not activated;
- approval/reviewer/evidence fields empty.

Source certification proves that this fail-closed state is internally consistent. It does **not** prove legal approval.

## Evidence that should exist before sale

The final operator launch packet should be able to point to:

- seller identity and jurisdiction;
- final versioned customer Terms/EULA/Privacy/refund documents and public URLs;
- real approved prices/Marketplace plan IDs;
- production data-flow/subprocessor verification;
- retention/deletion and customer-rights procedures;
- tax/accounting decision evidence where applicable;
- actual support scope/contact/escalation terms where offered;
- legal-review completion reference;
- exact commercial service and protocol release reviewed;
- explicit operator sale approval.

## Relationship to technical launch

Legal approval is necessary but not sufficient. Issue #6 also tracks private vendor repositories, GitHub Apps, Marketplace configuration, production 0.3.8 deployment/readiness, live Community and paid E2E, publisher/financial onboarding and applicable installation-threshold evidence.

A technically healthy deployment must not be sold before the legal/commercial gates are approved, and an approved legal pack must not be treated as proof that the technical launch gates passed.

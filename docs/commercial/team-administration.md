# ANPOS Team Administration

Status: source implementation for commercial service 0.3.8; **not** Team sale activation or production E2E evidence.

## Purpose

ANPOS Team adds a customer-facing organization administration surface on top of the existing Marketplace entitlement and seat-control runtime. The source implementation is intentionally narrow: it lets an authenticated GitHub organization administrator see reconciled Team entitlement/seat state and assign or revoke organization-member seats without turning ANPOS into a billing authority.

GitHub Marketplace remains authoritative for purchase, plan, billing cycle, unit/seat quantity, trial, upgrade/downgrade, cancellation and renewal state.

## Customer flow

1. A GitHub App user-access session already created by the Marketplace Setup/OAuth flow is reused. ANPOS does not create a second Team password or session system.
2. The service resolves the session's exact GitHub App installation through the authenticated user's `/user/installations` view.
3. The installation must resolve to an active GitHub **Organization** account and the current user must be an active organization administrator.
4. Before showing Team state, ANPOS reconciles the organization against GitHub Marketplace.
5. The reconciled entitlement must include `organization_team_features`; a Community, Developer or Pro entitlement cannot use the Team administration surface merely because it belongs to an organization.
6. `/api/v1/team/summary` returns a no-store summary of organization identity, reconciled plan state/billing cycle, GitHub Marketplace billing authority, seat capacity, active/available seats, and sanitized assignment history.
7. `/team` uses the existing `/api/v1/seats` mutations to assign an active GitHub organization member or revoke an active seat.
8. Seat capacity remains server-side enforced. When capacity is full, ANPOS does not manufacture a seat or alter billing; the customer must change the applicable Marketplace plan/unit quantity when such a real paid plan exists.
9. Revocation preserves the non-destructive project rule while queuing premium template-access reconciliation where applicable.

## Security and authorization boundary

The Team surface inherits existing controls rather than bypassing them:

- encrypted short-lived `__Host-anpos_session` browser cookie;
- GitHub user access token bound to the exact installation ID;
- exact installation/account identity verification;
- fail-closed handling for suspended, inaccessible or malformed installations;
- GitHub organization-admin verification before Team reads or mutations;
- Marketplace reconciliation before Team state is exposed;
- explicit `organization_team_features` entitlement gate;
- active GitHub organization-member verification before assigning a seat;
- server-side capacity enforcement;
- rate limiting on Team summary and existing seat-admin operations;
- `Cache-Control: no-store` for customer entitlement/seat summaries;
- no raw password, private key, session-cookie or database-credential collection through the Team UI.

## Billing truth

The Team page may display the reconciled plan ID, entitlement state and billing cycle reported through the Marketplace account state. It does **not**:

- charge a customer;
- change a Marketplace plan;
- change monthly/annual billing;
- change seat/unit quantity;
- start or cancel a trial;
- cancel or renew a subscription;
- invent a price or Marketplace plan ID;
- claim that a draft Team price is live.

A complete real-world purchase/upgrade/downgrade/cancellation experience still requires a real Marketplace listing/plan and production evidence.

## Support truth

The draft Team catalog contains a `commercial_support` entitlement label, but canonical source does not activate a staffed support service or SLA. `/team` therefore states that support/SLA remains operator-contract-required.

No response-time guarantee, resolution target, 24/7 staffing, escalation promise, security-incident SLA or service credit is created by this source implementation.

## Current implemented evidence

- `commercial-service/app/api/v1/seats/route.ts`
- `commercial-service/app/api/v1/team/summary/route.ts`
- `commercial-service/app/team/TeamClient.tsx`
- `commercial-service/lib/seats.ts`
- `commercial-service/lib/team-dashboard.ts`
- `commercial-service/lib/team-installation.ts`
- `commercial-service/tests/team-dashboard.test.ts`

## What remains before Team can be sold

This source work does not make Team sale-ready. Remaining gates include at minimum:

- actual Team Marketplace plan identity and approved pricing;
- all applicable Developer external launch gates;
- real Pro premium value, because the current draft Team package inherits Pro entitlements that are still planned/not implemented;
- deployed current commercial-service identity and full production readiness;
- live organization purchase/reconciliation/seat assignment/revocation E2E;
- production purchase/plan-change/cancellation/billing-state UX evidence;
- team onboarding/access-reconciliation production evidence;
- operator-approved support scope if `commercial_support` is actually offered;
- final legal/privacy/refund/cancellation terms;
- current GitHub Marketplace requirement re-verification before publication.

Until those gates pass, `organization_team_features` remains **partial implementation**, Team remains draft/unpriced, and this source UI must not be marketed as a live paid Team product.

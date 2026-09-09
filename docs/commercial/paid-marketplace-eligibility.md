# Paid GitHub Marketplace Eligibility Evidence

Status: **current requirements checked; ANPOS paid eligibility not evidenced**.

The machine-readable snapshot is `config/licensing/paid-marketplace-eligibility.json`. It separates current GitHub Marketplace requirements from ANPOS's actual external state.

## Current checked baseline

The official GitHub documentation was re-checked on 2026-09-05. At that check, paid GitHub Apps require at least 100 genuine installations, organization ownership by a verified publisher, financial onboarding, and handling of the paid Marketplace purchase lifecycle. Paid plans must support monthly and annual billing.

This baseline can change. Re-check official GitHub documentation immediately before paid submission or conversion.

## Evidence still required from the real account/app

Repository state cannot prove:

- genuine installation count;
- publisher verification;
- financial onboarding completion;
- real Marketplace plan IDs;
- successful paid purchase/upgrade/downgrade/cancellation/trial E2E.

Those values remain pending until independently observed from the real GitHub organization, Marketplace listing, billing setup, and production flow.

## Anti-gaming rule

Do not fabricate, buy, seed, or infer installations merely to satisfy the paid threshold. The free-first strategy should accumulate genuine installs from a useful Community product before paid conversion.

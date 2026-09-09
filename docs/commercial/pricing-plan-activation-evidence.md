# Pricing and Paid Plan Activation Evidence

Status: **operator pricing and Marketplace plan approval pending**.

This repository intentionally does not invent live prices or Marketplace plan IDs. `config/licensing/pricing-plan-activation-evidence.json` is the activation evidence boundary for Developer, Pro, Team and Enterprise.

Paid activation requires two independent classes of evidence:

1. current GitHub Marketplace paid eligibility is satisfied and recorded; and
2. every live monthly/annual USD price and Marketplace plan ID is explicitly approved by the operator.

Repository draft catalog values are not billing authority. Until both classes are complete, `paid_activation_authorized` remains false.

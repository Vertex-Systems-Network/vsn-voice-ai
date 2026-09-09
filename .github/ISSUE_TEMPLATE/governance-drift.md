---
name: GitHub governance drift
description: Track missing or mismatched repository rules/settings
title: "[AI-NATIVE] GitHub Governance Drift"
labels: []
assignees: []
---

## Desired policy

See `config/github/ruleset-policy.json` and `GITHUB-GOVERNANCE.md`.

## Drift

Describe the rulesets/settings that do not match the desired policy.

## Required verification

- [ ] Active ruleset targets the default branch.
- [ ] PR/review/status-check rules are verified.
- [ ] Force-push/deletion protections are verified.
- [ ] Merge-method settings match the policy.
- [ ] Required status-check names match actual successful workflow check contexts.
- [ ] Final repository state was re-read after changes.

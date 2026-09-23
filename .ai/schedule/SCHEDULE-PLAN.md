# Scheduled AI Development Plan

This file governs scheduled ChatGPT development only. Interactive/chat development keeps using this repository's existing AI/agent/governance/roadmap/Issue/PR contracts. Scheduled runs reconcile exact main, existing development plan, durable state, open Issues/PRs, reviews, CI and security, then continue the existing roadmap from the last safe checkpoint.

## Google Drive report
Use the connected Google Drive app and one Sheet named `<repo> — Scheduled AI Development Report`. Locate/reuse it or create it on the first run. Append timestamp, repo, main SHA, milestone, Issue, PR, PR head, CI/runner, security, action, result/blocker and next safe action. Never overwrite history. GitHub remains authoritative; Drive failure must never cause fabricated reporting.

## Continuous safe execution
Keep advancing accepted authorized work. Accepted Issue/PR work precedes unrelated new work. Pending runners are handoff boundaries, not completion; no busy-wait or repeated unchanged polling. Fix failed checks safely. Never bypass security/review/authorization/external-evidence gates or fabricate evidence.

## Single-writer handoff
Before mutation revalidate live GitHub state and prior scheduled work. Persist run identity/start, exact base/head, active Issue/PR and next-safe-action where durable state supports it. If a predecessor is stale/safely supersedable, resume its durable checkpoint after revalidation. If it may still be mutating and cannot safely be terminated, do not compete: fail closed, checkpoint handoff and resume next run. Never assume a new schedule can forcibly kill another process.

Before merge verify exact PR head, required checks, review/thread requirements, mergeability and main divergence. The scheduled program resumes across bounded runs until documented project completion or owner cancellation.

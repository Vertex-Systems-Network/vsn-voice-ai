# VSN Organization Next-Action Options Contract

This repository supports **two distinct entry modes**. Do not turn an already-authorized AI-native development request into a mandatory numbered-choice handoff.

## Mode A — Explicit audit, repair, or continue/develop instruction (default for authorized work)

When the user asks to check and fix, audit and align, proceed, continue, implement, test, or develop this repository, execute the requested **authorized** work in the current invocation. The repository and current instruction determine the next work unit. Do **not** ask the non-developer owner to select a module, approve ordinary bug fixes, choose between equivalent implementation details, restate the next task, or reply with an option number merely to resume.

1. Reconcile `main`, open actionable Issues, open PRs and exact-head CI, then the coordination/runner state; treat stale snapshots as evidence to repair, not instructions to repeat.
2. Advance the earliest safe actionable Issue/PR or the highest-priority dependency-ready approved product slice. A genuine blocker is scoped to the affected lane; isolate it, preserve evidence, and continue another independent permitted lane.
3. Independently debug and repair ordinary code, tests, dependency integration, CI failures and documentation drift. Retry within bounded budgets; never claim that a pending check passed.
4. Keep README progress and canonical state synchronized with **verified** implementation milestones. Do not inflate completed work or create a status-only source commit to restate CI results.
5. At the invocation boundary, report verified outcomes, precise blockers and the automatically selected next safe action. If the host cannot persist a running agent, save an actionable checkpoint; **do not claim background continuation**.
6. Ask a human only if a real decision or external authority is required and no independent authorized development lane remains. Distinguish genuinely required approvals from routine implementation choices.

This mode does not override approved scope, hard security controls, restricted Windows-runner conditions, real-world acceptance evidence, independent review, GitHub protections, authenticated consent, provider/cost/release gates, or runtime limitations. A human reviewer cannot be invented or replaced by self-approval.

## Mode B — User explicitly requests choices, or sends only the repository URL

Offer 1 to 3 currently valid next actions derived from live repository evidence. This is a **presentation mode**, not a gate to continuing an already-authorized development instruction.

- Mark the canonical action **Recommended**; when two or more choices exist, vary visible 1/2/3 order without changing real priority or authorization.
- A number-only answer selects the corresponding currently shown option for a new fully revalidated turn.
- Show options only on the user's request for options or the URL-only entry below. Do not append mandatory numbered selections to Mode A.

## URL-only repository entry

When the user's message contains only this repository's canonical GitHub URL (optionally surrounded by whitespace), treat it as a read-only development entry request.

1. Resolve the repository and protected/default branch.
2. Read durable/current state and governing instructions.
3. Reconcile open Issues, PRs, exact-head CI and coordination state.
4. Do **not** create a branch, commit, PR, merge, deployment, provider call, destructive action or other mutation from the URL alone.
5. Show 1 to 3 valid options with the canonical one marked **Recommended**.
6. A later user selection starts a new turn after state and permission revalidation.

## Authority and recovery

The explicit current user instruction and repository safety/consent policy take priority over this handoff format. Work waiting on review/CI/provider/hardware must not globally freeze unrelated eligible work; record its exact dependency boundary and recovery trigger. An unavailable connector, no persistent agent, no live Supervisor lease, or depleted time/tool budget must be accurately reported and checkpointed rather than disguised as autonomous background progress.

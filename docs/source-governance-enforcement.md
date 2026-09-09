# Canonical Source Governance Enforcement

Status: **external GitHub enforcement pending**.

ANPOS source certification is implemented and continuously exercised, but a passing workflow is not the same as server-side merge enforcement. The canonical repository must not claim protected-branch/ruleset enforcement until GitHub configuration evidence proves it.

The machine-readable authority for this gate is `config/github/source-enforcement-evidence.json`.

## Required source control boundary

For canonical `main`, the intended external controls are:

- pull requests required for ordinary merges;
- `ANPOS Source Continuous Certification / source-certification` required before merge;
- unresolved conversations block merge;
- force pushes blocked;
- branch deletion blocked.

These controls apply to the canonical source repository and are separate from the child-project governance template in `config/github/ruleset-policy.json`.

## Evidence rule

Repository files can define the desired policy, but they cannot prove GitHub is enforcing it. `external_evidence` therefore remains fail-closed until an authenticated GitHub observation or operator record supplies:

- verification time;
- verifying principal/process;
- branch-protection or ruleset evidence reference;
- proof that the exact source certification context is required server-side.

Do not change `source_governance_enforced` to true based only on documentation, a green workflow run, or an unverified screenshot.

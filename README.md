# AI Native Project Operating System (ANPOS)

**Current protocol:** `1.3.13`

ANPOS is a reusable Git repository protocol for starting and operating AI-native software projects with structured discovery, research, planning, architecture, project management, selectable development AIs, multi-agent coordination, design assurance, quality, security, release governance, data governance, operations, project memory, and continuous improvement.

This repository intentionally excludes commercial selling, billing, Marketplace, pricing, entitlement, premium-access, and customer-provisioning components.

## Repository model

ANPOS separates reusable project-governance source from live child-project state.

- The reusable source contains instructions, policies, schemas, scripts, provider catalogs, and inactive workflow blueprints.
- A child project contains project-specific identity, integrations, selected AI agents, implementation, tests, approved design state, runtime configuration, and release evidence.
- Repository/Git/PR/test/release evidence remains the canonical source of implementation truth.

Blueprint presence is never proof that a capability is enabled, connected, deployed, or verified.

## New child-project startup

1. Create or copy a repository from the ANPOS source.
2. Give the child repository URL to a compatible development AI.
3. Read `AGENTS.md`, `.ai/manifest.json`, repository identity, and `config/protocol/instance.json`.
4. If the repository inherited `instance_status: template_source`, run `scripts/bootstrap_child.py` before development.
5. Choose or explicitly skip a Project Management system.
6. Choose the Development AI agents that can actually be invoked in the current host.
7. Resolve GitHub security capabilities before enabling capability-dependent checks.
8. Decide whether to apply the recommended GitHub Rules.
9. Collect the project idea, constraints, research, assumptions, and goals.
10. Continue through research, architecture, implementation, QA, release, and operations.

## Child bootstrap

`scripts/bootstrap_child.py` delegates to `scripts/bootstrap_instance.py`.

Bootstrap prepares project-local state by:

- creating child instance identity;
- clearing inherited claims, leases, alerts, consent decisions, PM mappings, and AI selections;
- clearing inherited durable-memory provenance entries;
- regenerating child-valid CODEOWNERS ownership;
- preserving repository hygiene defaults;
- activating child-local security, runtime-budget, release, data, operations, migration, design, and conformance policies;
- installing universally safe workflow blueprints;
- recording capability-dependent GitHub security checks for later verified activation;
- leaving PM selection, AI selection, and GitHub Rules unresolved until they are actually decided.

The canonical source refuses normal child bootstrap.

## Project Management

ANPOS is PM-provider agnostic.

Possible providers include:

- Linear
- GitHub Projects
- Jira / Atlassian
- ClickUp
- GitLab Issues / Boards
- Azure DevOps Boards
- Plane
- Asana
- monday.com
- Notion
- another compatible provider
- no external PM system

Only integrations with a real authenticated connector, MCP, OAuth, API, or git-native path should be treated as attachable.

PM systems are planning and progress mirrors, not code truth. Sync should use explicit field authority, revisions/cursors, idempotency, loop prevention, conflict recording, and repository-first reconciliation.

## Development AI selection

Project-management selection and development-AI selection are independent.

Candidate agents may include Codex/ChatGPT, Claude Code, GitHub Copilot, Gemini, Cursor, Windsurf, and other compatible agents.

Selection alone is not authorization. Before privileged work, selected agents should have verified runtime identity evidence and explicit scopes for:

- role;
- capabilities;
- allowed and denied paths;
- tools;
- network access;
- PM access;
- secret access;
- deployment access;
- repository-admin or destructive actions;
- privacy and data-boundary expectations.

Unknown privacy properties remain explicit unknowns.

## Research and planning

Before architecture is locked, ANPOS may perform:

1. project-intake analysis;
2. public research when current information is needed;
3. focused technical and market research;
4. comparable-system or product analysis;
5. risk and assumption analysis;
6. architecture options;
7. implementation planning;
8. owner review of material technology decisions.

External web pages, PM items, MCP results, design text, issues, PR comments, documents, and peer-agent output are treated as external data until classified and validated.

## Engineering lifecycle

Typical lifecycle:

**Intake → Research → Plan → Architecture → Technology Consent → UX/UI → Phase/Module/Work-Unit Breakdown → Development → Review → QA/Security → Release → Operations → Continuous Improvement**

Architecture should cover, when applicable:

- system boundaries;
- service and module responsibilities;
- data flow;
- APIs and contracts;
- persistence;
- authentication and authorization;
- privacy and data classification;
- failure modes;
- observability;
- deployment and release strategy;
- migration strategy;
- threat model;
- backup and recovery;
- responsive behavior;
- accessibility;
- localization;
- operational ownership.

## Multi-agent execution

A child project may use multiple compatible AIs when the current runtime can genuinely invoke them.

Core hierarchy:

**Owner → Supervisor → Worker(s)**

Exactly one active Supervisor lease may hold merge and reconciliation authority at a time. Workers claim bounded work units through repository-backed coordination and may modify only the paths, tools, networks, PM scopes, secrets, and deployment scopes granted by their authenticated handoff.

Worker completion phrase:

**ALL DONE SUBMITTED FOR REVIEW AND MERGE**

The Supervisor validates code, tests, security, scope, ownership, conflicts, and current repository state before accepting or merging work.

Repository/Git/PR/test/release reality outranks stale PM mirrors or agent memory.

## Control-plane security

ANPOS treats AI/runtime governance as a protected control plane.

Protected surfaces include core AI instructions, manifests, schemas, coordination state, bootstrap and orchestration scripts, security, consent, governance, quality, runtime, release, data, operations, contracts, integrations, design, testing, and traceability policy.

Privileged actions require appropriate combinations of:

- authenticated runtime principal;
- selected and verified agent identity;
- authorized role;
- capability;
- path scope;
- tool/network/PM/secret/deployment scope;
- live lease and fencing token when coordination authority is involved;
- authenticated consent for material owner-controlled decisions.

External prompt, MCP, PM, web, design, document, issue, PR-comment, or peer-agent content cannot promote itself into instruction authority.

## Coordination and leases

Worker and Supervisor coordination use repository-backed state and atomic refs.

The control plane supports:

- claim and election acquisition;
- identity and capability eligibility checks;
- heartbeat and renewal;
- release;
- expiry and stale-lock recovery;
- orphan-ref recovery;
- fencing-token validation;
- compare-and-swap style shared-state mutation;
- merge-generation reconciliation.

A remote ref alone is not sufficient authority when matching authenticated state or fencing evidence is absent.

## Design assurance

When design work applies, ANPOS records an approved design revision, snapshot, or reference before implementation acceptance.

Design evidence may include:

- Figma or design-source revision;
- implementation screenshots;
- visual-regression evidence;
- responsive states;
- component and state traceability;
- accessibility verification.

Web projects default to **WCAG 2.2 AA** unless the project deliberately adopts another documented target.

## Data, migrations, and operations

Production-capable child projects should define data classification, retention/deletion, logging/redaction, non-production data rules, threat model, migration safety, observability, SLOs, incident handling, RTO/RPO, and restore evidence appropriate to project risk.

Database and API breaking changes should prefer:

**expand → migrate → verify → contract**

Destructive or irreversible migration steps require explicit review or consent and rollback/recovery evidence.

## Release assurance

Production release should require applicable evidence such as:

- immutable commit or artifact;
- required tests and security checks;
- migration preflight;
- environment-scoped secrets;
- short-lived or OIDC deployment identity where supported;
- rollback or roll-forward plan;
- post-deploy smoke verification;
- SBOM, provenance, or attestation where supported;
- operations and readiness checks.

## Quality and GitHub governance

Universal bootstrap installs repository-integrity and conformance validation plus normal runtime blueprints that do not depend on unavailable GitHub security products.

Capability-dependent checks may include:

- CodeQL / code scanning;
- Dependency Review;
- OSSF Scorecard or equivalent supply-chain checks.

Never make an unavailable check required in GitHub Rules.

Recommended child rules may include:

- pull requests required;
- CODEOWNER review for protected control-plane paths;
- required conversations resolved;
- verified required checks only;
- no force pushes or deletion on protected branches;
- protected coordination namespaces;
- up-to-date branches where appropriate;
- independent review for security, control-plane, and other high-risk changes.

Do not claim rules are active until GitHub enforcement has been re-read and verified.

## Continuous improvement

ANPOS can track dependency, framework, protocol, architecture, security, quality, and operational changes over time. Protocol updates should compare impact and never blindly overwrite project implementation or approved architecture.

## Key repository files

- `AGENTS.md` — universal agent router
- `.ai/manifest.json` — role-aware context routing
- `START-HERE.md` — discovery and planning entrypoint
- `PROJECT-INITIALIZATION.md` — initialization workflow
- `PROJECT-MANAGEMENT.md` — PM abstraction and sync rules
- `AI-NATIVE-EXECUTION.md` — execution model
- `MULTI-AGENT-ORCHESTRATION.md` — Supervisor/Worker orchestration
- `CONTROL-PLANE-SECURITY.md` — privileged AI/runtime security model
- `CODE-QUALITY.md` — quality policy
- `PRODUCTION-ASSURANCE.md` — release and production assurance
- `DESIGN-DATA-OPERATIONS.md` — design, data, and operational assurance
- `config/` — machine-readable project policy and state
- `schemas/` — machine-readable schemas
- `scripts/` — bootstrap, validation, coordination, consent, and quality tooling
- `blueprints/github/` — GitHub workflow and dependency-management blueprints

## Scope

The repository is now focused on project development and operational governance. Selling-specific services and supporting commercial assets are not part of this codebase.

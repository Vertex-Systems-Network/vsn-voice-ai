# VSN Voice AI — Development Architecture

**Lifecycle stage:** Stage 10 — Development Architecture Design  
**Technology approval:** `CONSENT-000002` — approved 2026-09-10 03:01 PKT  
**Architecture status:** implementation baseline

## 1. Architecture goals

The implementation must preserve the approved hybrid strategy: product features depend on VSN capability contracts, not directly on vendor SDKs. Realtime call audio must remain usable when optional AI, analytics, meeting intelligence, or a third-party provider fails.

Primary architectural qualities:

- low-latency and fail-safe realtime audio;
- vendor-neutral AI/provider contracts;
- strict tenant isolation and permission inheritance;
- reversible, observable provider routing;
- versioned live/final meeting artifacts;
- secure desktop/web identity linking;
- measurable provider quality, latency, cost and failure behavior;
- clean extension path from third-party providers to VSN-owned models;
- explicit data retention/deletion and audit boundaries.

## 2. Repository/workspace layout

```text
apps/
  web/                    # Next.js SaaS workspace
  desktop/                # Tauri 2 desktop application shell
services/
  api/                    # NestJS + Fastify control/business API
  realtime-gateway/       # Go realtime media/session gateway
  workers/                # bounded asynchronous meeting/integration jobs
packages/
  contracts/              # versioned shared schemas/events/types
  provider-sdk/           # provider-neutral capability interfaces
  config/                 # shared non-secret configuration contracts
  ui/                     # reusable web UI primitives when justified
native/
  audio-core/             # Rust realtime audio/inference orchestration
  windows-audio/          # Windows virtual audio/native platform layer
  macos-audio/            # later macOS native layer
ai/
  research/               # Python/PyTorch research code
  evaluation/             # benchmark definitions and corpus metadata
  models/                 # manifests only; model binaries live outside Git
infra/
  terraform/
  containers/
docs/
  architecture/
  data/
  design/
  providers/
  security/
```

Large datasets, model binaries, customer recordings and secrets must never be committed to Git.

## 3. Runtime planes

### 3.1 Local realtime audio plane

Owned primarily by `native/audio-core` plus platform-specific native components.

Responsibilities:

- microphone/speaker device discovery and lifecycle;
- fixed internal audio-frame representation;
- VAD/level/quality state;
- local enhancement/inference stages when supported;
- cloud provider bridge for optional realtime stages;
- virtual microphone routing;
- safe bypass on timeout, provider failure, overload, or local model failure;
- per-stage latency measurement without content logging.

The UI must never own the audio processing loop.

### 3.2 Cloud realtime media plane

Owned by `services/realtime-gateway`.

Responsibilities:

- WebRTC/WebSocket/gRPC session termination where required;
- short-lived session authorization;
- realtime provider session brokerage;
- backpressure and hard latency budgets;
- circuit breakers and provider health state;
- streaming usage events;
- no persistence of raw audio unless an explicitly authorized recording/capture flow requires it.

### 3.3 Control/business plane

Owned by `services/api`.

Responsibilities:

- accounts, organizations, roles and entitlements;
- device/session bootstrap;
- provider policy and tenant routing policy;
- meeting metadata and artifact lifecycle;
- integrations/OAuth references;
- billing/usage reconciliation;
- admin and audit interfaces;
- developer API control surfaces later.

### 3.4 Asynchronous work plane

Owned by `services/workers`.

Initial job classes:

- final transcript reconciliation;
- meeting summary/action extraction;
- export generation;
- provider webhook processing;
- integration sync/write jobs;
- deletion propagation;
- search/vector indexing;
- provider capability refresh.

Jobs require idempotency keys, retry classification and dead-letter/failure visibility. A durable workflow engine is not introduced until measured workflow complexity justifies it.

## 4. Shared contract architecture

`packages/contracts` is the canonical schema boundary. Contracts are versioned from the first implementation.

Initial schemas/types:

- `AudioFrame`
- `RealtimeSession`
- `ProviderManifest`
- `ProviderCapability`
- `ProviderRoutingRequest`
- `ProviderRoutingDecision`
- `ProviderHealthEvent`
- `TranscriptSegment`
- `SpeakerEvent`
- `MeetingLifecycleEvent`
- `MeetingArtifact`
- `UsageEvent`
- `ConsentEvent`
- `AgentActionRequest`
- `AuditEvent`

Rules:

1. External vendor objects never become domain models directly.
2. Adapters translate vendor payloads into versioned VSN contracts.
3. Breaking contract changes require an explicit compatibility/migration plan.
4. Realtime contracts prefer bounded payloads and monotonic sequence numbers.
5. Persisted events include tenant ID, correlation/session ID, timestamp and schema version where applicable.

## 5. Hybrid provider SDK

`packages/provider-sdk` exposes capability-oriented interfaces.

Initial capability IDs:

- `audio.noise_cancel`
- `audio.background_voice_cancel`
- `audio.echo_reduce`
- `audio.vad`
- `voice.accent_convert`
- `voice.identity_preserve`
- `voice.deepfake_detect`
- `voice.speaker_verify`
- `speech.translate_realtime`
- `speech.transcribe_stream`
- `speech.transcribe_finalize`
- `speech.synthesize`
- `meeting.capture`
- `meeting.transcript`
- `meeting.intelligence`
- `conversation.score`
- `knowledge.search`
- `assistant.realtime`
- `agent.action`
- `telephony.media`

Each adapter must declare:

- provider/model/SDK version;
- access mode: API, SDK, local, on-prem, unavailable;
- supported capability IDs;
- input/output media constraints;
- language/accent/platform support;
- latency class and timeout policy;
- privacy/retention/residency notes;
- pricing/metering unit;
- quota/rate-limit behavior;
- credential type;
- health and circuit-breaker state;
- licensing/access verification state;
- adapter contract-test status.

VSN-owned models implement the same interfaces as external providers.

## 6. Routing and fallback

Routing policy inputs:

- requested capability;
- tenant/provider allowlist or denylist;
- region/data-residency policy;
- current provider health;
- quality score;
- measured latency;
- current quota/rate-limit state;
- estimated cost;
- device/local execution eligibility.

Supported policy modes begin with:

- `auto`
- `lowest_latency`
- `best_quality`
- `best_privacy`
- `lowest_cost`
- tenant-enforced provider policy.

Realtime audio rules:

- fail closed for authorization/security;
- fail open to **safe unprocessed audio bypass** for optional audio AI when doing so is safe;
- never allow meeting notes/analytics failure to interrupt base call audio;
- use bounded timeouts and circuit breakers;
- do not retry indefinitely inside the realtime path.

## 7. Persistence architecture

### PostgreSQL

Canonical transactional state:

- users/organizations/memberships/roles;
- subscriptions/entitlements;
- devices and secure linking metadata;
- meetings/conversations;
- transcript/artifact metadata;
- provider manifests and tenant policy;
- integration connection metadata (secret values excluded);
- usage ledger;
- audit/security events;
- deletion/export workflow state.

Tenant-scoped tables/queries must enforce tenant ownership at repository/service boundaries. Database-level row-level security may be added after schema design if it improves defense in depth without creating operational ambiguity.

### pgvector

Initial semantic retrieval for finalized transcript/artifact chunks. Every vector row must inherit tenant/source permission metadata and deletion lifecycle.

### Redis

Allowed uses:

- short-lived sessions;
- rate limiting;
- provider health/circuit-breaker state;
- bounded queues/jobs;
- cache entries with explicit TTL;
- ephemeral realtime coordination.

Redis is not a source of truth for billing, authorization, consent, or durable meeting artifacts.

### Object storage

Used only when policy permits:

- recordings;
- clips;
- exports;
- signed desktop/model artifacts;
- approved research/model assets.

Objects require tenant ownership metadata, encryption, lifecycle policy and deletion propagation.

## 8. Identity and authorization

No identity vendor is hard-coded into domain logic.

Required authorization layers:

- authenticated user/session;
- organization membership;
- role/permission check;
- object ownership/tenant check;
- integration scope check;
- capability-specific consent/policy check;
- agentic-action approval where required.

Desktop linking uses short-lived one-time exchange tokens rather than long-lived browser session secrets.

Provider/OAuth secrets remain server-side or OS secure storage as appropriate and are represented in application state only by opaque references.

## 9. API and event conventions

- REST for stable control/business resources.
- WebSocket/SSE only for workflows that benefit from server push.
- WebRTC for supported realtime media paths.
- Provider-specific protocols remain inside adapters.
- Mutating endpoints support idempotency keys when duplicate delivery is credible.
- Webhooks require signature verification, replay windows and deduplication.
- Error responses expose stable error codes and correlation IDs without leaking secrets/content.

## 10. Observability

All services emit structured content-safe telemetry through OpenTelemetry-compatible instrumentation.

Required dimensions where safe:

- service/build version;
- environment;
- capability ID;
- provider ID/model version;
- tenant-safe pseudonymous identifier where needed;
- session/correlation ID;
- latency stage;
- success/failure class;
- fallback/bypass event;
- metering unit/cost estimate.

Never emit raw audio, speaker embeddings, access tokens, full transcripts, email bodies, document bodies or payment data into normal logs/traces.

## 11. Environment/configuration strategy

Environments:

- local development;
- CI/test;
- shared development;
- staging;
- production.

Configuration categories:

- public non-secret defaults committed to source;
- environment-specific non-secret deployment config;
- secrets in managed secret storage only;
- tenant policy persisted in the control plane;
- provider capability manifests versioned and auditable.

Production credentials must never be available to untrusted PR jobs.

## 12. Quality architecture

After the first stack scaffold exists, CI expands to include applicable checks:

- TypeScript typecheck and unit/contract tests;
- Rust format/lint/test;
- Go format/vet/test;
- Python format/static/unit tests for AI tooling;
- schema compatibility tests;
- provider-adapter contract tests;
- security/dependency scanning where supported;
- desktop/audio latency benchmark jobs where deterministic hardware is available;
- E2E/accessibility tests for web/app surfaces;
- installer/signing/update verification before release.

Baseline ANPOS integrity checks remain mandatory.

## 13. Release and rollback architecture

- Cloud deployments are immutable build artifacts tied to a commit SHA.
- Database breaking changes follow expand → migrate/backfill → verify → contract.
- Realtime provider routing changes support fast rollback/disable through policy/feature flags.
- Desktop installers and update packages require signing and digest verification before external distribution.
- Local model packages are versioned, signed and independently rollbackable from the desktop binary where feasible.
- Production release requires QA/security/design/accessibility evidence appropriate to the changed surfaces.

## 14. Extension rules

New providers must normally require only:

1. a manifest;
2. one or more capability adapter implementations;
3. credentials/configuration mapping;
4. contract tests;
5. capability/quality/privacy/cost metadata.

A new provider must not require rewriting meeting, billing, UI, or domain business logic.

## 15. Stage 10 exit criteria

Stage 10 is complete when:

- repository/service boundaries are defined;
- provider and domain contracts are defined;
- persistence/cache/job/idempotency rules are defined;
- identity/secrets/configuration boundaries are explicit;
- observability/quality/release strategy is explicit;
- architecture does not contradict the approved technology stack or threat/data baselines.

# VSN Voice AI — Data Flow, Privacy & Contract Design

**Lifecycle stage:** Stage 11 — Data Flow, Privacy and Contract Design  
**Technology approval:** `CONSENT-000002` — approved  
**Threat baseline:** `config/security/threat-model.json`  
**Data baseline:** `config/data/data-governance.json`

## 1. Global data-flow rules

1. Tenant authorization is checked before every tenant-owned read/write.
2. Provider access is capability- and policy-scoped; no provider receives data merely because it is configured.
3. Raw realtime audio is ephemeral by default.
4. Recording persistence requires an explicit authorized recording/capture state.
5. Live transcript/intelligence is provisional and versioned; finalized output may supersede it.
6. Sensitive telemetry is allowlisted; raw audio, full transcript content, embeddings and secrets are excluded from normal logs/traces.
7. Every externally retried mutation uses an idempotency key or equivalent deduplication key.
8. Derived data inherits source permissions and deletion policy.
9. Customer content is excluded from VSN model training by default.
10. Provider failures in optional realtime AI must not drop the user's base call audio.

## 2. Flow A — Local realtime voice enhancement

**Actors:** authenticated desktop user, desktop runtime, local model/SDK  
**Data:** DATA-001 ephemeral realtime audio

```text
Physical mic
  -> desktop audio capture
  -> local VAD/quality stage
  -> optional local noise/background/echo/accent processing
  -> virtual microphone
  -> calling application
```

Authorization/checkpoints:

- selected physical input/output device belongs to current local session;
- feature entitlement and tenant policy are checked before enabling a gated capability;
- local model/SDK package signature/version is validated before use.

Persistence:

- none for raw audio by default;
- only content-free performance/health metrics may be persisted.

Failure path:

- processing timeout/exception/overload -> safe bypass to usable base audio;
- invalid model/update -> disable model path and use previous verified version or bypass.

## 3. Flow B — Cloud realtime provider processing

**Actors:** desktop/browser client, VSN realtime gateway, approved external provider  
**Data:** DATA-001, provider routing metadata from DATA-009

```text
client audio frame
  -> short-lived VSN realtime session
  -> tenant/capability/provider-policy authorization
  -> provider routing decision
  -> approved provider realtime session
  -> normalized processed frame/event
  -> client output path
```

Controls:

- short-lived session token;
- provider must be verified for requested capability/access mode;
- routing respects tenant region/privacy/provider policy;
- hard timeout, circuit breaker and backpressure bounds;
- provider usage event emitted without audio content.

Failure:

- provider timeout/unhealthy -> alternate verified provider if policy allows;
- otherwise safe bypass for optional processing;
- authorization/security failure -> reject capability, never silently route elsewhere.

Retention:

- VSN does not persist raw stream by default;
- provider-specific retention behavior must be known before activation.

## 4. Flow C — Meeting capture

**Actors:** user, calendar/meeting platform, capture adapter/bot/desktop recorder, VSN API  
**Data:** DATA-001, DATA-002, DATA-003, DATA-006

```text
user/calendar rule
  -> capture authorization + tenant policy
  -> meeting platform adapter
  -> participant/lifecycle/media events
  -> transcript/capture stream
  -> conversation record
  -> optional recording object
```

Authorization:

- connected account OAuth scopes;
- meeting/capture policy;
- applicable participant notice/consent workflow;
- tenant recording policy.

Writes:

- meeting metadata -> PostgreSQL;
- recording -> encrypted object storage only when enabled;
- streaming transcript -> provisional transcript store.

Failure/retry:

- platform webhook replay -> signature verification + deduplication;
- capture disconnect -> bounded reconnect/reconcile;
- capture failure must be visible to the user and never fabricated as successful.

## 5. Flow D — Transcription and meeting intelligence

**Actors:** capture service, STT provider/VSN model, intelligence provider/VSN model, worker  
**Data:** DATA-002, DATA-003, DATA-009

```text
captured audio/transcript stream
  -> streaming STT
  -> provisional transcript segments
  -> live notes/assistant events
  -> meeting end
  -> final STT reconciliation
  -> final transcript version
  -> notes/summary/decisions/actions/highlights
  -> semantic index
```

Contract rules:

- transcript segment carries sequence, timestamps, speaker state and provisional/final status;
- artifacts carry source references to transcript segments where feasible;
- finalization is idempotent and versioned;
- search chunks inherit tenant/object permissions.

Failure:

- live intelligence failure does not affect capture/transcript;
- final worker retries only retryable failures;
- exhausted retry -> visible failed state/dead-letter, not silent completion.

## 6. Flow E — Account, organization and desktop linking

**Actors:** user, web app, API, desktop app  
**Data:** DATA-006

```text
web authentication
  -> API session
  -> organization membership/role
  -> user requests desktop link
  -> one-time short-lived exchange token
  -> desktop exchanges token
  -> device/account binding metadata
```

Controls:

- one-time token with short expiry;
- no long-lived browser cookie copied into desktop app;
- unlink/revoke device supported;
- tenant role changes invalidate authorization on subsequent access.

## 7. Flow F — Provider credentials / BYOK / OAuth

**Actors:** user/admin, API, managed secret store, external provider  
**Data:** DATA-005

```text
user initiates provider connection
  -> OAuth/API-key validation
  -> secret stored in managed secret store
  -> database stores opaque credential reference + metadata
  -> runtime resolves secret only when authorized
```

Rules:

- no secret values in Git, normal DB columns, logs, traces, analytics or client bundles;
- connection removal revokes upstream where supported and removes local secret reference;
- production/non-production credentials are separate.

## 8. Flow G — Business integrations and agentic actions

**Actors:** user, assistant/agent, VSN API, work-system provider  
**Data:** DATA-006, DATA-007, DATA-009

```text
meeting/search context
  -> model proposes structured action
  -> authorization/scope/policy check
  -> human approval when required
  -> idempotent integration command
  -> external provider
  -> action receipt/result
  -> audit event
```

Security:

- retrieved content is data, not authority;
- model output cannot grant itself scopes;
- sensitive writes require explicit approval policy;
- external IDs/scopes are validated server-side;
- retries reuse idempotency keys;
- action receipt records actor, tenant, target, scope, time and outcome without unnecessary content.

## 9. Flow H — Billing and usage metering

**Actors:** capability runtime, usage ledger, billing provider  
**Data:** DATA-008, DATA-009

```text
capability/provider execution
  -> normalized UsageEvent
  -> idempotent usage ledger
  -> entitlement/quota evaluation
  -> billing aggregation
  -> external billing provider where applicable
```

Rules:

- usage ledger is durable and idempotent;
- Redis is not billing source of truth;
- provider cost and customer usage units are stored separately;
- raw card data never enters VSN storage;
- webhook updates require signature and replay protection.

## 10. Flow I — Deletion and retention propagation

**Actors:** user/admin, API, workers, storage/search/provider adapters  
**Data:** DATA-002 through DATA-007 as applicable

```text
deletion request
  -> authorization + legal/retention policy check
  -> deletion job/ledger
  -> canonical record/object deletion
  -> vector/search/cache deletion
  -> derived artifact deletion
  -> provider-side deletion request where supported
  -> completion/exception evidence
```

Rules:

- deletion is dependency-aware and idempotent;
- legally/business-required records are separated from deletable content;
- inability to delete at a provider is surfaced as an exception, not marked complete;
- backup deletion follows documented expiry window rather than unsafe ad-hoc mutation.

## 11. Flow J — VSN proprietary model research/training

**Actors:** approved VSN AI operator/pipeline, research storage, model registry  
**Data:** DATA-010; customer content excluded by default

```text
approved dataset source
  -> rights/provenance validation
  -> isolated research storage
  -> preprocessing/evaluation split
  -> training
  -> model artifact
  -> evaluation/security gates
  -> signed/versioned registry entry
  -> optional staged provider deployment
```

Hard gates:

- separate data/compute authorization before customer-derived or material-cost training;
- dataset lineage/provenance required;
- no default production-customer-content training;
- model promotion requires benchmark/regression evidence and rollback path.

## 12. API/event compatibility and migration

- persisted contract schemas are versioned;
- additive changes are preferred;
- incompatible changes use expand -> migrate/backfill -> verify -> contract;
- webhook/event consumers must tolerate documented additive fields;
- event handlers are idempotent;
- irreversible data transformations require backup/recovery and explicit verification plan.

## 13. Stage 11 exit criteria

Stage 11 baseline is complete when:

- core realtime, meeting, identity, integration, billing, deletion and model-research flows are documented;
- every sensitive flow maps to classified data and trust/security controls;
- authorization, persistence, retries, failure and retention behavior are explicit;
- no flow contradicts `config/security/threat-model.json` or `config/data/data-governance.json`.

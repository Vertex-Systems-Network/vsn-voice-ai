# VSN Voice AI — Non-Functional Requirements Baseline

**Status:** PHASE-000 engineering baseline  
**Scope:** measurable targets for implementation and benchmarking; these are not external SLAs unless later promoted through release/commercial policy.

## 1. Realtime audio

| ID | Requirement | Initial engineering target |
|---|---|---|
| NFR-AUD-001 | Base audio continuity | Optional AI failure must not terminate the base call audio path. |
| NFR-AUD-002 | Safe bypass | Runtime must be able to enter usable bypass within 250 ms of a detected processing-path failure under supported test conditions. |
| NFR-AUD-003 | Local enhancement latency | Local noise/VAD/enhancement stages should target <= 40 ms p95 added processing latency on supported reference hardware. |
| NFR-AUD-004 | Accent path latency | Realtime accent conversion should target <= 300 ms p95 added latency for an approved provider/device path; provider-specific targets may be stricter. |
| NFR-AUD-005 | Translation latency | Realtime speech translation should target first understandable translated audio within 1.0 s p95 after a stable source speech segment where provider behavior permits streaming. |
| NFR-AUD-006 | Realtime overload behavior | Queue/backpressure limits must be bounded; overload degrades to fallback/bypass rather than unbounded buffering. |
| NFR-AUD-007 | Device recovery | Supported device unplug/replug, sleep/wake and default-device changes must recover without application restart where platform APIs permit it. |

Latency budgets are measured end-to-end at defined stage boundaries and must state hardware, sample rate, frame size, provider/region and network conditions.

## 2. Transcription and meeting intelligence

| ID | Requirement | Initial engineering target |
|---|---|---|
| NFR-MTG-001 | Live transcript responsiveness | Stable partial transcript updates should target <= 750 ms p95 after speech reaches the selected STT provider under supported network conditions. |
| NFR-MTG-002 | Finalization correctness | Final transcript/artifact versions must never be presented as final until reconciliation succeeds or a visible partial-failure state is recorded. |
| NFR-MTG-003 | Artifact traceability | Decisions, action items and factual meeting outputs should carry source segment references when technically available. |
| NFR-MTG-004 | Failure isolation | Notes/search/analytics failure must not interrupt capture or live call audio. |
| NFR-MTG-005 | Webhook idempotency | Duplicate supported provider webhook delivery must not create duplicate durable meetings, usage charges or external actions. |

## 3. API and SaaS performance

| ID | Requirement | Initial engineering target |
|---|---|---|
| NFR-API-001 | Control API latency | Common authenticated metadata reads target <= 300 ms p95 server response time at initial expected load, excluding external provider calls. |
| NFR-API-002 | Mutation idempotency | Retry-safe mutating workflows use idempotency keys or durable deduplication where duplicate delivery is credible. |
| NFR-API-003 | Tenant isolation | Cross-tenant object access tests must have zero known authorization bypasses before staging/release promotion. |
| NFR-API-004 | Rate limiting | Public/auth/provider-callback surfaces define bounded abuse/rate limits before internet-facing production deployment. |

## 4. Reliability and resilience

| ID | Requirement | Initial engineering target |
|---|---|---|
| NFR-REL-001 | Provider circuit breaking | Repeated provider failures open a circuit and stop unbounded realtime retries. |
| NFR-REL-002 | Async retries | Background jobs distinguish retryable/non-retryable failures and expose exhausted/dead-letter state. |
| NFR-REL-003 | No false success | Capture, provider, action, billing and deletion workflows cannot be marked successful without durable evidence. |
| NFR-REL-004 | Rollback | Provider policy/config changes and deployable services require a documented rollback/disable path before production release. |
| NFR-REL-005 | Recovery objectives | Production RTO/RPO are defined before production release based on actual storage/backup architecture; PHASE-000 does not fabricate values before infrastructure exists. |

## 5. Security and privacy

| ID | Requirement | Initial engineering target |
|---|---|---|
| NFR-SEC-001 | Secrets | Zero provider/OAuth/signing secret values committed to Git or emitted to normal logs. |
| NFR-SEC-002 | Sensitive telemetry | Zero raw audio, raw voice embeddings or full customer transcript bodies in default application telemetry. |
| NFR-SEC-003 | Encryption | Restricted/confidential persisted customer data uses encryption in transit and at rest in production-capable environments. |
| NFR-SEC-004 | Consent | Recording/voice-profile/high-risk action flows enforce applicable user/tenant consent/policy before execution. |
| NFR-SEC-005 | Deletion | Deletion workflows propagate to derived indexes/caches/artifacts and report unsupported provider deletion as an exception. |
| NFR-SEC-006 | Customer training | Customer content is not used for VSN model training by default; any exception requires separate explicit authorization and provenance. |

## 6. Web UX and accessibility

| ID | Requirement | Initial engineering target |
|---|---|---|
| NFR-UX-001 | Accessibility | Web product targets WCAG 2.2 AA. |
| NFR-UX-002 | Responsive coverage | Core flows verified at 360, 768, 1280 and 1440+ px widths. |
| NFR-UX-003 | Status clarity | Active/degraded/bypassed/recording/error states are conveyed with text/semantics, not color alone. |
| NFR-UX-004 | Keyboard | Core web workflows are operable by keyboard with visible focus. |
| NFR-UX-005 | Web loading performance | Primary authenticated web surfaces target LCP <= 2.5 s at p75 under the defined test profile once real UI/assets exist. |

## 7. Observability

| ID | Requirement | Initial engineering target |
|---|---|---|
| NFR-OBS-001 | Correlation | Realtime/control/background flows carry correlation/session identifiers across service boundaries. |
| NFR-OBS-002 | Provider attribution | Capability executions expose provider/model/version, latency class, success/failure and fallback state without sensitive content. |
| NFR-OBS-003 | Cost attribution | Metered third-party capability usage can be attributed to provider/capability/tenant/accounting period before paid production scale. |
| NFR-OBS-004 | Release identity | Runtime health/build metadata identifies immutable build/commit version. |

## 8. Benchmark policy

- Every latency/quality result records environment, hardware, network, provider/model/SDK version and corpus/test scenario.
- A target may be revised only with documented benchmark evidence and architecture/product impact.
- Provider marketing claims do not count as VSN verification.
- Unsupported CI hardware must not be used to fabricate realtime/audio benchmark success.
- Quality includes intelligibility, speaker identity, accent effectiveness, translation correctness, transcript accuracy and failure behavior as applicable.

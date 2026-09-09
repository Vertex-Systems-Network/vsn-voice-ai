# AI-Native Pre-Plan — Voice AI Platform

> Living planning document for `Vertex-Systems-Network/voice-ai`.
>
> **Authorization state:** planning/research/documentation only. Product implementation, model training, infrastructure provisioning, production credentials, paid API usage and deployment are locked until explicit owner consent. Technology selection also retains the mandatory Stage 9 `Approve Technology Stack` gate.

## 1. Product Objective

Build a commercial, subscription-based **AI Voice + Meeting Intelligence platform** that can operate across calls, meetings and supported telephony environments.

Primary outcomes:

- Make speech clearer in real time through noise/background-voice cleanup.
- Convert accents toward a selected target accent while preserving the user's recognizable voice and natural delivery.
- Translate speech bidirectionally in near real time where appropriate.
- Produce live captions/transcripts and high-quality finalized meeting records.
- Turn meetings into notes, summaries, decisions, action items, searchable knowledge and follow-up workflows.
- Provide opt-in live AI assistance/coaching.
- Use a **hybrid AI architecture** where external providers and VSN-owned models are interchangeable capability providers.
- Progressively improve VSN ownership of core models where quality, privacy, latency or economics justify replacing third-party processing.

Primary users:

- Individual professionals who communicate internationally.
- Sales/support/contact-center agents.
- Remote teams and meeting-heavy professionals.
- BPO/contact-center organizations.
- Enterprise teams needing meeting intelligence and voice enhancement.
- Developers/partners later consuming selected capabilities through APIs/SDKs.

## 2. Scope

### In scope

### A. Realtime audio

- Microphone/speaker routing.
- Virtual microphone and relevant virtual audio devices.
- Noise cancellation.
- Background voice cancellation/isolation.
- Echo/de-reverberation where supported.
- VAD and audio quality telemetry.
- Accent conversion, inbound/outbound where supported.
- Voice identity preservation and adjustable accent strength where technically viable.
- Realtime speech translation.
- Safe bypass if processing or provider fails.

### B. Speech and meetings

- Streaming and finalized transcription.
- Live captions.
- Speaker diarization and timestamped utterances.
- Meeting bots and/or botless/native/desktop capture depending on platform and permissions.
- Zoom, Google Meet, Microsoft Teams, Webex and other practical surfaces as adapters become verified.
- Calendar scheduling for meeting capture.
- Meeting recordings where explicitly authorized.
- Live/post-meeting notes.
- Summaries, key points, decisions, action items, owners/due dates.
- Topics/chapters, entities, keywords, highlights/bookmarks and clips.
- Search/Q&A over authorized meeting knowledge.
- Follow-up drafts and export/share workflows.
- Meeting analytics such as talk ratio/speaker stats where appropriate.
- Optional sentiment/communication signals with careful product framing.
- Live assistant/coaching and authorized meeting-agent participation.

### C. Hybrid AI platform

- Provider capability registry.
- Provider adapter SDK/contracts.
- Per-capability routing.
- Health, rate-limit and outage fallback.
- Quality/latency/cost/privacy/region-aware routing.
- VSN-owned model provider.
- Provider version/capability discovery and continuous re-evaluation.
- Optional enterprise BYOK later.

### D. SaaS/business platform

- Accounts, organizations, roles and team administration.
- Desktop ↔ web account linking.
- Meeting library and workspace.
- Subscription plans, trials, entitlements, usage minutes and quotas.
- Provider-cost and gross-margin telemetry.
- Admin/operations dashboards.
- Developer API/SDK/webhooks in a later phase.

### Out of scope / non-goals

- Claiming every provider is integrated merely because it exists.
- Unauthorized meeting recording or transcription.
- Covert impersonation or unauthorized voice cloning.
- Starting proprietary model training before data rights, budget, evaluation plan and owner consent are approved.
- Forcing all realtime and post-meeting tasks through one provider.
- Treating accent conversion and language translation as the same latency/problem class.
- Shipping every listed meeting feature in the first commercial release.

## 3. Current Repository Reality

- Existing Voice AI product implementation: **none verified**.
- Existing architecture: ANPOS governance/template blueprint only.
- Current `config/protocol/instance.json`: inherited `template_source` state while actual repo is `Vertex-Systems-Network/voice-ai`; therefore the repository is an **uninitialized child** under ANPOS rules.
- Existing product tests/build: none verified.
- Existing product deployment/environments: none verified.
- Existing product provider credentials/connections: none verified.
- Planning files now contain project-specific intake/options/modules.
- Child bootstrap remains pending and must be reconciled before implementation execution.

## 4. Primary Actors and Workflows

### Individual user

1. Install desktop application.
2. Sign in and select physical mic/speaker.
3. Enable processing modules such as Noise Clean, Accent, Translation or Captions.
4. Select the product's virtual microphone in Zoom/Teams/Meet/dialer.
5. Start a call/meeting.
6. Realtime pipeline processes audio using the best allowed provider/model.
7. User optionally sees captions/live notes/assistant signals.
8. Final meeting artifacts appear in the web/desktop workspace.

### Team/enterprise admin

1. Create/connect organization.
2. Invite users and assign roles.
3. Set provider/data-retention/privacy policy.
4. Configure default languages/accent behavior and meeting capture policy.
5. View usage, cost, quality, meeting and operational analytics.

### Meeting workflow

Calendar/meeting URL → authorized capture path → realtime audio/transcript events → live notes/assistant → recording/final transcript where allowed → transcript reconciliation → summary/decisions/action items/search index → export/integrations.

### Provider workflow

Capability request → policy evaluation → eligible provider set → route using health/latency/quality/cost/privacy/region → execute → normalize events/errors → meter usage/cost → fallback if safe → persist provenance.

## 5. Validated Requirements

- Hybrid external + proprietary AI architecture.
- Relevant third-party API/SDK integrations when actually available and commercially usable.
- VSN-owned AI as a first-class provider.
- Realtime noise cancellation/audio cleanup.
- Accent conversion with voice preservation.
- Speech translation.
- Live transcription/captions.
- Broad meeting intelligence including notes.
- Major meeting/calling compatibility.
- Provider fallback and non-hardcoded vendor architecture.
- README total-module tracker updated after every project-changing owner query/update.
- No implementation until explicit owner consent.

## 6. Assumptions Still Requiring Validation

- Windows-first commercial desktop launch is likely optimal; final platform order remains unapproved.
- On-device processing should be preferred for selected low-latency functions when licensing/model footprint/device performance support it.
- A unified meeting API/SDK can accelerate cross-platform meeting capture, with native adapters added selectively.
- Initial proprietary model focus should be one or both of: realtime noise/BVC; Pakistan/India/Middle-East English → US English accent conversion.
- Subscription pricing will likely combine plan entitlements with minute/usage protection because provider costs are variable.
- Enterprise buyers may require regional processing, configurable retention, SSO and BYOK/provider controls.

## 7. Constraints and Risks

### Technical

- Accent conversion at conversational latency while preserving identity/naturalness is a major R&D challenge.
- Full speech translation has materially higher latency than accent-only transformation.
- Audio routing/virtual drivers are OS-sensitive and can destabilize user calls if poorly engineered.
- Realtime provider failure must not cut off the base call; bypass/fallback is critical.
- Overlapping speech, noise, code-switching and diarization remain hard meeting cases.

### Commercial/vendor

- API/SDK availability does not guarantee redistribution/embedded/commercial rights.
- Provider pricing/quotas may change; routing and cost telemetry are required.
- Sanas integration availability must be verified rather than assumed from product documentation.

### Privacy/security/legal

- Audio, recordings, voice identity and transcripts can be highly sensitive.
- Recording/transcription consent rules vary by context/jurisdiction.
- External AI providers create data-boundary and retention dependencies.
- Voice personalization requires anti-impersonation controls and strong consent.

### Product scope

- Attempting every meeting feature in V1 would compromise the core realtime experience.
- Core audio quality, latency, stability and provider economics must outrank secondary feature breadth in early phases.

## 8. Approved Technology Decisions

No concrete implementation stack is approved yet.

- Frontend: **TBD — Stage 9 consent required**
- Backend: **TBD — Stage 9 consent required**
- Desktop/native audio: **TBD — Stage 9 consent required**
- AI training/runtime: **TBD — Stage 9 consent required**
- Data: **TBD — Stage 9 consent required**
- Infrastructure: **TBD — Stage 9 consent required**
- Consent status: **pending**

### Architecture direction already selected by owner

- Hybrid provider architecture.
- VSN-owned models as first-class providers.
- Provider-neutral routing/fallback.
- Desktop virtual-audio capability.
- Dual-path live + finalized meeting intelligence.

These are product/architecture requirements, **not approval of a programming-language/cloud stack**.

### Initial provider research catalog

The following are integration **candidates**, not claims of completed integration:

| Provider | Publicly verified relevant capability | Planning status |
|---|---|---|
| Krisp SDK | Noise cancellation, background-voice cancellation, accent conversion; device/server SDKs | High-priority candidate; commercial access/licensing required |
| Sanas | Accent Translation, inbound/outbound accent features, Language Translation | Benchmark/candidate; programmatic/partner integration access must be verified |
| OpenAI | Realtime voice, realtime translation, realtime transcription, tool-capable voice models | High-priority cloud candidate |
| Deepgram | Streaming STT, TTS, Voice Agent API, third-party/BYO provider composition | High-priority speech candidate |
| ElevenLabs | Speech-to-speech/voice transformation and voice APIs | Candidate for voice/speech transformation |
| Recall.ai | Cross-platform meeting bots/desktop capture, realtime audio/video/transcripts/metadata, AI agent I/O | High-priority meeting-capture candidate |
| AssemblyAI | Realtime STT, speaker diarization/revision and meeting-oriented transcript intelligence | High-priority STT/diarization candidate |
| Azure AI Speech / Voice Live | Realtime voice, translation, STT/TTS ecosystem | Enterprise cloud candidate |
| Google Cloud Speech | Streaming STT and broad speech ecosystem | Candidate |
| AWS Transcribe/Polly | Streaming transcription and bidirectional streaming speech synthesis | Candidate |
| Speechmatics | Realtime/batch STT, TTS, voice-agent APIs; cloud/on-prem deployment options | Enterprise/privacy candidate |
| VSN AI | Proprietary models to be trained/evaluated and exposed through the same provider contract | Required first-class internal provider |

Provider catalog must expand over time when other relevant providers expose usable API/SDK access. Activation requires verified documentation, access, terms, data policy, region, quota, cost and contract tests.

## 9. Options Bank Summary

- Selected: `OPT-001`, `OPT-002`, `OPT-003`, `OPT-006`, `OPT-010`, `OPT-012`
- Candidate: `OPT-004`, `OPT-005`, `OPT-007`, `OPT-008`, `OPT-009`, `OPT-011`
- Rejected: none yet
- Deferred: none yet

## 10. Proposed Modules

Canonical modules are stored in `config/ai/modules-bank.json`.

1. `MOD-001` Project Governance, Bootstrap & Consent
2. `MOD-002` Desktop Audio Core & Virtual Devices
3. `MOD-003` Realtime Audio Enhancement
4. `MOD-004` Accent Conversion & Voice Preservation
5. `MOD-005` Realtime Speech Translation
6. `MOD-006` Live Transcription, Captions & Diarization
7. `MOD-007` Meeting Capture & Platform Connectors
8. `MOD-008` Meeting Intelligence & Knowledge
9. `MOD-009` Live AI Assistant & Communication Coach
10. `MOD-010` Hybrid AI Provider Gateway & Orchestration
11. `MOD-011` Proprietary VSN AI Runtime & Model Registry
12. `MOD-012` Voice Personalization & Identity Safety
13. `MOD-013` Telephony & Contact Center Integrations
14. `MOD-014` SaaS Web App, Accounts, Teams & Workspace
15. `MOD-015` Subscriptions, Entitlements & Usage Metering
16. `MOD-016` Admin, Analytics, Observability & Cost Control
17. `MOD-017` Privacy, Security, Compliance & Data Governance
18. `MOD-018` Quality, Performance, Release & Desktop Updates
19. `MOD-019` Public Developer API, SDKs & Webhooks

## 11. Phase / Milestone Strategy

All durations below are planning estimates **after** an approved development start; they are not active schedules and do not create start/end timestamps.

### Phase 0 — Initialization, evidence and architecture gates

Target: 1–2 weeks after approved start.

- Bootstrap child project.
- Select/skip PM and select verified development AI runtime.
- Capability-aware quality baseline.
- Provider-access investigation.
- System design.
- Technology alternatives/recommendation.
- `Approve Technology Stack` consent.
- Threat model/data classification baseline.

Primary modules: `MOD-001`, `MOD-010`, `MOD-017`.

### Phase 1 — Realtime audio commercial core

Target: 6–10 weeks after Phase 0.

- Desktop audio path and virtual mic.
- Noise/background-voice cancellation.
- Provider gateway foundation.
- One external accent provider path if licensed/available.
- Accent controls and safe bypass.
- Basic auth/account/app shell.
- Usage telemetry.

Primary modules: `MOD-002`, `MOD-003`, `MOD-004`, `MOD-010`, `MOD-014`, `MOD-016`, `MOD-017`, `MOD-018`.

### Phase 2 — Translation + live transcription

Target: 4–7 weeks after Phase 1.

- Realtime translation provider adapters.
- Streaming STT/captions.
- Diarization/final transcript reconciliation.
- Provider quality/latency/cost comparison.

Primary modules: `MOD-005`, `MOD-006`, `MOD-010`, `MOD-016`, `MOD-018`.

### Phase 3 — Meeting intelligence

Target: 5–8 weeks after Phase 2.

- Meeting capture adapters.
- Calendar/scheduling.
- Meeting workspace.
- Notes, summaries, action items, decisions, topics, Q&A/search and export.
- Live/final artifact reconciliation.

Primary modules: `MOD-007`, `MOD-008`, `MOD-014`, `MOD-017`, `MOD-018`.

### Phase 4 — Commercial SaaS and team readiness

Target: 4–6 weeks; can overlap selected Phase 3 work after architecture approval.

- Subscription/entitlements/usage metering.
- Team/org controls.
- Admin analytics, provider cost and health.
- Enterprise retention/provider policy foundations.

Primary modules: `MOD-014`, `MOD-015`, `MOD-016`, `MOD-017`, `MOD-018`.

### Phase 5 — Live assistant, telephony and broader integrations

Target: 6–10 weeks.

- Live AI coach/assistant.
- Contact-center/telephony adapters.
- Native meeting integrations where justified.
- CRM/workflow integrations as product evidence supports them.

Primary modules: `MOD-009`, `MOD-013`, `MOD-007`, `MOD-010`.

### Phase 6 — Proprietary AI expansion

Runs in parallel only after approved dataset/compute plan; first production-capable model may require several months.

- VSN dataset/evaluation pipeline.
- Proprietary noise/BVC and/or accent model research.
- On-device/server inference packaging.
- Shadow evaluation against external providers.
- Controlled production routing only after quality/security evidence.

Primary modules: `MOD-011`, `MOD-003`, `MOD-004`, `MOD-010`, `MOD-012`, `MOD-017`, `MOD-018`.

### Phase 7 — Developer platform

Later milestone after internal contracts stabilize.

- Public API.
- Webhooks.
- SDKs.
- Developer portal/sandbox.

Primary module: `MOD-019`.

## 12. Dependency and Critical-Path Notes

Critical path for a usable realtime product:

`MOD-001 → MOD-010 → MOD-002 → MOD-003 → MOD-004 → MOD-018`

Meeting path:

`MOD-010 → MOD-006 + MOD-007 → MOD-008 → MOD-014`

Commercial path:

`MOD-014 + MOD-010 + MOD-016 → MOD-015`

Proprietary AI path:

`MOD-001 + MOD-017 → MOD-011 → MOD-010 → capability-specific module`

Key rule: meeting feature development must not delay proving stable realtime audio, provider routing and latency first.

## 13. QA Strategy

- Provider adapter contract tests.
- Golden audio regression corpus.
- Realtime latency/jitter/packet-loss benchmarks.
- CPU/GPU/NPU resource tests where local inference applies.
- Speaker similarity and accent intelligibility evaluation.
- Translation quality and code-switching tests.
- WER/cpWER and diarization tests.
- Zoom/Teams/Meet/Webex compatibility matrix where supported.
- Device hotplug/sleep/wake/reconnect/crash recovery.
- Provider outage/rate-limit/fallback chaos tests.
- Billing metering/idempotency tests.
- RBAC/tenant isolation and retention/deletion tests.
- Web WCAG 2.2 AA baseline.
- Installer/update/rollback tests.

No capability is complete from code existence alone; evidence is required.

## 14. Security Strategy

- Explicit data classification for raw audio, recordings, voice identity, transcripts, embeddings and derived notes.
- Default-minimize audio/recording storage.
- Strong tenant isolation and RBAC.
- Provider credentials in secure secret storage only.
- Ephemeral credentials for client realtime sessions where supported.
- Provider routing blocked when tenant region/privacy policy is incompatible.
- Recording/transcription consent/disclosure controls.
- Voice identity consent/revocation and anti-impersonation controls.
- Signed desktop artifacts/model updates.
- Prompt/tool-injection defenses for live assistant and meeting agents.
- Auditable provider/model/version provenance for generated artifacts.
- Retention/deletion/export workflows.
- Security/compliance claims only from verified evidence.

## 15. Deployment / Operations Implications

- Realtime audio services require regional routing and stable low-jitter media paths.
- On-device processing should reduce latency/cloud cost where feasible.
- Cloud capabilities require provider/session health, timeout, circuit-breaker and safe bypass.
- Provider unit cost must be captured per minute/session/capability.
- Model/provider updates require staged rollout and rollback.
- Desktop auto-update and native driver signing are operationally critical.
- Meeting webhooks/jobs require idempotency and replay handling.
- SLOs should separately measure audio path continuity, processing latency, transcription availability, meeting artifact finalization and provider health.

## 16. Unresolved Human Decisions

- Explicit consent to initialize/start development.
- Final technology stack approval after architecture alternatives are presented.
- Windows-only first release vs Windows + macOS initial release.
- Initial geographic market/hosting regions.
- External provider contracts/accounts to activate first.
- First VSN proprietary model priority and approved R&D/data budget.
- Meeting recording default behavior and retention policy.
- Initial subscription packaging/pricing.
- Enterprise compliance targets beyond baseline security/privacy readiness.
- Project Management provider choice or explicit skip.
- Development AI pool after child bootstrap/discovery.
- Whether/when to apply recommended GitHub Rules.

## 17. Execution Readiness

- [x] validated project objective exists
- [ ] child repository bootstrap/reality has been reconciled
- [ ] system design is approved enough to proceed
- [ ] technology stack has required consent
- [x] options bank is populated sufficiently for current planning
- [x] modules bank is populated with stable module IDs
- [x] module-option attachments are defined at planning level
- [x] phases/milestones are mapped to modules
- [ ] modules are decomposed into implementation work units
- [x] major dependencies and blockers are visible
- [x] module-level acceptance criteria and quality gates exist
- [ ] project state identifies a valid implementation resume point

### Development lock

`LOCKED — OWNER CONSENT REQUIRED`

Until the owner explicitly authorizes development, only planning/research/documentation reconciliation is permitted. README progress must remain evidence-based and implementation modules must not be given fabricated start/end datetimes or non-zero completion.

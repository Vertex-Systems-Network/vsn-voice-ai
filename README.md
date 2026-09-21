# VSN Voice AI — Hybrid Realtime Voice & Meeting Intelligence Platform

**Repository:** `Vertex-Systems-Network/vsn-voice-ai`  
**Operating protocol:** ANPOS `1.3.13`  
**Development authorization:** `APPROVED — CONSENT-000001 (2026-09-10 02:25 PKT)`  
**Technology stack:** `APPROVED — CONSENT-000002 (2026-09-10 03:01 PKT)`  
**Canonical module count:** **25**  
**Machine execution plan:** **10 phases / 25 Level-1 work units**

> Development is active. **PHASE-000 is complete and PHASE-001 is in progress.** `MOD-002 / WU-002` remains the current tracked work and is completion-blocked on controlled Windows acceptance evidence; the deterministic next valid product lane is `MOD-014 / WU-014` (SaaS Web App, Accounts, Teams & Workspace), which is actively advancing through bounded tenant-safe desktop/web identity-linking slices. Paid third-party consumption, proprietary model training, production credentials/cloud spend and production deployment remain subject to their applicable provider/data/compute/release gates.

## Product Direction — Confirmed

The owner-approved product direction is:

1. Build a **hybrid AI platform**, not a single-vendor wrapper.
2. Integrate relevant providers only when access, licensing, privacy, region, quota/cost and implementation are verified.
3. Add **VSN-owned AI models/runtime as first-class providers** behind the same internal contracts.
4. Build a directly usable realtime calls/meetings product covering audio enhancement, accent conversion, voice preservation, translation, transcription, meeting intelligence, coaching, search, authorized actions, multi-platform capture, integrations, telephony/contact-center, SaaS subscriptions, enterprise controls and later public APIs/SDKs.

## Current Repository State

- Child project: `active_project`; bootstrap complete.
- **PHASE-000 — Initialization & Architecture Gates: complete.**
- **PHASE-001 — Realtime Audio Commercial Core: in progress.**
- `WU-001` governance/bootstrap/consent: **complete**.
- `WU-010` provider-gateway foundation: **complete**; broader `MOD-010` work remains cross-cutting/in progress.
- `WU-017` PHASE-000 privacy/security/data-governance baseline: **complete**; broader `MOD-017` work remains cross-cutting/in progress.
- `WU-002` desktop audio core and virtual devices: **in progress** since **2026-09-10 03:43 PKT**; completion is externally blocked by Issue #110 controlled Windows acceptance.
- `WU-014` SaaS web app, accounts, teams and workspace: **in progress**; current bounded delivery is tenant-safe desktop/web identity linking and workspace UX.
- Rust native workspace contains `vsn-audio-core` and `vsn-windows-audio`.
- Windows-native capture, recovery and virtual-mic transport contracts are CI verified through the current **secure shared-memory control path + guarded protocol-v2 ring consumer + PortCls/WaveRT descriptors + fail-closed PortCls lifecycle/stream contract + secure raw WDM IRP control runtime + PortCls-primary live DriverEntry** boundary.
- `native/windows-virtual-mic/driver/vsn_virtual_mic_control.vcxproj` is an x64 KMDF Desktop-driver project built with pinned Microsoft WDK/SDK NuGet `10.0.28000.2526`.
- The live `DriverEntry` now uses the supported KMDF-miniport/PortCls pattern: `WDF_NO_EVENT_CALLBACK`, `WdfDriverInitNoDispatchOverride`, `WdfDriverCreate`, then `PcInitializeAdapterDriver`.
- After PortCls installs its handlers, the driver installs the raw WDM CREATE/CLOSE/CLEANUP and DEVICE_CONTROL multiplexers; those wrappers handle only the exact VSN raw control `PDEVICE_OBJECT` and forward every non-control request through `PcDispatchIrp`.
- The secure raw control device is published only after the final dispatch table is installed. Failure restores PortCls handlers and unwinds PortCls/WDF; successful unload removes the raw control surface, invokes the saved PortCls unload routine, then calls `WdfDriverMiniportUnload`.
- The secure control-v2 CONNECT contract does **not** accept a caller-supplied section handle. The driver creates the section in requestor context and returns a user handle only after initialization while retaining its own independent section-object reference.
- Transport protocol **v2** adds one aligned 64-bit seqlock-style stamp per PCM ring slot and bounds frame-sequence encoding.
- The guarded consumer normalizes overruns with exact drop accounting, produces fresh silence on underrun, validates the target slot before and after PCM copy, and rejects concurrent slot reuse without advancing the consumer cursor.
- The 48 kHz mono F32, 10 ms, four-frame protocol-v2 reference region is **7,872 bytes**: header `0`, cursor `64`, slot stamps `128`, audio `192`.
- The same guarded ring-consumer helper compiles and links inside the real WDK/KMDF `.sys` target.
- PortCls/WaveRT descriptor scaffolding is WDK compile-verified for one **48 kHz / mono / 32-bit IEEE-float** capture stream, with wave bridge + host capture pin + ADC node and a minimal virtual-microphone topology bridge.
- The WDK target links `portcls.lib`, `stdunk.lib`, `libcntpr.lib` and `wdmsec.lib`; native contract tests lock the initial endpoint geometry and descriptor indices.
- Real `PcInitializeAdapterDriver` and `PcAddAdapterDevice` references compile/link in the WDK target. The live PortCls initialization path is active, but `StartDevice` deliberately returns `STATUS_NOT_SUPPORTED` until real wave/topology miniports exist.
- A bounded WaveRT stream contract maps `STOP / ACQUIRE / PAUSE / RUN` to the WDK `KSSTATE` values, validates buffer/block/notification geometry, tracks cyclic and monotonic linear byte positions, accumulates notification cadence, rejects advancement outside RUN and keeps overflow failures transactional.
- The earlier WDF control-device experiment was compile/CI verified but has been removed from the current driver tree because Microsoft KMDF miniport guidance disallows framework control-device objects in the intended PortCls miniport architecture. PR #18, which attempted to migrate secure IOCTL runtime to that path, was closed unmerged/superseded.
- The supported control plane is a **same-driver raw WDM control device**. `vsn_virtual_mic_wdm_control_scaffold.cpp` uses `IoCreateDeviceSecure`, a unique VSN class GUID `{A47B0129-C8DA-4A5E-B8C4-6D8E20AC37F2}`, SYSTEM/Admin development SDDL and `FILE_DEVICE_SECURE_OPEN`, creates `\\Device\\VsnVirtualMicControl` plus `\\DosDevices\\VsnVirtualMicControl`, and provides bounded symbolic-link/device teardown.
- Raw WDM CREATE admits only user-mode opens. CONNECT/DISCONNECT/QUERY_STATUS enforce `Irp->RequestorMode == UserMode`, dynamically validate `FILE_READ_ACCESS | FILE_WRITE_ACCESS`, use exact METHOD_BUFFERED input/output sizes, and read/write only `Irp->AssociatedIrp.SystemBuffer`.
- Raw WDM connection ownership is fenced by `IoGetRequestorProcessId`, exact current-stack `PFILE_OBJECT` and session generation. The driver creates/maps the section in requestor context, retains its own object reference, stores immutable validated protocol geometry, reads stable cursor snapshots for status, and tears down on disconnect, owner cleanup, errors and control-device deletion under a PASSIVE-safe kernel mutex.
- The development control interface remains restricted to LocalSystem and built-in Administrators; least-privilege non-admin runtime policy remains pending.
- Windows implementation contract is documented in `docs/architecture/WINDOWS-AUDIO-IMPLEMENTATION.md`.
- **Actual wave/topology miniport registration, a concrete `IMiniportWaveRT` stream, an installed OS-visible microphone endpoint, calling-app route and controlled-hardware performance evidence are not yet claimed operational.**

**Latest verified green implementation CI:** AI Native Quality Gates run `34713869004` and Windows Audio Validation run `34713869035` both passed on implementation head `228a3edef05ef1598dec8f13af282950d2479764`. The Windows run passed Rust compile/Clippy/tests, restored the pinned WDK packages, built and WDK-validated `vsn_virtual_mic_control.sys` with the PortCls-primary live entry and secure raw WDM runtime linked in, and passed the native C++ virtual-mic contract suite. PR #25 merged this implementation to `main` as `14fd4c55ae6ad44d1e43af3ea574e66427f7551e`. The first Windows run for this slice (`34713657493`) correctly failed because `WdfDriverMiniportUnload` was undeclared; adding `<wdfminiport.h>` fixed the build before merge. The preceding secure raw WDM runtime merged as `6c395ef7cbd7afc5caa3daac506dee16073335fe`; raw WDM scaffold as `e31e40c0a78dcdf99396ea8a0bf3648691416b35`; architecture correction as `2665954315b52d01b3e59b6fb283f0da2a053eed`; PortCls lifecycle/WaveRT stream contracts as `78ef04bf86bf02b25b9da25ef401dc84f73f0f2b`; descriptor scaffold as `da1b0543bcbfe63ff6a342690cab3b250057bbe2`; guarded ring consumer as `9c57207482bdc20ca5dc70a06cbb43c0cfa86741`.

## AI-Native Progress Snapshot

<!-- AI-NATIVE-PROGRESS:START -->
- Overall work-unit progress: `3 / 25 complete (12%)`
- In-progress work units: `4`
- Current phase: `PHASE-001`
- Current tracked work: `MOD-002 / WU-002` — `in_progress`
- Current module completion: `0 / 1 complete (0%)`
- Next valid product work: `MOD-014 / WU-014` — `in_progress`
- Current WU-002 blocker: Issue #110 controlled Windows runner/acceptance evidence.
- Active WU-014 delivery: PR #134 cache/test hardening, PR #135 desktop-link persistence/status/revoke/inventory API, and PR #136 browser desktop-link issue/expiry/status/link/cancel UX; deterministic completion remains unchanged until a WU completion boundary is verified.
<!-- AI-NATIVE-PROGRESS:END -->

## README Reconciliation Rule — Mandatory

After **every owner query/update** related to this project, the acting AI must reconcile this README against repository reality before finishing. Every **material source-development milestone** must update README progress/evidence in the **same source commit**. A CI/status-only turn must still reconcile README truth, but must not create a README-only source commit merely to restate remote status.

1. Re-read `config/ai/modules-bank.json`; keep module count synchronized.
2. Reconcile every module dashboard row.
3. Start/end timestamps require repository evidence.
4. Progress requires verified work-unit evidence; do not invent percentages.
5. Calendar ETA stays `TBD` until a real working schedule exists.
6. Module/dependency changes go to the canonical module bank first.
7. Execution changes must stay synchronized with `config/ai/execution-plan.json` and `config/ai/project-state.json`.
8. In-progress Level-1 modules remain at `0%` until a verified module-completion boundary exists; evidence is listed separately rather than converted into invented fractional percentages.

# Total Modules Dashboard — 25 Modules

Progress scale: `░░░░░░░░░░ 0%` → `██████████ 100%`.

| ID | Module | Major scope / purpose | Start datetime | End datetime | Progress | Estimated completion datetime | Planning duration after dependencies |
|---|---|---|---|---|---|---|---|
| MOD-001 | Project Governance, Bootstrap & Consent | Project identity, governance, consent gates, traceability, README/state reconciliation | 2026-09-10 02:25 PKT | 2026-09-10 03:01 PKT | `██████████ 100%` | Complete for initial gate | Governance continues cross-cutting |
| MOD-002 | Desktop Audio Core & Virtual Devices | Mic/speaker capture, virtual mic/audio routing, device lifecycle, safe bypass | 2026-09-10 03:43 PKT | — | `░░░░░░░░░░ 0% — in progress` | TBD | 4–7 weeks |
| MOD-003 | Realtime Audio Enhancement | Noise cancellation, background voice removal, echo/de-reverb, VAD, quality metrics | Not started | — | `░░░░░░░░░░ 0%` | TBD | 3–5 weeks |
| MOD-004 | Accent Conversion & Voice Preservation | Accent conversion, inbound/outbound handling, voice preservation, strength controls | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–10 weeks integrated-provider path; proprietary R&D separate |
| MOD-005 | Realtime Speech Translation | Bidirectional speech translation, language detection, translated audio/captions | Not started | — | `░░░░░░░░░░ 0%` | TBD | 3–5 weeks initial provider path |
| MOD-006 | Live Transcription, Captions & Diarization | Streaming/final STT, captions, speakers, timestamps, vocabulary, PII controls | Not started | — | `░░░░░░░░░░ 0%` | TBD | 3–5 weeks |
| MOD-007 | Meeting Capture & Platform Connectors | Zoom/Teams/Meet/Webex, bot/botless/native capture, calendar, participant/chat/events | Not started | — | `░░░░░░░░░░ 0%` | TBD | 4–7 weeks initial platforms |
| MOD-008 | Meeting Intelligence & Knowledge | Notes, summaries, decisions, action items, topics, highlights, clips, meeting Q&A | Not started | — | `░░░░░░░░░░ 0%` | TBD | 4–7 weeks initial feature set |
| MOD-009 | Live AI Assistant & Communication Coach | Live suggestions, clarity/pace/interruption cues, contextual Q&A | Not started | — | `░░░░░░░░░░ 0%` | TBD | 4–7 weeks |
| MOD-010 | Hybrid AI Provider Gateway & Orchestration | Provider registry, adapters, routing, fallback, health, quality/latency/privacy/cost policy | 2026-09-10 02:31 PKT | — | `░░░░░░░░░░ 0% — in progress` | TBD | Foundation verified; adapters continuous |
| MOD-011 | Proprietary VSN AI Runtime & Model Registry | Datasets/evaluation, model registry, training, inference, versioning, rollout/rollback | Not recorded | — | `░░░░░░░░░░ 0% — in progress` | TBD — data/compute authorization required before training | 6–12+ weeks runtime foundation; model R&D may take months |
| MOD-012 | Voice Personalization, Identity Safety & Voice Security | Voice profiles, verification, deepfake/spoof detection, speaker-change/agent verification | Not started | — | `░░░░░░░░░░ 0%` | TBD | 4–7 weeks initial controls/security path |
| MOD-013 | Telephony & Contact Center Integrations | SIP/PSTN/contact-center media, dialers, inbound/outbound calls, agent-assist hooks | Not started | — | `░░░░░░░░░░ 0%` | TBD | 4–8 weeks initial providers |
| MOD-014 | SaaS Web App, Accounts, Teams & Workspace | Auth, organizations, team roles, meeting library, settings, notifications | Not recorded | — | `░░░░░░░░░░ 0% — in progress` | TBD | 5–8 weeks core |
| MOD-015 | Subscriptions, Entitlements & Usage Metering | Plans, trials, billing, quotas, minutes, entitlements, overages, cost ledger | Not started | — | `░░░░░░░░░░ 0%` | TBD | 3–5 weeks |
| MOD-016 | Admin, Analytics, Observability & Cost Control | Admin, provider health, latency, usage/cost, logs/metrics/traces, SLOs | Not recorded | — | `░░░░░░░░░░ 0% — in progress` | TBD | 3–5 weeks foundation; continuous |
| MOD-017 | Privacy, Security, Compliance & Data Governance | Threat model, consent, retention/deletion, encryption, residency, RBAC, audit | 2026-09-10 03:01 PKT | — | `░░░░░░░░░░ 0% — in progress` | TBD | PHASE-000 baseline complete; continuous implementation verification |
| MOD-018 | Quality, Performance, Release & Desktop Updates | Product QA, audio benchmarks, E2E, signing, installers, updates, rollback | Not started | — | `░░░░░░░░░░ 0%` | TBD | Cross-cutting; release baseline 4–6 weeks |
| MOD-019 | Public Developer API, SDKs & Webhooks | REST/realtime APIs, SDKs, API keys, webhooks, rate limits, docs, sandbox | Not started | — | `░░░░░░░░░░ 0%` | TBD — later milestone | 5–8 weeks after internal contracts stabilize |
| MOD-020 | Multi-Platform Clients & In-Person Capture | iOS, Android, browser/Chrome, in-person recording, voice notes, cross-device sync | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–9 weeks initial clients |
| MOD-021 | Business Integrations & Workflow Automation | Calendar/email/chat, CRM, docs/storage, work tools, Zapier/Make/n8n, MCP | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–10 weeks initial pack; continuous |
| MOD-022 | Conversation Intelligence, QA & Compliance Scoring | Scorecards, QA, compliance, objections, sentiment, talk metrics, sales signals | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–9 weeks initial B2B intelligence set |
| MOD-023 | Unified Conversation Knowledge & Cross-App Search | Cross-meeting/call/app semantic search, source-cited Q&A, timelines, briefs | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–9 weeks initial knowledge layer |
| MOD-024 | Agentic Actions, AI Skills & Voice Agents | Authorized actions, skills/agents, CRM/task/email/calendar writes, approvals/audit | Not started | — | `░░░░░░░░░░ 0%` | TBD | 6–10 weeks initial safe agentic layer |
| MOD-025 | Enterprise Administration, Device Fleet & Deployment Control | SSO/SCIM, org hierarchy, device fleet, remote policy, managed/staged deployment | Not started | — | `░░░░░░░░░░ 0%` | TBD | 6–10 weeks enterprise foundation |

**Machine work-unit state:** `3 / 25 complete`, `4 / 25 in progress`  
**Verified implementation progress:** `0 / 25 modules implemented`  
**Verified fully completed product modules:** `0 / 25` (MOD-001 is governance, not a user-facing product module)  
**Current lifecycle:** `DEVELOPMENT / PHASE-001 IN PROGRESS`  
**Current implementation:** `MOD-002 / WU-002 — Desktop Audio Core & Virtual Devices` (current tracked work; externally completion-blocked)  
**Active next-valid development lane:** `MOD-014 / WU-014 — SaaS Web App, Accounts, Teams & Workspace`  
**Development consent:** `APPROVED`  
**Technology stack:** `APPROVED`

## WU-014 — Active Delivery

- PR #134: workspace bootstrap cache policy + deterministic API test discovery — exact-head technical checks green.
- PR #135: desktop-link persistence fail-closed boundary + tenant-safe lifecycle status + atomic pending-exchange revoke were exact-head green before this material update; this branch now also implements a bounded tenant/subject-scoped linked-desktop inventory using the latest consumed record per device, with new exact-head verification required.
- PR #136: browser desktop-link issue, transient record/token pairing, expiry clearing, confirmed linked-state observation and user cancellation — exact-head technical checks green.
- Deterministic project completion remains `3 / 25 (12%)`; these are in-progress WU-014 delivery slices, not completed-work-unit credit.

## MOD-002 — Current Verified Boundary

Implemented and CI-verified:

- validated `AudioFormat` / `AudioFrame` contracts, bounded realtime queues and safe processing bypass;
- platform-neutral capture/render device catalog, preferred/default/fallback selection and lifecycle state handling;
- deterministic device reselection plus bounded stream invalidation recovery and exponential reopen backoff;
- `vsn-windows-audio` MMDevice enumeration/default-role mapping and hosted-Windows runtime smoke coverage;
- `IAudioClient3` engine-period validation and shared capture cadence planning;
- event-driven WASAPI capture, sample decode/reframing, bounded packet draining and `CaptureRuntime` recovery;
- `IMMNotificationClient` registration on a dedicated Windows MTA thread, bounded non-blocking notification delivery and owner-thread recovery filtering;
- bounded `VirtualMicStagingBuffer` and `VirtualMicOutputBridge` for processed and safe-bypass frames;
- Rust/C++ transport protocol v2 with fixed audio geometry, session generation, deterministic cyclic-ring semantics and an aligned 8-byte per-slot write stamp;
- MSVC x64 ABI mirror with locked 40-byte protocol/cursor layouts and exact offsets;
- aligned Windows `Interlocked*64` cursor/stamp publication, bounded stable snapshots and explicit overrun/underrun accounting;
- deterministic 64-byte-aligned shared-region geometry; the protocol-v2 48 kHz mono F32 10 ms four-frame reference is **7,872 bytes** total;
- real unnamed user-mode `SharedSection` mapping with a configurable 16 MiB cap, non-inheritable handle, protected current-user/LocalSystem DACL and two-view protocol/audio/cursor/slot-stamp propagation tests;
- secure device-control ABI v2 using `METHOD_BUFFERED` and `FILE_READ_ACCESS | FILE_WRITE_ACCESS`; CONNECT carries validated protocol geometry and no caller-supplied shared-section handle;
- driver-created shared section in requestor process context, immediate independent kernel object reference, system-space mapping, protocol/cursor initialization and response handle return after successful initialization;
- guarded `ConsumeOneRingFrame` contract using immutable CONNECT-time geometry, exact overrun accounting, fresh-silence underrun behavior and before/after slot-stamp validation against concurrent reuse;
- PortCls/WaveRT descriptors for one 48 kHz mono 32-bit IEEE-float capture stream plus fail-closed PortCls lifecycle and bounded WaveRT state/position/notification contracts;
- secure raw WDM control-device creation with `IoCreateDeviceSecure`, `FILE_DEVICE_SECURE_OPEN`, unique class GUID, SYSTEM/Admin SDDL, `wdmsec.lib`, named device/symbolic link and bounded teardown;
- raw WDM `DRIVER_DISPATCH` CREATE/CLOSE/CLEANUP and DEVICE_CONTROL multiplexers use exact control-DO identity and `PcDispatchIrp` for all non-control devices;
- raw WDM CONNECT/DISCONNECT/QUERY_STATUS are CI verified with UserMode enforcement, dynamic read/write access validation, METHOD_BUFFERED exact sizing, PID + exact `PFILE_OBJECT` + generation ownership fencing, driver-owned section lifecycle, stable status snapshots and owner cleanup;
- live DriverEntry now uses the KMDF-miniport pattern and PortCls class-driver ownership, installs the verified raw WDM multiplexers after `PcInitializeAdapterDriver`, delays raw control publication until dispatch setup is complete, and performs bounded raw-control/PortCls/WDF unwind;
- unsupported WDF control-device scaffold removed from the current driver tree/build; PR #18 remains closed unmerged/superseded;
- latest AI Native run `34713869004` and Windows Audio Validation run `34713869035` green on implementation head `228a3edef05ef1598dec8f13af282950d2479764`, merged as `14fd4c55ae6ad44d1e43af3ea574e66427f7551e`.

Not yet verified and therefore **not claimed complete**:

- confirmed physical-microphone `IAudioClient3` values and real unplug/replug, Bluetooth/headset, default-device, sleep/wake and audio-service recovery on controlled Windows hardware;
- actual wave/topology miniport objects and registration from PortCls `StartDevice`;
- a concrete `IMiniportWaveRT` capture stream object using the verified descriptors/contracts;
- audio-engine scheduling/position/notification behavior that invokes the guarded ring consumer;
- INF/package creation, controlled-machine installation/test signing and runtime `DeviceIoControl` handshake against the installed driver;
- endpoint enumeration as an OS-visible microphone and processed/bypass audio reaching it;
- Zoom/Teams/Meet/dialer/browser compatibility through the actual endpoint;
- CPU/callback deadline, discontinuity, end-to-end latency and jitter evidence under controlled hardware load;
- least-privilege non-admin broker/interface ACL policy for production runtime;
- production driver signing, supported-Windows matrix, install/update/uninstall/rollback and reboot/sleep lifecycle evidence.

## Hybrid Provider Model

Every AI capability is consumed through a capability-oriented internal contract rather than hard-coded vendor logic.

Core capability families include:

`audio.noise_cancel`, `audio.background_voice_cancel`, `audio.echo_reduce`, `audio.vad`, `voice.accent_convert`, `voice.identity_preserve`, `voice.deepfake_detect`, `voice.speaker_verify`, `speech.translate_realtime`, `speech.transcribe_stream`, `speech.transcribe_finalize`, `speech.synthesize`, `meeting.capture`, `meeting.transcript`, `meeting.intelligence`, `conversation.score`, `knowledge.search`, `assistant.realtime`, `agent.action`, `telephony.media`.

Provider presence is not evidence of integration. Activation requires verified API/SDK access, terms/licensing, privacy/retention, region/residency, quota/cost and adapter tests.

## Provider Candidates — Not Yet Completed Integrations

| Provider | Relevant area | State |
|---|---|---|
| Krisp SDK | Noise/background voice cancellation, accent conversion, realtime audio | Candidate — access/licensing to verify |
| Sanas | Accent Translation, Language Translation, speech enhancement | Candidate/benchmark — programmatic/partner access to verify |
| OpenAI | Realtime speech, transcription, translation, tool-capable voice/agent workflows | Candidate |
| Deepgram | Streaming STT/TTS and Voice Agent APIs | Candidate |
| ElevenLabs | Voice/speech transformation and synthesis | Candidate |
| Recall.ai | Cross-platform meeting capture and realtime meeting data | Candidate |
| AssemblyAI | Realtime STT and diarization | Candidate |
| Azure AI Speech / Voice Live | Realtime speech/voice/translation | Candidate |
| Google Cloud Speech | Streaming speech-to-text | Candidate |
| AWS Transcribe / Polly | Streaming STT and speech synthesis | Candidate |
| Speechmatics | Realtime/batch STT, TTS, voice-agent APIs | Candidate |
| VSN AI | Proprietary models using same provider contracts | Required internal provider; models not trained yet |

## Approved Technology Stack

- **Web:** Next.js + React + TypeScript + Tailwind + shadcn/ui
- **Control API:** NestJS + Fastify + TypeScript
- **Desktop:** Tauri 2 + Rust + React/TypeScript; C++ for Windows native virtual-audio pieces where required
- **Realtime media:** Go + WebRTC; Pion candidate subject to benchmark
- **AI R&D:** Python + PyTorch + torchaudio
- **Production inference:** ONNX Runtime where compatible
- **Data:** PostgreSQL + pgvector + Redis + S3-compatible object storage
- **Infrastructure:** Docker + Terraform; AWS initial cloud candidate
- **Observability:** OpenTelemetry + Sentry + Prometheus/Grafana-compatible metrics
- **CI/CD:** GitHub Actions

Approval record: **`CONSENT-000002`**.

## Execution Phases

1. **PHASE-000 — Initialization & Architecture Gates — COMPLETE**
2. **PHASE-001 — Realtime Audio Commercial Core — IN PROGRESS**
3. **PHASE-002 — Translation & Live Transcription**
4. **PHASE-003 — Meeting Intelligence & Multi-Platform Capture**
5. **PHASE-004 — Commercial SaaS & Business Integrations**
6. **PHASE-005 — Conversation Intelligence & Enterprise**
7. **PHASE-006 — Unified Knowledge & Agentic Automation**
8. **PHASE-007 — Live Assistant & Telephony Expansion**
9. **PHASE-008 — Proprietary VSN AI Expansion**
10. **PHASE-009 — Developer Platform**

Canonical sources:

- modules: `config/ai/modules-bank.json`
- phases/work units: `config/ai/execution-plan.json`
- runtime state: `config/ai/project-state.json`
- consent: `config/consent/consent-requests.json`
- system design/stack: `docs/architecture/PHASE-000-SYSTEM-DESIGN.md`
- Windows audio contract: `docs/architecture/WINDOWS-AUDIO-IMPLEMENTATION.md`
- non-functional targets: `docs/architecture/NON-FUNCTIONAL-REQUIREMENTS.md`
- threat model: `config/security/threat-model.json`
- data governance: `config/data/data-governance.json`

## Remaining Gates

These do not block the current approved local implementation slice, but apply before their respective operations:

- Development AI/Supervisor/Worker identity selection before privileged worker dispatch. The owner requested a minimum 11-worker pool, but the current canonical agent catalog has no verified attachable workers and no live Supervisor; worker count must not be fabricated. At the WU dependency level, `WU-002`, `WU-014` and `WU-016` are currently dependency-ready; downstream work remains gated by the canonical execution graph.
- Optional PM provider selection or explicit skip.
- Provider access/licensing/privacy/cost verification before each third-party provider is activated.
- Separate dataset/compute authorization before proprietary model training or material paid GPU spend.
- Region/customer-specific legal/retention review before production release.
- Product-specific test, signing, security and release evidence before deployment.
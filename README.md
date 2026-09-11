# VSN Voice AI — Hybrid Realtime Voice & Meeting Intelligence Platform

**Repository:** `Vertex-Systems-Network/vsn-voice-ai`  
**Operating protocol:** ANPOS `1.3.13`  
**Development authorization:** `APPROVED — CONSENT-000001 (2026-09-10 02:25 PKT)`  
**Technology stack:** `APPROVED — CONSENT-000002 (2026-09-10 03:01 PKT)`  
**Canonical module count:** **25**  
**Machine execution plan:** **10 phases / 25 Level-1 work units**

> Development is active. **PHASE-000 is complete and PHASE-001 is in progress.** The current product implementation is `MOD-002 / WU-002` (Desktop Audio Core & Virtual Devices). Paid third-party consumption, proprietary model training, production credentials/cloud spend and production deployment remain subject to their applicable provider/data/compute/release gates.

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
- `WU-002` desktop audio core and virtual devices: **in progress** since **2026-09-10 03:43 PKT**.
- Rust native workspace contains `vsn-audio-core` and `vsn-windows-audio`.
- Windows-native capture, recovery and virtual-mic transport contracts are CI verified through the current **secure shared-memory control path + guarded protocol-v2 ring consumer + PortCls/WaveRT descriptors + fail-closed PortCls lifecycle/stream contract** boundary.
- `native/windows-virtual-mic/driver/vsn_virtual_mic_control.vcxproj` is an x64 KMDF Desktop-driver project built with pinned Microsoft WDK/SDK NuGet `10.0.28000.2526`.
- The current live KMDF control driver implements access-restricted `CONNECT` / `DISCONNECT` / `QUERY_STATUS`, requestor PID/file ownership checks, driver-created shared-section lifecycle, retained kernel object reference, system-space mapping and bounded teardown.
- The secure control-v2 CONNECT contract does **not** accept a caller-supplied section handle. The driver creates the section in requestor context and returns a user handle only after initialization while retaining its own independent section-object reference.
- Transport protocol **v2** adds one aligned 64-bit seqlock-style stamp per PCM ring slot and bounds frame-sequence encoding.
- The guarded consumer normalizes overruns with exact drop accounting, produces fresh silence on underrun, validates the target slot before and after PCM copy, and rejects concurrent slot reuse without advancing the consumer cursor.
- The 48 kHz mono F32, 10 ms, four-frame protocol-v2 reference region is **7,872 bytes**: header `0`, cursor `64`, slot stamps `128`, audio `192`.
- The same guarded ring-consumer helper compiles and links inside the real WDK/KMDF `.sys` target.
- PortCls/WaveRT descriptor scaffolding is WDK compile-verified for one **48 kHz / mono / 32-bit IEEE-float** capture stream, with wave bridge + host capture pin + ADC node and a minimal virtual-microphone topology bridge.
- The WDK target links `portcls.lib`, `stdunk.lib` and `libcntpr.lib`; native contract tests lock the initial endpoint geometry and descriptor indices.
- Real `PcInitializeAdapterDriver` and `PcAddAdapterDevice` references compile/link in the WDK target through a deliberately fail-closed PortCls lifecycle scaffold; `StartDevice` returns `STATUS_NOT_SUPPORTED` until real wave/topology miniports exist.
- A bounded WaveRT stream contract maps `STOP / ACQUIRE / PAUSE / RUN` to the WDK `KSSTATE` values, validates buffer/block/notification geometry, tracks cyclic and monotonic linear byte positions, accumulates notification cadence, rejects advancement outside RUN and keeps overflow failures transactional.
- A named WDF control-device scaffold was also compile/CI verified with SYSTEM/Admin-only security and fail-closed IOCTL dispatch, but Microsoft KMDF miniport guidance explicitly states that miniport drivers using the PortCls-compatible miniport model cannot use framework control-device objects. That scaffold is therefore **experimental evidence only and is not the live-control-plane design**.
- PR #18 attempted to migrate the verified secure IOCTL runtime onto the WDF control-device factory, but it was closed **unmerged/superseded** after this Microsoft constraint was confirmed.
- The corrected next control-plane design is a **same-driver raw WDM control device** created with `IoCreateDeviceSecure`, using a unique device-class GUID and strict development SDDL. PortCls documentation explicitly permits an adapter driver to overwrite selected IRP dispatch entries and forward non-owned IRPs back through `PcDispatchIrp`.
- The raw WDM dispatcher must handle only the exact VSN control `PDEVICE_OBJECT`; every PortCls audio-device IRP must continue to `PcDispatchIrp` unchanged. The first WDM slice remains fail-closed and will not expose CONNECT until the existing secure WDFREQUEST/WDFFILEOBJECT semantics have been ported safely to IRP/PFILE_OBJECT semantics.
- The live `DriverEntry` still intentionally uses the previously verified normal-KMDF PnP control path; it has **not** yet been switched to PortCls.
- The development control interface remains restricted to LocalSystem and built-in Administrators; least-privilege non-admin runtime policy remains pending.
- Windows implementation contract is documented in `docs/architecture/WINDOWS-AUDIO-IMPLEMENTATION.md`.
- **A secure raw-WDM control-device implementation, live PortCls ownership, actual miniport/stream registration, an installed OS-visible microphone endpoint, calling-app route and controlled-hardware performance evidence are not yet claimed operational.**

**Latest verified green implementation CI:** AI Native Quality Gates run `34543962499` and Windows Audio Validation run `34543962515` both passed on implementation head `fe74aea5f359eff4a97a1ed258c0c2cbdd96248d`. The Windows run passed Rust compile/Clippy/tests, restored the pinned WDK packages, built and WDK-validated `vsn_virtual_mic_control.sys` with the fail-closed WDF control-device experiment linked in, and passed the existing native C++ virtual-mic contract suite. This implementation merged to `main` as `f084e4be4d7930830ca68948699c26e42fc036c1`. PR #18 was subsequently closed without merge after the live WDF-control-device direction was found incompatible with KMDF miniport restrictions. The preceding PortCls lifecycle/WaveRT stream-contract slice merged as `78ef04bf86bf02b25b9da25ef401dc84f73f0f2b`; descriptor scaffold as `da1b0543bcbfe63ff6a342690cab3b250057bbe2`; guarded ring consumer as `9c57207482bdc20ca5dc70a06cbb43c0cfa86741`; KMDF control-driver boundary as `b2761ad400d92c1d810751fabcf4b071a40dfb9c`; secure driver-owned CONNECT-v2 correction as `3953069f468c46d744f30625b3696e5b12f03a77`.

## README Reconciliation Rule — Mandatory

After every owner query/update related to this project, the acting AI must reconcile this README against repository reality before finishing.

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
| MOD-011 | Proprietary VSN AI Runtime & Model Registry | Datasets/evaluation, model registry, training, inference, versioning, rollout/rollback | Not started | — | `░░░░░░░░░░ 0%` | TBD — data/compute authorization required before training | 6–12+ weeks runtime foundation; model R&D may take months |
| MOD-012 | Voice Personalization, Identity Safety & Voice Security | Voice profiles, verification, deepfake/spoof detection, speaker-change/agent verification | Not started | — | `░░░░░░░░░░ 0%` | TBD | 4–7 weeks initial controls/security path |
| MOD-013 | Telephony & Contact Center Integrations | SIP/PSTN/contact-center media, dialers, inbound/outbound calls, agent-assist hooks | Not started | — | `░░░░░░░░░░ 0%` | TBD | 4–8 weeks initial providers |
| MOD-014 | SaaS Web App, Accounts, Teams & Workspace | Auth, organizations, team roles, meeting library, settings, notifications | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–8 weeks core |
| MOD-015 | Subscriptions, Entitlements & Usage Metering | Plans, trials, billing, quotas, minutes, entitlements, overages, cost ledger | Not started | — | `░░░░░░░░░░ 0%` | TBD | 3–5 weeks |
| MOD-016 | Admin, Analytics, Observability & Cost Control | Admin, provider health, latency, usage/cost, logs/metrics/traces, SLOs | Not started | — | `░░░░░░░░░░ 0%` | TBD | 3–5 weeks foundation; continuous |
| MOD-017 | Privacy, Security, Compliance & Data Governance | Threat model, consent, retention/deletion, encryption, residency, RBAC, audit | 2026-09-10 03:01 PKT | — | `░░░░░░░░░░ 0% — in progress` | TBD | PHASE-000 baseline complete; continuous implementation verification |
| MOD-018 | Quality, Performance, Release & Desktop Updates | Product QA, audio benchmarks, E2E, signing, installers, updates, rollback | Not started | — | `░░░░░░░░░░ 0%` | TBD | Cross-cutting; release baseline 4–6 weeks |
| MOD-019 | Public Developer API, SDKs & Webhooks | REST/realtime APIs, SDKs, API keys, webhooks, rate limits, docs, sandbox | Not started | — | `░░░░░░░░░░ 0%` | TBD — later milestone | 5–8 weeks after internal contracts stabilize |
| MOD-020 | Multi-Platform Clients & In-Person Capture | iOS, Android, browser/Chrome, in-person recording, voice notes, cross-device sync | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–9 weeks initial clients |
| MOD-021 | Business Integrations & Workflow Automation | Calendar/email/chat, CRM, docs/storage, work tools, Zapier/Make/n8n, MCP | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–10 weeks initial pack; continuous |
| MOD-022 | Conversation Intelligence, QA & Compliance Scoring | Scorecards, QA, compliance, objections, sentiment, talk metrics, sales signals | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–9 weeks initial B2B intelligence set |
| MOD-023 | Unified Conversation Knowledge & Cross-App Search | Cross-meeting/call/app semantic search, source-cited Q&A, timelines, briefs | Not started | — | `░░░░░░░░░░ 0%` | TBD | 5–9 weeks initial knowledge layer |
| MOD-024 | Agentic Actions, AI Skills & Voice Agents | Authorized actions, skills/agents, CRM/task/email/calendar writes, approvals/audit | Not started | — | `░░░░░░░░░░ 0%` | TBD | 6–10 weeks initial safe agentic layer |
| MOD-025 | Enterprise Administration, Device Fleet & Deployment Control | SSO/SCIM, org hierarchy, device fleet, remote policy, managed/staged deployment | Not started | — | `░░░░░░░░░░ 0%` | TBD | 6–10 weeks enterprise foundation |

**Machine work-unit state:** `3 / 25 complete`, `1 / 25 in progress`  
**Verified implementation progress:** `0 / 25 modules implemented`  
**Verified fully completed product modules:** `0 / 25` (MOD-001 is governance, not a user-facing product module)  
**Current lifecycle:** `DEVELOPMENT / PHASE-001 IN PROGRESS`  
**Current implementation:** `MOD-002 / WU-002 — Desktop Audio Core & Virtual Devices`  
**Development consent:** `APPROVED`  
**Technology stack:** `APPROVED`

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
- requestor PID + file-object ownership fencing for disconnect/status operations;
- bounded section/view/object cleanup on disconnect, owning file cleanup and device cleanup;
- development device interface restricted to LocalSystem and built-in Administrators;
- x64 KMDF Desktop-driver project with KMDF 1.21 and pinned Microsoft WDK/SDK NuGet `10.0.28000.2526`;
- guarded `ConsumeOneRingFrame` contract that uses immutable CONNECT-time geometry, normalizes overruns with exact drop accounting, emits fresh silence on underrun, checks the exact stable slot stamp before and after PCM copy, rejects concurrent slot reuse/torn frames, and publishes the consumer cursor only after a stable copy;
- the guarded consumer compiles/links inside the real WDK driver target and is exercised in user-mode C++ regression tests, including a deliberate slot-reuse race;
- PortCls/WaveRT descriptor scaffolding for one 48 kHz mono 32-bit IEEE-float capture stream, including bridge and host-capture pins, ADC node, minimal microphone topology and required WDK PortCls libraries;
- native WaveRT descriptor contract checks for sample rate, channels, sample width, block align, average byte rate, stream count and descriptor indices;
- compile/link-verified `PcInitializeAdapterDriver` / `PcAddAdapterDevice` lifecycle scaffold with fail-closed `StartDevice` until real miniports exist;
- WaveRT stream runtime contract with WDK-locked KS state mapping, adjacent transition enforcement, aligned buffer/notification geometry, cyclic/linear byte positions, notification accumulation, STOP reset and transactional overflow rejection;
- compile/link-verified WDF control-device experiment with SYSTEM/Admin-only SDDL and fail-closed IOCTL dispatch; this is retained as CI evidence only and is **not** an approved live miniport control path;
- latest AI Native run `34543962499` and Windows Audio Validation run `34543962515` green on implementation head `fe74aea5f359eff4a97a1ed258c0c2cbdd96248d`, merged as `f084e4be4d7930830ca68948699c26e42fc036c1`;
- PR #18 secure-WDF-control migration closed unmerged as superseded after Microsoft miniport-control-device restrictions were confirmed.

Not yet verified and therefore **not claimed complete**:

- confirmed physical-microphone `IAudioClient3` values and real unplug/replug, Bluetooth/headset, default-device, sleep/wake and audio-service recovery on controlled Windows hardware;
- raw WDM `IoCreateDeviceSecure` control-device creation/teardown with unique class GUID and strict development ACL;
- exact control-DO dispatch discrimination plus forwarding of every non-control IRP to `PcDispatchIrp`;
- WDM IRP/PFILE_OBJECT port of the existing secure CONNECT/DISCONNECT/QUERY_STATUS requestor PID/file/session ownership and driver-owned section lifecycle;
- PortCls-primary live `DriverEntry` using WDF miniport/no-dispatch-override mode for framework assistance without framework control-device objects;
- actual wave/topology miniport registration and an `IMiniportWaveRT` capture stream object using the verified descriptors/contracts;
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

- Development AI/Supervisor/Worker identity selection before privileged worker dispatch.
- Optional PM provider selection or explicit skip.
- Provider access/licensing/privacy/cost verification before each third-party provider is activated.
- Separate dataset/compute authorization before proprietary model training or material paid GPU spend.
- Region/customer-specific legal/retention review before production release.
- Product-specific test, signing, security and release evidence before deployment.
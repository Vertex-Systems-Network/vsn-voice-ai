# Voice AI — Hybrid Realtime Voice & Meeting Intelligence Platform

**Repository:** `Vertex-Systems-Network/voice-ai`  
**Operating protocol:** ANPOS `1.3.13`  
**Planning baseline:** 2026-09-10 01:16 PKT (UTC+05:00)  
**Development authorization:** `LOCKED — OWNER CONSENT REQUIRED`  
**Technology stack consent:** `PENDING — Approve Technology Stack required before implementation`  
**Canonical module count:** **19**

> This repository is being planned as a hybrid AI voice/meeting product. Planning, research and documentation updates are authorized. Product implementation, model training, infrastructure provisioning, paid API consumption, production credentials and deployment must not begin until the owner gives explicit consent.

## Current repository state

The actual repository is a child of the ANPOS template, but `config/protocol/instance.json` still contains inherited `instance_status: template_source`. Under ANPOS this means the repository is currently an **uninitialized child**. Child bootstrap must be reconciled before development execution; it is intentionally not being treated as complete in this planning-only update.

Repository/Git/test/release evidence remains canonical. A feature, provider, integration, model, test, workflow or release is never considered active merely because it appears in this README or another plan file.

## Product direction

Voice AI is intended to combine realtime communication enhancement with meeting intelligence:

- noise cancellation and background-voice suppression;
- realtime accent conversion with voice identity preservation;
- inbound/outbound accent handling where supported;
- realtime speech translation;
- live captions/transcription and diarization;
- meeting capture across major conferencing platforms;
- notes, summaries, decisions, action items, topics, highlights, Q&A/search and follow-up workflows;
- live AI assistant/communication coaching;
- telephony/contact-center integrations;
- team SaaS workspace, subscriptions, usage metering and admin analytics;
- public API/SDKs later;
- VSN-owned speech/audio models progressively replacing or complementing third-party providers.

The architecture is explicitly **hybrid**: external AI providers and VSN-owned models must implement normalized capability contracts behind one provider gateway, allowing routing, comparison, health checks, fallback and future replacement without rewriting product-domain logic.

## README reconciliation rule — mandatory

After **every owner query/update related to this project**, the acting AI must reconcile this README against repository reality before finishing the update.

At minimum it must:

1. Re-read the canonical modules from `config/ai/modules-bank.json`.
2. Keep **Canonical module count** synchronized with the actual module bank.
3. Reconcile every module row below.
4. Update actual **Start datetime** only when repository evidence shows work really started.
5. Update actual **End datetime** only when acceptance/verification evidence supports completion.
6. Update the **Progress** bar from verified work-unit evidence; never from optimistic chat claims.
7. Recalculate **Estimated completion datetime** when a real approved development start/schedule exists.
8. If the owner query changes only requirements/plan and no development has started, leave implementation progress at `0%` and timestamps unset.
9. If the owner query makes no material module change, still perform the reconciliation; do not fabricate a change merely to update the table.
10. Add/remove/re-scope modules in the canonical module bank first, then reflect the result here.

### Timestamp rule

Until an approved development start datetime exists, module start/end/ETA datetime fields remain **TBD / not started**. Planning durations are not presented as real calendar completion dates. Once the owner authorizes development and the start schedule is established, dependency-aware calendar ETAs must replace the TBD values.

## Total Modules Dashboard

Progress bar scale: `░░░░░░░░░░ 0%` → `██████████ 100%`.

| ID | Module name | Start datetime | End datetime | Progress | Estimated completion datetime | Planning duration after dependencies |
|---|---|---|---|---|---|---|
| MOD-001 | Project Governance, Bootstrap & Consent | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 1–2 weeks |
| MOD-002 | Desktop Audio Core & Virtual Devices | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 4–7 weeks |
| MOD-003 | Realtime Audio Enhancement | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 3–5 weeks |
| MOD-004 | Accent Conversion & Voice Preservation | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 5–10 weeks for integrated path; proprietary R&D separate |
| MOD-005 | Realtime Speech Translation | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 3–5 weeks for initial provider path |
| MOD-006 | Live Transcription, Captions & Diarization | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 3–5 weeks |
| MOD-007 | Meeting Capture & Platform Connectors | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 4–7 weeks initial platforms |
| MOD-008 | Meeting Intelligence & Knowledge | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 4–7 weeks initial feature set |
| MOD-009 | Live AI Assistant & Communication Coach | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 4–7 weeks |
| MOD-010 | Hybrid AI Provider Gateway & Orchestration | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 4–6 weeks foundation; then continuous adapters |
| MOD-011 | Proprietary VSN AI Runtime & Model Registry | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent + R&D/data plan not set | 6–12+ weeks runtime foundation; model R&D may take months |
| MOD-012 | Voice Personalization & Identity Safety | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 3–5 weeks initial controls |
| MOD-013 | Telephony & Contact Center Integrations | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 4–8 weeks initial providers |
| MOD-014 | SaaS Web App, Accounts, Teams & Workspace | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 5–8 weeks core; evolves with product |
| MOD-015 | Subscriptions, Entitlements & Usage Metering | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 3–5 weeks |
| MOD-016 | Admin, Analytics, Observability & Cost Control | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | 3–5 weeks foundation; continuous expansion |
| MOD-017 | Privacy, Security, Compliance & Data Governance | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | Cross-cutting; baseline 2–4 weeks then continuous |
| MOD-018 | Quality, Performance, Release & Desktop Updates | Not started | — | `░░░░░░░░░░ 0%` | TBD — owner consent/start not set | Cross-cutting; release baseline 4–6 weeks |
| MOD-019 | Public Developer API, SDKs & Webhooks | Not started | — | `░░░░░░░░░░ 0%` | TBD — later milestone | 5–8 weeks after internal contracts stabilize |

**Verified implementation progress:** `0 / 19 modules started`  
**Completed modules:** `0 / 19`  
**Current implementation phase:** `NONE — PLANNING ONLY`

## Hybrid provider model

Every capability should be addressed through a capability-oriented contract rather than vendor-specific business logic.

Example internal capability families:

- `audio.noise_cancel`
- `audio.background_voice_cancel`
- `audio.echo_reduce`
- `audio.vad`
- `voice.accent_convert`
- `voice.identity_preserve`
- `speech.translate_realtime`
- `speech.transcribe_stream`
- `speech.transcribe_finalize`
- `speech.synthesize`
- `meeting.capture`
- `meeting.transcript`
- `meeting.intelligence`
- `assistant.realtime`
- `telephony.media`

A provider adapter should declare at least:

- verified capability list;
- access type: public API, enterprise API, SDK, on-device SDK, on-prem SDK or unavailable;
- supported platforms/languages/accents;
- latency class and audio constraints;
- region/data-residency options;
- retention/privacy characteristics;
- pricing/metering model;
- quotas/rate limits;
- credential type;
- provider/model versions;
- health status;
- commercial/licensing verification status;
- implementation/contract-test status.

The routing layer may later choose by quality, latency, cost, region, privacy, device capability and tenant policy. Safe fallback/bypass is mandatory for realtime audio.

## Initial provider research — candidates, not completed integrations

| Provider | Relevant capability verified in current public documentation | Integration state |
|---|---|---|
| Krisp SDK | Noise cancellation, background voice cancellation, realtime accent conversion; device/server SDK paths | Candidate — access/licensing to verify |
| Sanas | Universal-source US Accent Translation, inbound/outbound Accent Translation, bidirectional Language Translation | Candidate/benchmark — programmatic/partner access must be verified |
| OpenAI | Realtime speech, realtime translation, realtime transcription and tool-capable voice models | Candidate |
| Deepgram | Realtime STT/TTS and Voice Agent API; provider composition options | Candidate |
| ElevenLabs | Speech-to-speech / voice transformation API | Candidate |
| Recall.ai | Meeting bots/desktop capture, realtime transcripts/audio/video/metadata and meeting-agent I/O across major platforms | Candidate |
| AssemblyAI | Realtime STT and current streaming speaker-diarization capabilities | Candidate |
| Azure AI Speech / Voice Live | Realtime voice and speech translation ecosystem | Candidate |
| Google Cloud Speech | Streaming speech-to-text | Candidate |
| AWS Transcribe / Polly | Streaming transcription and streaming speech synthesis | Candidate |
| Speechmatics | Realtime/batch STT, TTS and voice-agent APIs with multiple deployment models | Candidate |
| VSN AI | Proprietary models using the same internal contracts | Required internal provider; no models trained yet |

New providers should be added when current research verifies relevant API/SDK access. Provider existence alone must never be represented as an active integration.

## Planned phases

### Phase 0 — Initialization + Architecture Gates

Reconcile child bootstrap, project governance, provider-access research, system design, threat/data baseline and technology alternatives. Ends only after the required technology consent gate is satisfied.

### Phase 1 — Realtime Audio Commercial Core

Desktop/virtual audio, noise/background-voice cleanup, provider gateway, initial accent path, safe bypass, basic account shell and telemetry.

### Phase 2 — Translation + Transcription

Realtime language translation, live captions, diarization and final transcript reconciliation.

### Phase 3 — Meeting Intelligence

Meeting capture/connectors, notes, summaries, action items, decisions, topics, Q&A/search, exports and meeting workspace.

### Phase 4 — Commercial SaaS / Teams

Subscriptions, entitlements, usage/cost metering, team administration, provider/operations dashboards and enterprise policy foundations.

### Phase 5 — Live Assistant + Telephony

Communication coach, meeting agent capabilities, contact-center/telephony and broader integrations.

### Phase 6 — Proprietary VSN AI Expansion

Dataset/evaluation infrastructure, proprietary noise/BVC and/or accent models, on-device/server optimization and shadow evaluation against external providers before production routing.

### Phase 7 — Developer Platform

Public APIs, webhooks, SDKs and developer portal after internal contracts become stable.

Full details live in `docs/ai/PRE-PLAN.md`, with canonical module definitions in `config/ai/modules-bank.json` and architecture choices in `config/ai/options-bank.json`.

## Development consent boundary

Current state:

`LOCKED — OWNER CONSENT REQUIRED`

Before product implementation begins, ANPOS child initialization must be reconciled and the lifecycle must proceed through system design and the mandatory technology-selection consent gate. A later explicit owner authorization to start development does not permit the system to fabricate provider access, secrets, tests, deployments or completion.

## Key planning and governance files

- `PROJECT-IDEA.md` — normalized project intake, assumptions, constraints and research references.
- `docs/ai/PRE-PLAN.md` — living product/architecture pre-plan.
- `config/ai/options-bank.json` — selected/candidate architecture/product options.
- `config/ai/modules-bank.json` — canonical 19-module product decomposition.
- `AGENTS.md` — ANPOS universal agent router.
- `START-HERE.md` — discovery/research/planning flow.
- `PROJECT-INITIALIZATION.md` — child initialization rules.
- `DEVELOPMENT-LIFECYCLE.md` — system design through release/operations lifecycle and technology consent.
- `CONTROL-PLANE-SECURITY.md` — privileged AI/runtime security rules.
- `CODE-QUALITY.md` / `PRODUCTION-ASSURANCE.md` — quality and production evidence requirements.

## Scope boundary with ANPOS

ANPOS itself remains a development/operational governance protocol and does not need commercial-selling services. The **Voice AI application**, however, is intentionally planned to include its own subscription, entitlement and usage-metering product module because the business goal is to sell access to Voice AI capabilities online.

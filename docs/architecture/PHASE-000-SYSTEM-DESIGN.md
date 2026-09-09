# PHASE-000 — System Design & Approved Technology Stack

**Project:** VSN Voice AI  
**Repository:** `Vertex-Systems-Network/vsn-voice-ai`  
**Owner development consent:** `CONSENT-000001` — approved 2026-09-10 02:25 PKT  
**Technology stack approval:** `CONSENT-000002` — **APPROVED 2026-09-10 03:01 PKT**

## 1. System objective

Build a hybrid realtime Voice AI + meeting-intelligence platform that can use verified third-party AI APIs/SDKs and VSN-owned models through the same capability contracts.

Primary product outcomes:

- realtime noise cancellation and background-voice suppression;
- echo/de-reverberation, VAD and audio quality handling;
- accent conversion with speaker/voice preservation;
- realtime speech translation;
- live transcription, captions and diarization;
- meeting/call capture;
- notes, summaries, decisions, action items, highlights and Q&A;
- live communication coaching;
- conversation intelligence, QA and compliance workflows;
- unified knowledge/search across connected work systems;
- authorized AI actions/skills/voice agents;
- telephony/contact-center support;
- SaaS accounts, teams, billing and enterprise administration;
- public developer APIs/SDKs later;
- VSN-owned AI models progressively complementing or replacing third-party providers.

## 2. Architectural rules

1. **Hybrid by design.** Product-domain features do not hard-code themselves to one AI vendor.
2. **Capability contracts first.** Providers implement normalized capabilities such as `audio.noise_cancel`, `voice.accent_convert`, `speech.translate_realtime`, `speech.transcribe_stream`, `meeting.capture`, `meeting.intelligence` and `agent.action`.
3. **Realtime audio fails safely.** Provider failure must degrade to bypass/fallback rather than dropping the live call.
4. **Local-first where latency/privacy benefit.** Noise/VAD/background-voice suppression and eligible future VSN models should prefer on-device execution when feasible.
5. **Cloud where capability breadth requires it.** Translation, broad STT, meeting bots and provider-only services may run through cloud realtime sessions.
6. **Routing is policy-driven.** Capability, quality, latency, privacy, residency, cost, quota, health and tenant policy all participate.
7. **No invented integration.** A provider is not active until API/SDK access, commercial terms, privacy/retention, region, quotas/cost and contract tests are verified.
8. **Voice identity is sensitive.** Speaker embeddings, profiles and verification/deepfake signals are restricted data.
9. **Meeting artifacts are versioned.** Live transcript/notes may be provisional and finalized later.
10. **Agentic writes are authorization-bound.** CRM/email/calendar/task writes require scopes, approval rules, idempotency and audit evidence.

## 3. Logical architecture

```text
Desktop / Browser / Mobile / Meeting Bot / Telephony
                |
                v
      Realtime Session Boundary
                |
     +----------+-----------+
     |                      |
     v                      v
Local Audio Plane      Cloud Media Plane
Rust/native runtime    Go/WebRTC gateway
     |                      |
     +----------+-----------+
                v
      Hybrid Provider Gateway
                |
   +------------+-----------------------------+
   |            |          |          |       |
External AI   External AI  ...      VSN AI  Safe bypass
providers     meeting APIs          runtime
                |
                v
       Normalized Events/Artifacts
                |
       Control/API & Workspace Layer
                |
   PostgreSQL / Redis / Object Storage
                |
       Web App / Admin / Enterprise
```

## 4. Realtime desktop audio path

```text
Physical Microphone
      ↓
Native Audio Capture
      ↓
Level / VAD / Quality State
      ↓
Noise + Background Voice + Echo/Reverb Processing
      ↓
Accent Conversion + Voice Preservation (optional)
      ↓
Speech Translation (optional)
      ↓
Virtual Microphone
      ↓
Zoom / Teams / Meet / Browser / Dialer / Other Apps
```

Realtime requirements:

- stable internal audio-frame contract;
- explicit sample rate, channels and frame duration;
- processing off the UI thread;
- stage-by-stage latency accounting;
- timeouts, circuit breakers and bypass;
- predictable hotplug/sleep/wake/crash recovery;
- analytics/meeting AI failures must not interrupt call audio.

## 5. Meeting intelligence path

```text
Meeting / Call Audio + Metadata
            ↓
Capture Adapter
            ↓
Streaming Transcript + Speaker Events
            ↓
Live Intelligence
            ↓
Persistent Conversation Record
            ↓
Final Transcript Reconciliation
            ↓
Notes / Summary / Decisions / Actions / Topics / Highlights
            ↓
Search / Knowledge / CRM / Workflow Automation
```

All live/finalized artifacts carry version/provenance metadata and tenant authorization context.

## 6. Hybrid provider gateway

Provider manifests must track:

- provider/model/SDK version;
- verified capabilities;
- API/SDK/on-device/on-prem access type;
- audio input/output constraints;
- supported languages/accents/platforms;
- latency class;
- region/residency;
- retention/privacy;
- pricing/metering unit;
- quotas/rate limits;
- credential type;
- health;
- commercial/licensing verification;
- adapter contract-test status.

Routing modes:

- `auto`
- `lowest_latency`
- `best_quality`
- `best_privacy`
- `lowest_cost`
- tenant-enforced policy

## 7. Approved technology stack

### Web / SaaS
- TypeScript
- React
- Next.js App Router
- Tailwind CSS
- shadcn/ui

### Control API / business backend
- Node.js
- TypeScript
- NestJS
- Fastify adapter where appropriate
- REST as primary control/public API; WebSocket/SSE only where useful

### Desktop
- Tauri 2
- React/TypeScript UI
- Rust for desktop runtime, audio buffers, concurrency, device state and local-inference orchestration
- C++ for Windows virtual-audio/platform components where required
- macOS native components later using Swift / Objective-C++ / C++ as required by the selected audio approach

### Realtime cloud media
- Go
- WebRTC
- Pion WebRTC as the initial Go implementation candidate, subject to benchmark verification
- WebSocket/gRPC for providers that require them

### AI research/training
- Python
- PyTorch
- torchaudio

### Production inference
- ONNX Runtime where model compatibility permits
- platform execution providers selected by measured support/performance (CPU, CUDA/TensorRT, OpenVINO, DirectML, CoreML, QNN where applicable)
- production desktop runtime remains native rather than bundling a large Python runtime

### Data
- PostgreSQL
- pgvector initially for semantic retrieval
- Redis for rate limits, short-lived state, routing health, queues/cache where appropriate
- S3-compatible encrypted object storage for recordings/clips/model artifacts/exports where policy permits

### Background work
- Redis-backed jobs initially for bounded async tasks
- introduce a durable workflow engine only when measured long-running/reliability requirements justify the complexity

### Infrastructure
- Docker
- Terraform
- AWS as initial cloud candidate
- GPU services isolated and cost-metered separately from general SaaS services

### Observability
- OpenTelemetry
- Sentry
- Prometheus/Grafana-compatible metrics
- no raw audio/transcript/secrets in logs by default

### CI/CD
- GitHub Actions
- stack-specific lint/type/test/build/security checks added with implementation
- signing, installer/update and rollback verification required before desktop distribution

## 8. Approved repository product layout

```text
apps/
  web/
  desktop/
services/
  api/
  realtime-gateway/
  workers/
packages/
  contracts/
  provider-sdk/
  ui/
native/
  audio-core/
  windows-audio/
  macos-audio/
ai/
  research/
  models/
  evaluation/
infra/
  terraform/
  containers/
docs/
  architecture/
  providers/
  security/
```

Large datasets, provider secrets and production model binaries must not be committed to Git.

## 9. Initial versioned contracts

1. `AudioFrame`
2. `RealtimeSession`
3. `ProviderManifest`
4. `ProviderCapability`
5. `ProviderRoutingDecision`
6. `ProviderHealthEvent`
7. `TranscriptSegment`
8. `SpeakerEvent`
9. `MeetingLifecycleEvent`
10. `MeetingArtifact`
11. `UsageEvent`
12. `ConsentEvent`
13. `AgentActionRequest`
14. `AuditEvent`

## 10. Security and data baseline

Canonical structured baselines:

- `config/security/threat-model.json`
- `config/data/data-governance.json`

They cover raw audio, recordings, transcripts, voice biometrics, provider credentials, tenant identity, connected-app data, billing/usage, audit/security events and VSN model datasets/artifacts.

Default direction:

- minimize raw audio retention;
- recording retention is explicit/configurable;
- encrypt sensitive stored data;
- secrets live in managed secret/OS-secure storage;
- use ephemeral credentials where available;
- propagate deletion into derived artifacts/indexes where technically supported;
- no customer-content model training by default;
- tenant permissions propagate into knowledge/search/agentic access;
- legal/regulatory applicability is evaluated by deployment jurisdiction/use case before production release.

## 11. Technology decision record

Alternatives considered included Electron vs Tauri, all-TypeScript backend vs split TypeScript+Go, Python production inference vs ONNX/native, dedicated vector/search cluster vs PostgreSQL+pgvector first, and direct vendor integrations vs a mandatory provider gateway.

The owner approved the recommended split architecture via **CONSENT-000002** on **2026-09-10 03:01 PKT**.

This approval authorizes implementation using the stack above. It does **not** automatically authorize paid provider consumption, proprietary model training on datasets, production credentials/cloud spend or deployment; those remain subject to their applicable provider/data/compute/release gates.

## 12. Reference documentation

- Next.js: https://nextjs.org/docs
- NestJS: https://docs.nestjs.com/
- Tauri 2: https://tauri.app/
- ONNX Runtime: https://onnxruntime.ai/docs/
- WebRTC: https://webrtc.org/getting-started/
- Rust: https://rust-lang.org/tools/install/

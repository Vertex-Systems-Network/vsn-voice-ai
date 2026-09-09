# PHASE-000 — System Design & Technology Recommendation

**Project:** VSN Voice AI  
**Repository:** `Vertex-Systems-Network/vsn-voice-ai`  
**Owner development consent:** `CONSENT-000001` — approved 2026-09-10 02:25 PKT  
**Technology approval:** **PENDING — product feature implementation must not begin until the owner explicitly approves the technology stack.**

## 1. System objective

Build a hybrid realtime Voice AI + meeting intelligence platform that can use verified third-party AI APIs/SDKs and VSN-owned models through the same capability contracts.

Initial product outcomes remain:

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
- SaaS accounts, teams, billing, enterprise administration and later developer APIs;
- VSN-owned AI models progressively complementing/replacing third-party providers.

## 2. Architectural rules

1. **Hybrid by design.** No product-domain feature may hard-code itself to one AI vendor.
2. **Capability contracts first.** Providers implement normalized contracts such as `audio.noise_cancel`, `voice.accent_convert`, `speech.translate_realtime`, `speech.transcribe_stream`, `meeting.capture`, `meeting.intelligence` and `agent.action`.
3. **Realtime audio must fail safely.** If an AI path fails, the user's base call audio must bypass safely instead of dropping the conversation.
4. **Local-first for latency-sensitive audio where feasible.** Noise/VAD/background-voice suppression and eligible future VSN accent models should prefer on-device execution when quality, hardware support and licensing permit it.
5. **Cloud where capability breadth requires it.** Translation, broad transcription, meeting bots and provider-only services may use cloud realtime sessions.
6. **Provider policy is explicit.** Routing considers capability, quality, latency, privacy, residency, cost, quota, health and tenant policy.
7. **No provider activation without verified access.** Marketing pages or benchmarks do not count as integration evidence.
8. **Voice identity is sensitive data.** Speaker embeddings, personalization and voice-security artifacts require consent, encryption, retention and deletion controls.
9. **Meeting artifacts are versioned.** Live notes/transcripts are provisional; finalization may correct words, speakers, summaries and actions.
10. **Actions are authorization-bound.** Agentic writes to CRM/email/calendar/tasks require scopes, approval policy, idempotency and audit evidence.

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
Rust/native runtime    Go/WebRTC media gateway
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

Requirements:

- audio frames use a stable internal format with explicit sample rate/channel/frame duration;
- realtime processing runs off the UI thread;
- every stage declares latency contribution;
- provider/cloud stages have timeout and bypass policies;
- device unplug/sleep/wake/crash must recover predictably;
- call audio continues even when analytics/notes services are unavailable.

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
Final Notes / Summary / Decisions / Actions / Topics / Highlights
            ↓
Search / Knowledge / CRM / Workflow Automation
```

Live and finalized artifacts must carry source references and version metadata.

## 6. Hybrid provider gateway

Every provider adapter must implement a common provider manifest:

- provider ID and model/SDK version;
- verified capability IDs;
- access type: API / SDK / on-device / on-prem / unavailable;
- input/output audio constraints;
- languages/accents/platforms;
- expected latency class;
- supported regions and residency;
- data retention/privacy notes;
- pricing/metering unit;
- quotas/rate limits;
- credential type;
- health state;
- commercial/licensing verification state;
- adapter contract-test state.

Routing modes planned:

- `auto`;
- `lowest_latency`;
- `best_quality`;
- `best_privacy`;
- `lowest_cost`;
- tenant-enforced policy.

Realtime routing must support circuit breakers and safe bypass. Asynchronous meeting intelligence may retry/fail over without affecting the live call.

## 7. Recommended technology stack — pending owner approval

### Web / SaaS

- **TypeScript**
- **React + Next.js App Router**
- Tailwind CSS + shadcn/ui for application UI primitives

Rationale: strong ecosystem, shared TypeScript contracts, high development velocity and mature application routing/rendering.

### Control API / business backend

- **Node.js + TypeScript + NestJS**
- **Fastify adapter** for HTTP performance where appropriate
- REST for public/control surfaces; WebSocket/SSE only where the workflow benefits

Responsibilities: auth, organizations, provider policy, meeting metadata, billing, integrations, admin, audit and developer API control plane.

### Desktop application

- **Tauri 2 + React/TypeScript UI**
- **Rust** for desktop runtime, audio buffers, concurrency, device state and local inference orchestration
- Windows native audio/virtual-device pieces in **C++** where driver/platform APIs require it
- macOS native pieces later through **Swift / Objective-C++ / C++** as required by the selected audio-driver approach

### Realtime cloud media plane

- **Go** for high-concurrency session/media services
- **WebRTC** for realtime browser/media paths
- Pion WebRTC is the recommended Go implementation candidate after technology approval and benchmark validation
- WebSocket/gRPC may be used for providers that do not expose WebRTC

### AI research and training

- **Python**
- **PyTorch + torchaudio**
- evaluation notebooks/tools kept out of production desktop runtime

### Production model inference

- **ONNX Runtime** as the primary portable inference layer where model compatibility permits
- hardware execution providers selected per platform: CPU plus CUDA/TensorRT/OpenVINO/DirectML/CoreML/QNN where appropriate and verified
- native runtime called from Rust/C++ rather than shipping a large Python runtime in the desktop client

### Data

- **PostgreSQL** as canonical transactional database
- **pgvector** initially for semantic retrieval where sufficient
- **Redis** for rate limiting, sessions, short-lived state, routing health and queue/cache use cases
- **S3-compatible object storage** for recordings, clips, model artifacts and exports where retention policy permits
- dedicated search infrastructure may be added only when PostgreSQL/pgvector no longer meets measured scale/latency needs

### Background workflows

- Start with Redis-backed jobs for bounded asynchronous tasks
- introduce a durable workflow engine only if measured reliability/long-running orchestration needs justify the added operational complexity

### Billing

- Stripe-style external payment provider architecture; raw card data must not be stored by VSN services
- provider abstraction may be added later if business requirements demand multiple billing processors

### Infrastructure

- Docker containers for cloud services
- Terraform for infrastructure-as-code
- AWS is the initial recommended cloud candidate, but provider-specific infrastructure remains behind an approval gate
- GPU workloads are isolated from general SaaS services and must be cost-metered

### Observability

- OpenTelemetry for traces/metrics correlation
- Sentry for application/runtime exception visibility
- Prometheus/Grafana-compatible metrics stack for realtime latency, jitter, provider health and cost telemetry
- sensitive audio/transcript content excluded or redacted from logs by default

### CI/CD

- GitHub Actions remains the repository CI control plane
- stack-specific lint/type/test/build/security jobs are added only after stack approval
- desktop signing, installer/update and model-artifact signing become required release gates before distribution

## 8. Recommended repository product layout after stack approval

```text
apps/
  web/                 # Next.js SaaS/app
  desktop/             # Tauri UI shell
services/
  api/                 # NestJS control/business API
  realtime-gateway/    # Go WebRTC/media gateway
  workers/             # asynchronous meeting/provider jobs
packages/
  contracts/           # shared schemas, IDs, generated clients
  provider-sdk/        # normalized provider adapter interfaces
  ui/                  # shared web UI package where useful
native/
  audio-core/          # Rust audio/inference runtime
  windows-audio/       # C++/Windows virtual device integration
  macos-audio/         # later native macOS integration
ai/
  research/            # Python research/evaluation
  models/              # manifests only; large model artifacts external
  evaluation/          # benchmark definitions/corpora metadata
infra/
  terraform/
  containers/
docs/
  architecture/
  providers/
  security/
```

Large datasets, provider secrets and production model binaries must not be committed to Git.

## 9. Initial service contracts

The first architecture contracts to stabilize after stack approval:

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

Schema compatibility must be versioned from the beginning.

## 10. Data/trust boundaries to model in PHASE-000

Sensitive categories:

- raw microphone/call audio;
- recordings and clips;
- transcript content;
- participant identity and meeting metadata;
- speaker embeddings/voice profiles;
- provider credentials and OAuth tokens;
- organization/member/account data;
- billing and usage records;
- CRM/email/calendar/document data;
- proprietary VSN datasets/model artifacts.

Trust boundaries:

1. user device ↔ VSN cloud;
2. VSN cloud ↔ external AI provider;
3. VSN cloud ↔ meeting/CRM/work provider;
4. browser/web app ↔ VSN API;
5. tenant A ↔ tenant B;
6. general cloud services ↔ GPU/model services;
7. development/test ↔ production;
8. local model package ↔ signed VSN update channel.

Default policy direction:

- minimize raw audio retention;
- make recording retention explicit/configurable;
- encrypt sensitive stored data;
- keep provider secrets in a managed secret store;
- use ephemeral tokens where providers support them;
- maintain deletion propagation across derived artifacts;
- no training on customer content without explicit approved policy/rights;
- tenant permissions must propagate into search/knowledge results.

## 11. Technology alternatives considered

### Desktop: Electron vs Tauri 2

**Recommendation: Tauri 2.** Electron has a larger Node/browser ecosystem, but Tauri better fits a Rust-native audio core and smaller desktop shell. Native audio/driver work remains separate either way.

### Backend: all-TypeScript vs split TypeScript + Go

**Recommendation: split plane.** Keep business/control logic in NestJS/TypeScript and realtime media/session services in Go. This isolates latency-sensitive infrastructure from the SaaS control plane.

### AI deployment: Python runtime vs ONNX/native

**Recommendation: Python for research; ONNX/native for production inference.** This supports device portability, hardware execution providers and lower runtime overhead.

### Search: dedicated vector/search cluster vs PostgreSQL first

**Recommendation: PostgreSQL + pgvector first.** Add a dedicated search system only after measured product scale requires it.

### Provider integration: direct vendor calls in features vs gateway

**Recommendation: gateway mandatory.** Direct vendor coupling conflicts with the owner-selected hybrid strategy.

## 12. Technology approval request

Before Voice AI product feature code begins, the owner must explicitly approve or modify this recommended stack:

- Next.js + TypeScript for web;
- NestJS + Fastify for control API;
- Tauri 2 + Rust for desktop;
- C++ for Windows virtual-audio/platform components where required;
- Go + WebRTC for realtime cloud media;
- Python + PyTorch for AI R&D;
- ONNX Runtime for portable production inference where compatible;
- PostgreSQL + pgvector + Redis + S3-compatible storage;
- Docker + Terraform + AWS as initial cloud candidate;
- OpenTelemetry/Sentry/Grafana-compatible observability;
- GitHub Actions for CI/CD.

Until that approval is recorded, this document is architecture/design work only and does not authorize product feature implementation, paid provider usage, proprietary model training or production deployment.

## 13. Current official technology references checked during PHASE-000

- Next.js official documentation: https://nextjs.org/docs
- NestJS official documentation: https://docs.nestjs.com/
- Tauri 2 official documentation: https://tauri.app/
- ONNX Runtime official documentation: https://onnxruntime.ai/docs/
- WebRTC official documentation: https://webrtc.org/getting-started/
- Rust official installation/toolchain documentation: https://rust-lang.org/tools/install/

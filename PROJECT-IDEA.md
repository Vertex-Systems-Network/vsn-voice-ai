# Project Idea — VSN Voice AI

> Persistent owner-intake record. Repository-readiness/planning updates are authorized. Voice AI product implementation remains locked until separate explicit owner consent and the required technology-stack approval.

## Intake Status

`CAPTURED — INITIAL PLAN CONFIRMED — PRODUCT IMPLEMENTATION LOCKED`

## Original Owner Plan

The original requirement was to build a subscription-based AI voice and meeting platform inspired by products such as Krisp and Sanas, while using a **hybrid AI model** rather than depending on a single provider.

The core owner instruction is preserved as follows:

- integrate every relevant AI/API/SDK provider that actually exposes usable, approved programmatic access;
- provide a provider-neutral architecture so providers can be added, compared, routed, failed over or replaced;
- add VSN's own AI models/runtime as first-class providers in the same architecture;
- make the product usable for realtime calls/meetings with noise cancellation, background voice removal, accent conversion, voice preservation and related realtime audio options;
- include realtime language translation where technically suitable;
- include meeting/call capabilities such as transcription, captions, diarization, notes, summaries, decisions, action items and as many useful meeting-intelligence capabilities as are feasible;
- progressively expand into meeting capture, coaching, conversation intelligence, integrations, cross-app knowledge, agentic actions, telephony/contact-center, multi-platform clients, enterprise administration and developer APIs;
- do not claim an integration exists until API/SDK access and implementation are verified;
- do not start Voice AI product development until the owner explicitly authorizes it.

## Normalized Product Direction

### Hybrid Provider Architecture

1. Every major AI capability is addressed through an internal capability contract.
2. Third-party APIs/SDKs implement those contracts through provider adapters.
3. VSN-owned models implement the same contracts as first-class providers.
4. The routing layer may choose providers using verified capability, health, latency, quality, privacy, region, cost and tenant policy.
5. Realtime audio must have safe bypass/fallback so an AI/provider failure does not unnecessarily break the call.
6. Provider existence or marketing claims do not equal integration status; activation requires real access plus contract tests.

### Realtime Voice / Audio

Planned capabilities include:

- microphone/speaker capture;
- virtual microphone/audio routing;
- noise cancellation;
- background voice cancellation;
- echo reduction/de-reverberation;
- VAD and level handling;
- accent conversion;
- inbound/outbound accent handling where supported;
- voice identity preservation;
- accent-strength controls;
- realtime speech translation;
- translated captions;
- voice personalization and identity safety;
- deepfake/synthetic speech and speaker verification controls where justified.

Initial proprietary accent research candidate remains Pakistan/India/Middle-East English → US English, subject to dataset, technology and compute approval. This does not block an earlier third-party provider path.

### Meetings / Calls

Planned capabilities include:

- Zoom, Microsoft Teams, Google Meet, Webex and other supported surfaces;
- bot, botless/native and desktop capture strategies where appropriate;
- live/final transcription and captions;
- speaker diarization;
- meeting notes and summaries;
- key points and chapters/topics;
- decisions and action items;
- owners/due dates;
- highlights and clips;
- meeting Q&A;
- follow-up drafts;
- collaboration/tags/folders;
- live communication coaching;
- call/meeting QA and compliance scoring;
- sentiment/talk/silence/interruption and sales/support signals;
- unified search across conversations and connected work systems;
- authorized AI skills/actions/agents.

### Platforms / Integrations / Commercial Product

Planned expansion includes:

- Windows desktop and later other desktop platforms according to approved stack;
- iOS, Android, browser/Chrome and in-person capture;
- calendar, email, Slack/Teams, CRM, documents/storage and project/work-management integrations;
- Salesforce, HubSpot, Pipedrive and other verified CRM paths;
- Zapier/Make/n8n/MCP-style automation where appropriate;
- SIP/PSTN/contact-center integrations;
- user accounts, organizations, teams and roles;
- subscriptions, usage metering, quotas and entitlements;
- admin/provider cost/quality/latency observability;
- enterprise SSO/SCIM, device fleet/policy and managed deployment;
- REST/realtime APIs, SDKs and webhooks after internal contracts stabilize.

## Current Repository Reality

- Repository: `Vertex-Systems-Network/vsn-voice-ai`.
- Source template: `Vertex-Systems-Network/ai-native-project-operating-system`.
- ANPOS protocol: `1.3.13`.
- Child identity is initialized and reports `instance_status: active_project`.
- Canonical module bank: **25 modules**.
- Machine-readable execution plan: **10 phases / 25 Level-1 work units**.
- Active baseline quality workflow is installed.
- Latest verified baseline CI evidence includes successful GitHub Actions repository-integrity run `34405876582`.
- Obsolete commercial/selling validator references and stale commercial-service deployment tests have been removed/replaced.
- Module dependency graph has been corrected to remove the identified circular/incorrect dependencies.
- Current Voice AI product implementation progress remains **0 / 25 modules started**.
- Development AI pool is not selected yet.
- Technology stack is not approved yet.
- No third-party provider is considered integrated yet.
- No VSN proprietary speech model has been trained yet.

## Validated Requirements

- Commercial subscription AI voice + meeting SaaS.
- Hybrid external-provider + VSN-owned-model architecture.
- Provider-neutral adapters and routing/fallback.
- Integrate relevant providers that expose usable approved API/SDK access.
- Realtime audio enhancement/noise/background-voice handling.
- Accent conversion with voice preservation.
- Realtime/bidirectional language translation where feasible.
- Live transcription/captions/diarization.
- Meeting capture and meeting intelligence.
- Live assistant/coaching.
- Telephony/contact-center support.
- Conversation QA/compliance intelligence.
- Cross-app knowledge/search.
- Agentic actions/skills/voice agents with authorization controls.
- Mobile/browser/in-person capture.
- Business/CRM/workflow integrations.
- Team SaaS, usage metering, enterprise controls and later public developer platform.
- README module dashboard reconciled after every material owner project update.
- No invented progress, timestamps, integrations, tests or releases.
- No Voice AI product implementation until explicit owner consent.

## Provider Research Catalog — Candidates Only

Initial research candidates include:

- Krisp SDK;
- Sanas where programmatic/partner access is available;
- OpenAI;
- Deepgram;
- ElevenLabs;
- Recall.ai;
- AssemblyAI;
- Azure AI Speech / Voice Live;
- Google Cloud Speech;
- AWS Transcribe / Polly;
- Speechmatics;
- VSN AI as the required internal provider family.

This list is intentionally extensible: if another relevant provider exposes a usable API/SDK, it should be evaluated and may be added to the provider catalog. Provider activation requires verified access, licensing/terms, regions, privacy/retention, quotas/cost and implementation tests.

## Remaining Decisions Before Product Implementation

- Development AI/Supervisor/Worker selection and identity verification.
- Optional PM provider selection or explicit skip.
- Project-specific Voice AI threat model and data classification.
- Final first-launch platform/geography order.
- Provider commercial/access matrix.
- Exact first accent/language launch set.
- On-device vs cloud split by capability/device.
- Technology alternatives and system design.
- Explicit `Approve Technology Stack` decision.
- Explicit owner authorization to start Voice AI product implementation.
- Separate approval for proprietary model datasets/compute/training.

## Primary Risks

- Conversational latency/jitter and native virtual-audio complexity.
- Accent naturalness and identity preservation.
- Translation quality/latency as a distinct problem from accent conversion.
- Noisy/overlapping/code-switched transcription and diarization.
- External provider pricing, outages, licensing and policy changes.
- Meeting/voice privacy, consent, residency and retention obligations.
- Voice security false positives/negatives.
- Over-scoping V1 before the realtime commercial core is reliable.

## Current Planning Status

`INITIAL PLAN CONFIRMED — REPOSITORY READINESS RECONCILED — PRODUCT IMPLEMENTATION LOCKED PENDING OWNER CONSENT + TECHNOLOGY APPROVAL`

# Project Idea

> This file is the repository's persistent intake record. The current owner has authorized planning/documentation updates only. Product implementation remains locked until explicit owner consent.

## Intake Status

`CAPTURED — PLANNING ONLY`

## Raw User Input

The product should be a subscription-based AI voice and meeting platform inspired by and intended to exceed the useful capabilities of products such as Krisp and Sanas.

The core concept is real-time voice processing during calls and meetings. A user may speak English with an Urdu/Pakistani or other non-native accent and the system should be able to convert the accent to a selected target accent such as US English while preserving the user's identity and natural delivery. The broader product should also support real-time speech translation where technically appropriate, noise cancellation, background voice removal, live transcription, meeting notes and as many useful meeting/call intelligence capabilities as are feasible.

The architecture must use a **hybrid AI model**:

1. Integrate relevant third-party AI APIs/SDKs when they are actually available, technically suitable, licensed and commercially usable.
2. Provide a provider-neutral adapter/orchestration layer so providers can be added, replaced, routed, compared and failed over without rewriting the product.
3. Add Vertex Systems Network's own AI models/runtime as first-class providers in the same architecture.
4. Allow the platform to progressively replace third-party dependencies with proprietary models where quality, latency, privacy or unit economics justify it.
5. Never claim an integration exists until API/SDK access and implementation are verified.

The product should cover real-time audio enhancement, accent conversion, voice preservation, speech translation, transcription/captions, meeting capture, notes, summaries, decisions, action items, search/Q&A, analytics, live assistance/coaching, integrations and related meeting features where feasible.

For project tracking, the repository README must contain a complete modules table and be reconciled after every owner query/update that changes project scope, requirements, priorities, architecture or verified progress. The table must include at minimum: module name, start datetime, end datetime, progress bar and estimated completion datetime. No timestamp or progress may be invented: modules remain not started until repository evidence shows execution actually began.

**Development must not start until the owner gives explicit consent.** Planning, research and documentation updates are currently authorized; implementation, model training, infrastructure provisioning, paid API consumption, production credentials and deployment are not.

## Normalized Understanding

### Explicit Requirements

- Build a commercial AI voice + meeting SaaS with desktop/realtime capabilities.
- Use a hybrid architecture combining third-party APIs/SDKs and proprietary VSN AI.
- Integrate relevant voice/speech/meeting AI providers through a provider-neutral adapter layer when access is actually available and permitted.
- Make VSN-owned models first-class providers rather than special-case code.
- Support real-time noise cancellation and related audio cleanup.
- Support real-time accent conversion with voice identity preservation.
- Support real-time/bidirectional language translation where feasible.
- Support live transcription/captions and speaker-aware meeting records.
- Support meeting notes, summaries, action items, decisions and further meeting intelligence.
- Support Zoom, Google Meet, Microsoft Teams and other practical meeting/call surfaces through native integrations, meeting APIs, desktop capture and/or virtual audio devices as appropriate.
- Include provider routing/fallback so one external provider is not a hard dependency.
- Track all canonical product modules in README.
- Reconcile the README module tracker after every project-changing owner query/update.
- Do not start implementation without explicit owner consent.

### Facts

- The current repository is `Vertex-Systems-Network/voice-ai`.
- The repository was copied from the ANPOS template and currently still reports `instance_status: template_source`; it is therefore an uninitialized child according to repository rules.
- The current repository contains governance/planning blueprints but no verified Voice AI product implementation.
- Current public documentation confirms APIs/SDKs exist across several relevant categories, including Krisp realtime audio/accent SDKs, OpenAI realtime audio/translation/transcription, Deepgram realtime voice/STT/TTS, Recall.ai meeting capture APIs, AssemblyAI realtime transcription, Azure realtime voice/speech translation, Google streaming STT, AWS streaming Transcribe/Polly, ElevenLabs speech-to-speech and Speechmatics speech APIs.
- Sanas publicly documents current Accent Translation and Language Translation product capabilities; programmatic/partner integration access must be verified before treating Sanas as an active provider adapter.

### Assumptions

- Initial commercial validation should prefer integrations and existing models where they shorten time-to-market without blocking proprietary model development.
- The Windows desktop app and virtual audio-device path will likely be a primary initial delivery surface; macOS should be designed as a first-class follow-on rather than an afterthought.
- Accent-only processing should target substantially lower latency than full speech-to-speech language translation.
- Meeting data may contain confidential or regulated information, so privacy, explicit recording/transcription disclosure, retention and provider data-boundary controls must be first-class requirements.
- Subscription/billing is a product requirement, distinct from commercial-selling components intentionally excluded from the reusable ANPOS protocol itself.

### Preferences

- AI-native development governed by this repository's ANPOS workflow.
- Hybrid build-vs-buy strategy rather than a pure third-party wrapper or pure research-first approach.
- Extensible capability-provider registry rather than hard-coded vendor integrations.
- Progressive migration toward proprietary VSN AI where it improves quality, control, privacy or cost.
- Broad meeting feature coverage without sacrificing realtime audio quality/latency.

### Constraints

- No implementation until explicit owner consent.
- Technology stack is not approved yet; Stage 9 `Approve Technology Stack` remains mandatory before implementation-specific architecture/code.
- Current child bootstrap is not complete and must be reconciled before development execution.
- External provider availability, commercial terms, region availability, quotas and data policies must be verified before activation.
- Progress, start/end timestamps, completion and integration status must be evidence-based.

### Existing Research / Search / References

- Krisp AI Voice SDK / Accent Conversion: https://sdk-docs.krisp.ai/docs/accent-conversion
- Krisp SDK API capabilities: https://sdk-docs.krisp.ai/docs/api-reference
- Sanas Accent Translation model documentation: https://help.sanas.ai/portalv3/docs/ai-models-accent-translation
- Sanas Language Translation: https://help.sanas.ai/docs/language-translation
- OpenAI realtime voice models/API: https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/
- Deepgram Voice Agent API: https://developers.deepgram.com/docs/voice-agent
- ElevenLabs speech-to-speech API: https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
- Recall.ai meeting/agent API: https://www.recall.ai/product/ai-agent-api
- AssemblyAI streaming speech: https://www.assemblyai.com/topic/streaming-speech-to-text
- Azure Voice Live / Speech: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to
- Google Cloud Speech-to-Text: https://docs.cloud.google.com/speech-to-text/docs
- AWS Transcribe streaming: https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_StartStreamTranscription.html
- Speechmatics developer APIs: https://docs.speechmatics.com/

### Open Questions

- Final brand/product name.
- Exact first-launch operating systems and geographic regions.
- Which third-party providers will approve commercial/embedded use and on what pricing/contract terms.
- Which meeting platforms require bot-based vs botless/native/desktop capture for launch.
- Final data-retention defaults and enterprise compliance targets beyond baseline privacy/security controls.
- Exact first proprietary model: recommended initial candidates are noise/BVC and Pakistan/India/Middle-East-to-US accent conversion, subject to research and dataset feasibility.
- Final subscription packaging/pricing and included realtime minutes.
- Technology stack approval remains pending.

### Risks / Unknowns

- Accent conversion quality and voice-identity preservation at conversational latency are the highest technical-risk product areas.
- Full language translation has materially different latency and quality constraints from accent conversion.
- Virtual audio drivers and multi-platform audio routing are complex and require deep native testing.
- Provider pricing can destroy gross margin unless routing, caching/on-device execution, minute metering and cost controls are built in.
- External provider policy/licensing changes can create dependency risk; adapter abstraction and proprietary fallback mitigate this.
- Meeting recording/transcription creates consent, privacy, residency, retention and enterprise-security obligations.
- Speaker diarization, overlap, code-switching and noisy multi-party meetings remain challenging edge cases.
- A feature-maximal first release could delay the core realtime audio experience; phased delivery is required.

## Research Status

`INITIAL MARKET/TECHNICAL RESEARCH CAPTURED — CONTINUOUS PROVIDER VERIFICATION REQUIRED`

## Planning Status

`DRAFT HYBRID PLAN CREATED — IMPLEMENTATION LOCKED PENDING OWNER CONSENT`

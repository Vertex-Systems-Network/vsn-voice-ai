# Market Competitive Module Audit — Voice AI

**Audit date:** 2026-09-10  
**Repository:** `Vertex-Systems-Network/vsn-voice-ai`  
**Authorization:** planning/research/documentation only; no development authorized  
**Current canonical module bank:** 19 modules  
**Recommended competitive target decomposition:** 25 modules, subject to canonical module-bank restructuring during planning

## Conclusion

The current 19 modules form a strong technical and SaaS foundation, but they should not be treated as the final competitive decomposition if the target is to compete across the combined 2026 feature surface of Krisp, Sanas, Otter, Fireflies, Read AI, Zoom Workplace/ZoomMate and adjacent meeting/conversation platforms.

The main issue is not raw module count. Several market-critical responsibilities are currently hidden inside broad modules or not explicit enough to receive independent architecture, acceptance criteria, QA, security and roadmap ownership.

## Current-market evidence considered

### Krisp

Current public product material shows a combined voice + meeting + contact-center surface including noise cancellation, background-voice handling, accent conversion, voice translation, transcription, meeting notes/action items, mobile/in-person capture, integrations/webhooks/MCP, Agent Assist, Speech Analytics and Voice Security. 2026 Call Center updates also include deepfake detection, agent voice verification, customer voice-change detection, compliance scoring and enterprise analytics.

Sources:
- https://krisp.ai/
- https://krisp.ai/pricing/
- https://krisp.ai/contact-center/
- https://whatsnew.krisp.ai/announcements/june-product-updates-call-center-ai
- https://whatsnew.krisp.ai/announcements/krisp-2-78-2-call-center-ai-updates

### Sanas

Current Sanas material shows inbound/outbound Accent Translation, Language Translation, inbound/outbound noise handling, voice isolation, acoustic echo cancellation, on-device/remote inference choices and enterprise/admin configuration controls.

Sources:
- https://help.sanas.ai/docs/june-2026
- https://help.sanas.ai/docs/managing-product-settings-per-team

### Meeting/conversation intelligence leaders

Otter, Fireflies and Read AI demonstrate that competitive meeting products have moved beyond transcription/summaries into bot and bot-free capture, desktop/browser/mobile surfaces, automatic action execution, CRM synchronization, cross-app knowledge search, coaching, analytics and specialist/agentic workflows. Fireflies currently presents AI Skills, live assist, voice agents, MCP and broad integrations. Read AI searches meeting content together with email, calendar, chat, cloud storage, documentation and CRM sources. Otter combines bot, bot-free desktop/Chrome and mobile capture with meeting agents and CRM actions.

Sources:
- https://otter.ai/
- https://fireflies.ai/
- https://www.read.ai/meeting-reports
- https://support.read.ai/hc/en-us/articles/39009378777875-Using-Ask-Read-to-search-your-meetings-and-connected-apps

### Platform-native agentic competition

Zoom's 2026 product direction extends meeting summaries/transcription toward agentic work completion through ZoomMate. This means a competitive roadmap should separate passive assistance from authorized action execution.

Source:
- https://www.zoom.com/en/blog/zoom-ai-companion-zoommate/

## Recommended new top-level modules

### MOD-020 — Multi-Platform Clients & In-Person Capture

Objective: own the user experience beyond the desktop virtual-audio app.

Scope candidates:
- iOS application
- Android application
- Chrome/browser extension
- browser capture where technically permitted
- in-person meeting recorder
- mobile voice notes
- mobile upload/import
- mobile meeting library
- bot dispatch/control from mobile
- background upload/sync
- cross-device session continuity

Reason for separate module: mobile/browser/in-person capture has its own platform permissions, audio APIs, lifecycle, background execution, QA matrix and release channels.

### MOD-021 — Business Integrations & Workflow Automation

Objective: connect conversation outcomes to the customer's actual work systems.

Scope candidates:
- Google Calendar / Microsoft Outlook Calendar
- Gmail / Outlook where authorized
- Slack / Microsoft Teams chat
- HubSpot / Salesforce / Pipedrive and other CRM adapters
- Notion / Confluence
- Google Drive / OneDrive
- Jira / Linear / Asana / Monday / ClickUp
- Zapier / Make / n8n-style automation
- MCP integrations
- configurable post-meeting rules
- automatic CRM field updates
- automatic task creation
- webhook-triggered workflows
- integration marketplace/catalog

Reason for separate module: integrations are a major retention/distribution surface and should not be hidden inside Meeting Capture or Public API.

### MOD-022 — Conversation Intelligence, QA & Compliance Scoring

Objective: compete in contact-center, sales, support, recruiting and manager intelligence rather than only meeting notes.

Scope candidates:
- 100% call/meeting scoring
- configurable scorecards
- QA review queues
- compliance script detection
- policy violation detection
- objection/topic detection
- customer/agent sentiment and trend signals
- talk/listen ratio
- interruptions/silence/pace
- sales qualification and deal signals
- coaching opportunities
- manager/team benchmarking
- screen-recording correlation where authorized
- automatic call disposition
- custom extraction schemas

Reason for separate module: this is a distinct B2B product line with its own metrics, configuration, evaluation and admin experience.

### MOD-023 — Unified Conversation Knowledge & Cross-App Search

Objective: make conversations part of a permission-aware enterprise knowledge layer instead of a collection of isolated meeting records.

Scope candidates:
- semantic search across meetings/calls
- cross-meeting Q&A
- email/calendar/chat/document/CRM context connectors
- entity/person/company/project timelines
- conversation memory
- relationship/context graph where useful
- citations back to source utterances/documents
- permissions-aware retrieval
- saved searches/topics
- daily/weekly briefs
- proactive knowledge surfacing
- user/team knowledge spaces

Reason for separate module: competitor direction is toward searchable work context, not only per-meeting summaries.

### MOD-024 — Agentic Actions, AI Skills & Voice Agents

Objective: move from "tell me what happened" to "safely do the next authorized work".

Scope candidates:
- user-approved action execution
- reusable AI skills/templates
- workflow/action catalog
- specialist agents for sales, recruiting, support and meetings
- CRM/task/email/calendar actions
- meeting agent participation
- conversational voice agents where explicitly authorized
- human approval checkpoints
- tool permissions/scopes
- retries/idempotency
- action audit trail
- sandbox/testing mode

Reason for separate module: realtime coaching in MOD-009 is assistance; agentic execution is a different security and product boundary.

### MOD-025 — Enterprise Administration, Device Fleet & Deployment Control

Objective: support enterprise/BPO rollout and policy operation at scale.

Scope candidates:
- SSO/SAML/OIDC enterprise auth
- SCIM provisioning
- domain claim
- organization/team hierarchy
- RBAC/custom roles
- fleet/device inventory
- remote configuration/policy
- app/version enforcement
- provider/model policy by team
- accent/language feature policy
- recording/retention policy by group
- audit logs
- admin change history
- enterprise analytics access
- managed deployment packages
- VDI/thin-client strategy where feasible
- region/data-residency policy
- on-device vs remote inference policy
- staged rollouts

Reason for separate module: enterprise administration is materially different from product analytics/observability in MOD-016.

## Existing modules that should be expanded rather than duplicated

### MOD-007 — Meeting Capture & Platform Connectors

Add explicit support planning for:
- screen-share/screen recording where permitted
- in-meeting chat messages
- participant events
- mute/unmute and join/leave events
- shared-content/OCR metadata where useful
- bot + bot-free + native capture strategies

Mobile/browser client ownership belongs in MOD-020; MOD-007 remains the normalized meeting-capture domain.

### MOD-008 — Meeting Intelligence & Knowledge

Keep per-conversation artifacts here:
- notes
- summaries
- decisions
- action items
- chapters
- highlights/clips
- templates
- collaboration/comments
- meeting folders/tags/channels

Cross-app / cross-conversation knowledge belongs in MOD-023.

### MOD-012 — Expand to Voice Identity, Personalization & Voice Security

Recommended expanded scope:
- voice enrollment/personalization
- speaker verification
- customer speaker-change detection
- agent identity verification
- deepfake/synthetic-speech detection
- cloned-voice risk signals
- real-time security alerts
- security-event audit trail
- enrollment/revocation/deletion
- anti-impersonation controls

This avoids creating a duplicate voice-security module while giving the area explicit competitive scope.

### MOD-016 — Admin, Analytics, Observability & Cost Control

Keep engineering/product operations here:
- service health
- provider health
- latency/jitter
- cost per minute/session
- feature telemetry
- SLOs/alerts
- operational dashboards

Enterprise customer administration/fleet/policy belongs in MOD-025.

## Recommended module count

- Existing canonical modules: 19
- New competitive responsibility modules recommended: 6
- Recommended planning target: **25 total modules**

This is not a claim that 25 modules guarantee competitive success. Each module can contain many capabilities and work units. Competitive strength depends on quality, latency, reliability, platform coverage, model performance, privacy, UX, integrations and economics—not module count alone.

## Development state

No implementation, model training, paid API consumption, infrastructure provisioning or deployment is authorized by this audit. All recommended modules remain planning scope until the owner gives explicit development consent and the ANPOS technology-consent gate is satisfied.
# VSN Voice AI — UI/UX Product Specification

**Lifecycle stage:** Stage 12 — Professional UI/UX and Design Assurance  
**Design authority:** validated product/system requirements; no external design supplied  
**Accessibility target:** WCAG 2.2 AA for web

## 1. Product UX principles

- Realtime audio controls must be understandable in seconds.
- The product always makes processing state visible: active, bypassed, degraded, reconnecting, failed.
- Users must know when recording/transcription is active.
- Complex provider routing remains hidden by default; advanced users/admins can inspect policy and diagnostics.
- Meeting outputs are source-traceable and distinguish live/provisional from finalized content.
- Permission-sensitive actions clearly show account, tenant, target and effect before high-impact execution.
- Destructive/privacy actions use explicit confirmation and visible completion/error state.
- Desktop realtime operation prioritizes stability over decorative animation.

## 2. Primary user journeys

### Journey A — First-time setup

1. Sign in/create account.
2. Join/create organization if applicable.
3. Install/link desktop app.
4. Select microphone and speaker.
5. Run audio test.
6. Enable Noise Cancellation.
7. Optionally enable Accent Conversion and choose target/strength.
8. Optionally configure Translation.
9. Confirm virtual microphone selection instructions for calling apps.
10. Start test session and verify processed/bypass audio.

### Journey B — Live call control

1. Desktop detects/starts session.
2. User sees selected mic/output and connection health.
3. Toggle Noise, Background Voice, Accent and Translation independently where supported.
4. Show per-capability state: local/provider/unsupported/degraded.
5. User can instantly trigger Safe Bypass.
6. Optional transcript/caption panel displays live provisional text.

### Journey C — Meeting capture to notes

1. User connects calendar/meeting provider or starts manual capture.
2. Recording/transcription state is visible.
3. Live transcript and key points are optional during meeting.
4. On end, meeting moves to Processing.
5. Final meeting page shows Summary, Notes, Decisions, Action Items, Transcript, Speakers, Highlights and Q&A.
6. User can edit/confirm actions and export/send to integrations.

### Journey D — Search and knowledge

1. User opens global search/Ask VSN.
2. Search is scoped to resources they can access.
3. Answers cite meetings/transcript sections/connected-source evidence.
4. User can open source context directly.

### Journey E — Team/admin setup

1. Admin invites members.
2. Assigns roles and feature policies.
3. Configures allowed providers/regions/recording retention.
4. Reviews usage, cost and health.
5. Enterprise later adds SSO/SCIM/device fleet/policy controls.

## 3. Web application information architecture

Primary navigation:

- Home
- Meetings
- Search / Ask VSN
- Actions
- Integrations
- Team
- Usage & Billing
- Settings

Admin-only navigation when permitted:

- Organization
- Provider Policy
- Analytics
- Security & Audit
- Enterprise / Device Fleet

Later developer surface:

- API Keys
- Webhooks
- SDK / API Documentation

## 4. Web screen inventory

### Authentication

- Sign in
- Sign up
- Password/recovery or configured identity-provider flow
- Organization invitation acceptance

### Onboarding

- Welcome/product capability explanation
- Desktop download/linking
- Audio device setup
- Feature setup
- Calendar/meeting connection
- Privacy/recording explanation

### Home dashboard

Content priority:

1. Start/record a meeting or open desktop controls.
2. Upcoming meetings.
3. Recent meetings.
4. Pending action items.
5. Current usage/quota summary.
6. Integration/desktop health warnings when relevant.

### Meetings library

- list/grid option where useful;
- date, participant, owner, source/platform filters;
- processing/final/failed states;
- search;
- folders/tags/channels when implemented;
- batch actions only when authorization is unambiguous.

### Meeting detail

Tabs/sections:

- Overview
- Notes
- Summary
- Decisions
- Action Items
- Transcript
- Speakers
- Highlights / Clips
- Ask this meeting
- Activity / integrations

Important states:

- live/provisional;
- processing;
- finalized;
- partial provider failure;
- capture failed;
- deletion pending;
- access revoked.

### Global Search / Ask VSN

- query composer;
- source scope/filter;
- answer with citations;
- source result list;
- permission-denied sources must not be leaked through titles/snippets/counts;
- saved searches/topics later.

### Integrations

- catalog;
- connected/disconnected/error/reauthorization states;
- scopes displayed before connection;
- revoke/remove;
- sync status;
- workflow rule configuration later.

### Usage & Billing

- plan;
- included usage;
- usage by capability;
- overage/quota state;
- invoices/payment-provider links as applicable;
- provider internal cost information is admin-only unless product policy exposes it.

### Settings

Sections:

- Profile
- Audio defaults
- Accent & voice
- Translation
- Recording & retention
- Notifications
- Privacy & data
- Connected devices
- API/developer settings later

## 5. Desktop application IA

Primary desktop views:

### Realtime Control

Must show:

- physical microphone;
- virtual microphone state;
- output device where relevant;
- Noise Cancellation toggle;
- Background Voice Cancellation toggle;
- Accent Conversion toggle + target accent/strength when available;
- Translation toggle + source/target language;
- live latency/health indicator simplified to Good / Degraded / Bypassed;
- Safe Bypass control always reachable;
- session state.

### Audio Setup

- microphone list;
- speaker/output list;
- input meter;
- test recording/playback where technically appropriate;
- virtual device setup/repair status;
- device permission guidance;
- troubleshooting diagnostics.

### Live Transcript

- optional compact transcript;
- speaker labels when available;
- provisional state indicator;
- language indicator;
- captions on/off.

### Meeting Capture

- start/stop capture;
- active meeting identity/platform when known;
- recording/transcription indicator;
- open meeting in web workspace.

### Diagnostics

- app/runtime version;
- audio device state;
- provider/capability health without exposing secrets;
- recent content-safe error codes;
- copy diagnostics bundle with sensitive-field redaction.

## 6. Realtime interaction rules

- Feature toggle confirmation should be immediate; backend/provider connection may show `Connecting…` until actually active.
- A toggle may not visually report Active until runtime evidence says it is active.
- On provider failure, show `Degraded` or `Bypassed`; do not silently pretend processing continues.
- Safe Bypass must be one action away from the primary realtime screen.
- Switching microphones during a call must show transition/recovery state.
- Unsupported features are disabled with an explanation, not hidden when the user reasonably expects them.

## 7. Meeting intelligence interaction rules

- Live notes/transcript marked `Live` or `Provisional`.
- Finalized transcript version/time is visible.
- AI-generated decisions/actions support edit/confirm/dismiss.
- Action items show owner and due date only when extracted or explicitly assigned; unknown values remain unknown.
- AI answers include source links/citations where supported.
- Failed extraction does not erase the transcript.

## 8. Agentic action UX

Before a sensitive external write, show:

- action type;
- destination/integration;
- target record/person/calendar/task;
- meaningful payload preview;
- permission/account context;
- whether the action is reversible.

States:

- Proposed
- Approval required
- Approved
- Executing
- Succeeded
- Failed
- Partially applied / reconciliation required

Repeated submission uses idempotency protection; the UI should not encourage duplicate retries while state is unknown.

## 9. Responsive targets

Web baseline viewports:

- 360px mobile
- 768px tablet
- 1280px desktop
- 1440px+ large desktop

Rules:

- core meeting/search tasks remain usable at 360px;
- complex analytics may progressively simplify but cannot hide critical meaning;
- no horizontal page scroll for core workflows;
- touch targets meet accessibility expectations;
- transcript/meeting detail uses stacked panes on small screens.

Desktop application baseline:

- compact control window suitable beside conferencing apps;
- primary control state remains usable around 420px wide;
- expanded transcript/diagnostic views may require larger dimensions.

## 10. Accessibility

Web target: WCAG 2.2 AA.

Required from first implementation:

- semantic landmarks/headings/forms;
- keyboard operability;
- visible focus state;
- accessible labels/names for icon controls;
- color is never the only state indicator;
- status changes announced appropriately to assistive technology;
- adequate contrast;
- 200% zoom/reflow for core workflows;
- reduced-motion support;
- descriptive validation/errors;
- transcript controls usable without pointer-only interaction.

Realtime audio/meeting status should pair icon/color with explicit text such as `Active`, `Degraded`, `Bypassed`, `Recording`.

## 11. Design-system baseline

Initial tokens should cover:

- typography scale;
- spacing scale;
- radii;
- border/elevation levels;
- semantic foreground/background/surface colors;
- success/warning/error/info states;
- realtime processing states;
- focus ring;
- motion durations with reduced-motion alternative.

Initial reusable components:

- Button/IconButton
- Toggle
- Select/Combobox
- StatusBadge
- HealthIndicator
- DevicePicker
- AudioLevelMeter
- CapabilityControl
- MeetingCard
- TranscriptSegment
- SpeakerBadge
- ActionItem
- SourceCitation
- IntegrationCard
- UsageMeter
- ConfirmActionDialog
- Empty/Loading/Error states

No brand-heavy visual direction is locked by this specification. Functional design tokens can be implemented first and visually refined without changing product architecture.

## 12. Empty/loading/error/success requirements

Every networked screen must define:

- initial loading;
- empty data;
- authorization failure;
- provider/integration degraded state;
- retryable error;
- non-retryable error;
- offline state where relevant;
- success confirmation for mutations.

Meeting processing must distinguish `processing` from `failed`; long-running work may not show indefinite generic spinners without state.

## 13. Stage 12 exit criteria

The Stage 12 baseline is complete when:

- primary journeys and screen inventory exist;
- realtime/meeting/agentic interaction states are explicit;
- responsive targets are defined;
- WCAG 2.2 AA requirements are defined;
- design-system/component baseline exists;
- no untracked external design revision is treated as approved authority.

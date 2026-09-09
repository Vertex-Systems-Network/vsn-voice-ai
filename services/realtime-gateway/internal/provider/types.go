package provider

import "errors"

type Capability string

const (
	CapabilityNoiseCancel         Capability = "audio.noise_cancel"
	CapabilityBackgroundVoice     Capability = "audio.background_voice_cancel"
	CapabilityEchoReduce          Capability = "audio.echo_reduce"
	CapabilityVAD                 Capability = "audio.vad"
	CapabilityAccentConvert       Capability = "voice.accent_convert"
	CapabilityIdentityPreserve    Capability = "voice.identity_preserve"
	CapabilityDeepfakeDetect      Capability = "voice.deepfake_detect"
	CapabilitySpeakerVerify       Capability = "voice.speaker_verify"
	CapabilityTranslateRealtime   Capability = "speech.translate_realtime"
	CapabilityTranscribeStream    Capability = "speech.transcribe_stream"
	CapabilityTranscribeFinalize  Capability = "speech.transcribe_finalize"
	CapabilitySynthesize          Capability = "speech.synthesize"
	CapabilityMeetingCapture      Capability = "meeting.capture"
	CapabilityMeetingTranscript   Capability = "meeting.transcript"
	CapabilityMeetingIntelligence Capability = "meeting.intelligence"
	CapabilityConversationScore   Capability = "conversation.score"
	CapabilityKnowledgeSearch     Capability = "knowledge.search"
	CapabilityAssistantRealtime   Capability = "assistant.realtime"
	CapabilityAgentAction         Capability = "agent.action"
	CapabilityTelephonyMedia      Capability = "telephony.media"
)

type AccessMode string

const (
	AccessAPI      AccessMode = "api"
	AccessSDK      AccessMode = "sdk"
	AccessLocal    AccessMode = "local"
	AccessOnPrem   AccessMode = "on_prem"
	AccessInternal AccessMode = "internal"
)

type HealthState string

const (
	HealthHealthy   HealthState = "healthy"
	HealthDegraded  HealthState = "degraded"
	HealthUnhealthy HealthState = "unhealthy"
	HealthOpen      HealthState = "circuit_open"
)

type RateLimitState string

const (
	RateLimitUnknown     RateLimitState = "unknown"
	RateLimitAvailable   RateLimitState = "available"
	RateLimitConstrained RateLimitState = "constrained"
	RateLimitExhausted   RateLimitState = "exhausted"
)

type ProviderManifest struct {
	ID                       string         `json:"id"`
	Version                  string         `json:"version"`
	AccessMode               AccessMode     `json:"access_mode"`
	Capabilities             []Capability   `json:"capabilities"`
	Regions                  []string       `json:"regions,omitempty"`
	Enabled                  bool           `json:"enabled"`
	VerifiedAccess           bool           `json:"verified_access"`
	Health                   HealthState    `json:"health"`
	RateLimit                RateLimitState `json:"rate_limit"`
	LatencyP95Milliseconds   int            `json:"latency_p95_ms,omitempty"`
	QualityScore             int            `json:"quality_score,omitempty"`
	PrivacyScore             int            `json:"privacy_score,omitempty"`
	CostMicrounitsPerMinute  int64          `json:"cost_microunits_per_minute,omitempty"`
	RemainingQuotaMicrounits int64          `json:"remaining_quota_microunits,omitempty"`
	RetentionPolicy          string         `json:"retention_policy,omitempty"`
}

func (m ProviderManifest) Supports(capability Capability) bool {
	for _, supported := range m.Capabilities {
		if supported == capability {
			return true
		}
	}
	return false
}

type RoutingMode string

const (
	RoutingAuto          RoutingMode = "auto"
	RoutingLowestLatency RoutingMode = "lowest_latency"
	RoutingBestQuality   RoutingMode = "best_quality"
	RoutingBestPrivacy   RoutingMode = "best_privacy"
	RoutingLowestCost    RoutingMode = "lowest_cost"
)

type RoutingRequest struct {
	Capability             Capability  `json:"capability"`
	Mode                   RoutingMode `json:"mode"`
	RequiredRegion         string      `json:"required_region,omitempty"`
	AllowedProviders       []string    `json:"allowed_providers,omitempty"`
	DeniedProviders        []string    `json:"denied_providers,omitempty"`
	MaxLatencyMilliseconds int         `json:"max_latency_ms,omitempty"`
	MinQualityScore        int         `json:"min_quality_score,omitempty"`
	RequireVerifiedAccess  bool        `json:"require_verified_access"`
}

type RoutingDecision struct {
	Capability        Capability  `json:"capability"`
	Mode              RoutingMode `json:"mode"`
	SelectedProvider  string      `json:"selected_provider"`
	FallbackProviders []string    `json:"fallback_providers"`
	Reason            string      `json:"reason"`
}

var (
	ErrInvalidProvider    = errors.New("invalid provider manifest")
	ErrProviderNotFound   = errors.New("provider not found")
	ErrNoEligibleProvider = errors.New("no eligible provider")
)

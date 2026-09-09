package provider

type RoutingOutcome string

const (
	RoutingOutcomeSelected   RoutingOutcome = "selected"
	RoutingOutcomeNoEligible RoutingOutcome = "no_eligible_provider"
)

// RoutingEvent deliberately excludes customer audio, transcript content,
// credentials, tenant PII and provider secret material.
type RoutingEvent struct {
	Capability       Capability     `json:"capability"`
	Mode             RoutingMode    `json:"mode"`
	Outcome          RoutingOutcome `json:"outcome"`
	SelectedProvider string         `json:"selected_provider,omitempty"`
	EligibleCount    int            `json:"eligible_count"`
	FallbackCount    int            `json:"fallback_count"`
}

type RoutingObserver interface {
	ObserveRouting(RoutingEvent)
}

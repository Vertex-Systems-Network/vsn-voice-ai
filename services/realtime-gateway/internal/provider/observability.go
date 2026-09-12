package provider

import "sync"

// ProviderRoutingMetrics is a content-safe operational view of provider routing.
// It deliberately contains no customer audio, transcript text, credentials,
// tenant PII, provider secrets, or request payload content.
type ProviderRoutingMetrics struct {
	ProviderID                  string         `json:"provider_id"`
	SelectionCount              uint64         `json:"selection_count"`
	LatencyP95Milliseconds      int            `json:"latency_p95_ms,omitempty"`
	CostMicrounitsPerMinute     int64          `json:"cost_microunits_per_minute,omitempty"`
	Health                      HealthState    `json:"health"`
	RateLimit                   RateLimitState `json:"rate_limit"`
}

// RoutingMetricsSnapshot is an immutable-by-copy snapshot suitable for an
// OpenTelemetry/export adapter. The observer itself does not perform network I/O.
type RoutingMetricsSnapshot struct {
	TotalSelections uint64                            `json:"total_selections"`
	NoEligibleCount uint64                            `json:"no_eligible_count"`
	ByProvider      map[string]ProviderRoutingMetrics `json:"by_provider"`
}

// ProviderRoutingMetricsObserver converts routing decisions into bounded,
// content-safe operational counters while resolving latency/cost/health from
// the canonical provider registry.
type ProviderRoutingMetricsObserver struct {
	registry *Registry

	mu              sync.RWMutex
	totalSelections uint64
	noEligibleCount uint64
	byProvider      map[string]ProviderRoutingMetrics
}

func NewProviderRoutingMetricsObserver(registry *Registry) *ProviderRoutingMetricsObserver {
	return &ProviderRoutingMetricsObserver{
		registry:   registry,
		byProvider: make(map[string]ProviderRoutingMetrics),
	}
}

func (o *ProviderRoutingMetricsObserver) ObserveRouting(event RoutingEvent) {
	if o == nil {
		return
	}

	switch event.Outcome {
	case RoutingOutcomeNoEligible:
		o.mu.Lock()
		o.noEligibleCount++
		o.mu.Unlock()
		return
	case RoutingOutcomeSelected:
		// Continue below.
	default:
		return
	}

	if event.SelectedProvider == "" || o.registry == nil {
		return
	}
	manifest, ok := o.registry.Get(event.SelectedProvider)
	if !ok {
		return
	}

	o.mu.Lock()
	metrics := o.byProvider[manifest.ID]
	metrics.ProviderID = manifest.ID
	metrics.SelectionCount++
	metrics.LatencyP95Milliseconds = manifest.LatencyP95Milliseconds
	metrics.CostMicrounitsPerMinute = manifest.CostMicrounitsPerMinute
	metrics.Health = manifest.Health
	metrics.RateLimit = manifest.RateLimit
	o.byProvider[manifest.ID] = metrics
	o.totalSelections++
	o.mu.Unlock()
}

func (o *ProviderRoutingMetricsObserver) Snapshot() RoutingMetricsSnapshot {
	if o == nil {
		return RoutingMetricsSnapshot{ByProvider: map[string]ProviderRoutingMetrics{}}
	}

	o.mu.RLock()
	defer o.mu.RUnlock()

	byProvider := make(map[string]ProviderRoutingMetrics, len(o.byProvider))
	for id, metrics := range o.byProvider {
		byProvider[id] = metrics
	}
	return RoutingMetricsSnapshot{
		TotalSelections: o.totalSelections,
		NoEligibleCount: o.noEligibleCount,
		ByProvider:      byProvider,
	}
}

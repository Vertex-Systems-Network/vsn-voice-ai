package provider

import (
	"fmt"
	"sort"
)

type Router struct {
	registry  *Registry
	observers []RoutingObserver
}

func NewRouter(registry *Registry, observers ...RoutingObserver) *Router {
	return &Router{registry: registry, observers: append([]RoutingObserver(nil), observers...)}
}

func (r *Router) Select(request RoutingRequest) (RoutingDecision, error) {
	if request.Mode == "" {
		request.Mode = RoutingAuto
	}
	candidates := make([]ProviderManifest, 0)
	for _, manifest := range r.registry.Snapshot() {
		if eligible(manifest, request) {
			candidates = append(candidates, manifest)
		}
	}
	if len(candidates) == 0 {
		r.observe(RoutingEvent{
			Capability: request.Capability,
			Mode:       request.Mode,
			Outcome:    RoutingOutcomeNoEligible,
		})
		return RoutingDecision{}, ErrNoEligibleProvider
	}

	sortCandidates(candidates, request.Mode)
	fallbacks := make([]string, 0, len(candidates)-1)
	for _, candidate := range candidates[1:] {
		fallbacks = append(fallbacks, candidate.ID)
	}

	decision := RoutingDecision{
		Capability:        request.Capability,
		Mode:              request.Mode,
		SelectedProvider:  candidates[0].ID,
		FallbackProviders: fallbacks,
		Reason:            fmt.Sprintf("selected %s from %d eligible providers using %s policy", candidates[0].ID, len(candidates), request.Mode),
	}
	r.observe(RoutingEvent{
		Capability:       request.Capability,
		Mode:             request.Mode,
		Outcome:          RoutingOutcomeSelected,
		SelectedProvider: decision.SelectedProvider,
		EligibleCount:    len(candidates),
		FallbackCount:    len(fallbacks),
	})
	return decision, nil
}

func (r *Router) observe(event RoutingEvent) {
	for _, observer := range r.observers {
		if observer != nil {
			observer.ObserveRouting(event)
		}
	}
}

func eligible(manifest ProviderManifest, request RoutingRequest) bool {
	if !manifest.Enabled || !manifest.Supports(request.Capability) {
		return false
	}
	if request.RequireVerifiedAccess && !manifest.VerifiedAccess {
		return false
	}
	if manifest.Health == HealthUnhealthy || manifest.Health == HealthOpen {
		return false
	}
	if manifest.RateLimit == RateLimitExhausted {
		return false
	}
	if len(request.AllowedProviders) > 0 && !containsString(request.AllowedProviders, manifest.ID) {
		return false
	}
	if containsString(request.DeniedProviders, manifest.ID) {
		return false
	}
	if request.RequiredRegion != "" && !containsString(manifest.Regions, request.RequiredRegion) {
		return false
	}
	if request.MaxLatencyMilliseconds > 0 && manifest.LatencyP95Milliseconds > request.MaxLatencyMilliseconds {
		return false
	}
	if request.MinQualityScore > 0 && manifest.QualityScore < request.MinQualityScore {
		return false
	}
	return true
}

func sortCandidates(candidates []ProviderManifest, mode RoutingMode) {
	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		switch mode {
		case RoutingLowestLatency:
			if a.LatencyP95Milliseconds != b.LatencyP95Milliseconds {
				return lowerPositive(a.LatencyP95Milliseconds, b.LatencyP95Milliseconds)
			}
		case RoutingBestQuality:
			if a.QualityScore != b.QualityScore {
				return a.QualityScore > b.QualityScore
			}
		case RoutingBestPrivacy:
			if a.PrivacyScore != b.PrivacyScore {
				return a.PrivacyScore > b.PrivacyScore
			}
		case RoutingLowestCost:
			if a.CostMicrounitsPerMinute != b.CostMicrounitsPerMinute {
				return lowerPositive64(a.CostMicrounitsPerMinute, b.CostMicrounitsPerMinute)
			}
		case RoutingAuto:
			if healthRank(a.Health) != healthRank(b.Health) {
				return healthRank(a.Health) > healthRank(b.Health)
			}
			if rateLimitRank(a.RateLimit) != rateLimitRank(b.RateLimit) {
				return rateLimitRank(a.RateLimit) > rateLimitRank(b.RateLimit)
			}
			if a.QualityScore != b.QualityScore {
				return a.QualityScore > b.QualityScore
			}
			if a.LatencyP95Milliseconds != b.LatencyP95Milliseconds {
				return lowerPositive(a.LatencyP95Milliseconds, b.LatencyP95Milliseconds)
			}
			if a.PrivacyScore != b.PrivacyScore {
				return a.PrivacyScore > b.PrivacyScore
			}
			if a.CostMicrounitsPerMinute != b.CostMicrounitsPerMinute {
				return lowerPositive64(a.CostMicrounitsPerMinute, b.CostMicrounitsPerMinute)
			}
		default:
			return a.ID < b.ID
		}
		return a.ID < b.ID
	})
}

func healthRank(state HealthState) int {
	switch state {
	case HealthHealthy:
		return 3
	case HealthDegraded:
		return 2
	default:
		return 0
	}
}

func rateLimitRank(state RateLimitState) int {
	switch state {
	case RateLimitAvailable:
		return 3
	case RateLimitUnknown:
		return 2
	case RateLimitConstrained:
		return 1
	default:
		return 0
	}
}

func lowerPositive(a, b int) bool {
	if a <= 0 && b <= 0 {
		return false
	}
	if a <= 0 {
		return false
	}
	if b <= 0 {
		return true
	}
	return a < b
}

func lowerPositive64(a, b int64) bool {
	if a <= 0 && b <= 0 {
		return false
	}
	if a <= 0 {
		return false
	}
	if b <= 0 {
		return true
	}
	return a < b
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

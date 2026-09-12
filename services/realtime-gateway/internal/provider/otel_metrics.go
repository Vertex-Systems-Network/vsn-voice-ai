package provider

import "sort"

const (
	RoutingMetricSelectionsName = "vsn.provider.routing.selections"
	RoutingMetricNoEligibleName = "vsn.provider.routing.no_eligible"
	RoutingMetricLatencyP95Name = "vsn.provider.latency.p95"
	RoutingMetricCostName       = "vsn.provider.cost.estimated_per_minute"
)

type RoutingMetricKind string

const (
	RoutingMetricCounter RoutingMetricKind = "counter"
	RoutingMetricGauge   RoutingMetricKind = "gauge"
)

// RoutingMetricPoint is the content-safe handoff boundary between the provider
// router and an OpenTelemetry metrics adapter. Attribute keys are deliberately
// closed over provider operational state; callers cannot attach request,
// transcript, audio, tenant, credential, payment, or document content.
type RoutingMetricPoint struct {
	Name       string            `json:"name"`
	Kind       RoutingMetricKind `json:"kind"`
	Unit       string            `json:"unit"`
	Value      int64             `json:"value"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

func BuildRoutingMetricPoints(snapshot RoutingMetricsSnapshot) []RoutingMetricPoint {
	points := make([]RoutingMetricPoint, 0, 1+(len(snapshot.ByProvider)*3))
	points = append(points, RoutingMetricPoint{
		Name:  RoutingMetricNoEligibleName,
		Kind:  RoutingMetricCounter,
		Unit:  "{route}",
		Value: uint64ToInt64Saturated(snapshot.NoEligibleCount),
	})

	providerIDs := make([]string, 0, len(snapshot.ByProvider))
	for providerID := range snapshot.ByProvider {
		providerIDs = append(providerIDs, providerID)
	}
	sort.Strings(providerIDs)

	for _, providerID := range providerIDs {
		metrics := snapshot.ByProvider[providerID]
		attributes := routingProviderAttributes(providerID, metrics)
		points = append(points,
			RoutingMetricPoint{
				Name:       RoutingMetricSelectionsName,
				Kind:       RoutingMetricCounter,
				Unit:       "{route}",
				Value:      uint64ToInt64Saturated(metrics.SelectionCount),
				Attributes: cloneRoutingMetricAttributes(attributes),
			},
			RoutingMetricPoint{
				Name:       RoutingMetricLatencyP95Name,
				Kind:       RoutingMetricGauge,
				Unit:       "ms",
				Value:      int64(metrics.LatencyP95Milliseconds),
				Attributes: cloneRoutingMetricAttributes(attributes),
			},
			RoutingMetricPoint{
				Name:       RoutingMetricCostName,
				Kind:       RoutingMetricGauge,
				Unit:       "{microunit}/min",
				Value:      metrics.CostMicrounitsPerMinute,
				Attributes: cloneRoutingMetricAttributes(attributes),
			},
		)
	}

	return points
}

func routingProviderAttributes(providerID string, metrics ProviderRoutingMetrics) map[string]string {
	return map[string]string{
		"provider.id":         providerID,
		"provider.health":     string(metrics.Health),
		"provider.rate_limit": string(metrics.RateLimit),
	}
}

func cloneRoutingMetricAttributes(attributes map[string]string) map[string]string {
	clone := make(map[string]string, len(attributes))
	for key, value := range attributes {
		clone[key] = value
	}
	return clone
}

func uint64ToInt64Saturated(value uint64) int64 {
	const maxInt64 = int64(^uint64(0) >> 1)
	if value > uint64(maxInt64) {
		return maxInt64
	}
	return int64(value)
}

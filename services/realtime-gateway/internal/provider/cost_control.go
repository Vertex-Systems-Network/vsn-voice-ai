package provider

import (
	"math"
	"math/big"
	"math/bits"
	"sort"
)

const routingBasisPointsScale uint64 = 10_000

type RoutingCostControlSummary struct {
	TotalSelections                         uint64                `json:"total_selections"`
	NoEligibleCount                         uint64                `json:"no_eligible_count"`
	NoEligibleBasisPoints                   uint32                `json:"no_eligible_basis_points"`
	AverageSelectedCostMicrounitsPerMinute int64                 `json:"average_selected_cost_microunits_per_minute"`
	ByProvider                              []ProviderCostControl `json:"by_provider"`
}

type ProviderCostControl struct {
	ProviderID                         string         `json:"provider_id"`
	SelectionCount                     uint64         `json:"selection_count"`
	SelectionShareBasisPoints          uint32         `json:"selection_share_basis_points"`
	CostMicrounitsPerMinute            int64          `json:"cost_microunits_per_minute"`
	WeightedCostContributionMicrounits int64          `json:"weighted_cost_contribution_microunits_per_minute"`
	LatencyP95Milliseconds             int            `json:"latency_p95_ms"`
	Health                             HealthState    `json:"health"`
	RateLimit                          RateLimitState `json:"rate_limit"`
}

type RoutingAlertSeverity string

const (
	RoutingAlertWarning  RoutingAlertSeverity = "warning"
	RoutingAlertCritical RoutingAlertSeverity = "critical"
)

type RoutingOperationalThresholds struct {
	MaxLatencyP95Milliseconds  int    `json:"max_latency_p95_ms"`
	MaxCostMicrounitsPerMinute int64  `json:"max_cost_microunits_per_minute"`
	MaxNoEligibleBasisPoints   uint32 `json:"max_no_eligible_basis_points"`
	MinRouteAttempts           uint64 `json:"min_route_attempts"`
}

// RoutingOperationalAlert is intentionally content-safe. It carries only a
// stable alert code, operational severity, optional provider identifier and
// numeric observed/threshold values. It has no extension map, request payload,
// tenant identity, transcript, audio, credential or payment-content field.
type RoutingOperationalAlert struct {
	Code       string               `json:"code"`
	Severity   RoutingAlertSeverity `json:"severity"`
	ProviderID string               `json:"provider_id,omitempty"`
	Observed   int64                `json:"observed"`
	Threshold  int64                `json:"threshold,omitempty"`
}

// BuildRoutingCostControlSummary converts a routing snapshot into a deterministic
// content-safe operational cost view. Cost is an estimated provider rate, not an
// accrued-spend or billing-ledger claim.
func BuildRoutingCostControlSummary(snapshot RoutingMetricsSnapshot) RoutingCostControlSummary {
	totalAttempts := saturatedAddUint64(snapshot.TotalSelections, snapshot.NoEligibleCount)
	summary := RoutingCostControlSummary{
		TotalSelections:       snapshot.TotalSelections,
		NoEligibleCount:       snapshot.NoEligibleCount,
		NoEligibleBasisPoints: routingBasisPoints(snapshot.NoEligibleCount, totalAttempts),
		ByProvider:            make([]ProviderCostControl, 0, len(snapshot.ByProvider)),
	}

	providerIDs := make([]string, 0, len(snapshot.ByProvider))
	for providerID := range snapshot.ByProvider {
		providerIDs = append(providerIDs, providerID)
	}
	sort.Strings(providerIDs)

	weightedCost := new(big.Int)
	for _, providerID := range providerIDs {
		metrics := snapshot.ByProvider[providerID]
		cost := metrics.CostMicrounitsPerMinute
		if cost < 0 {
			cost = 0
		}

		share := routingBasisPoints(metrics.SelectionCount, snapshot.TotalSelections)
		contribution := weightedRateContribution(cost, share)
		summary.ByProvider = append(summary.ByProvider, ProviderCostControl{
			ProviderID:                         providerID,
			SelectionCount:                     metrics.SelectionCount,
			SelectionShareBasisPoints:          share,
			CostMicrounitsPerMinute:            cost,
			WeightedCostContributionMicrounits: contribution,
			LatencyP95Milliseconds:             metrics.LatencyP95Milliseconds,
			Health:                             metrics.Health,
			RateLimit:                          metrics.RateLimit,
		})

		if metrics.SelectionCount != 0 && cost != 0 {
			term := new(big.Int).Mul(
				new(big.Int).SetInt64(cost),
				new(big.Int).SetUint64(metrics.SelectionCount),
			)
			weightedCost.Add(weightedCost, term)
		}
	}

	if snapshot.TotalSelections != 0 {
		average := new(big.Int).Quo(weightedCost, new(big.Int).SetUint64(snapshot.TotalSelections))
		if average.IsInt64() {
			summary.AverageSelectedCostMicrounitsPerMinute = average.Int64()
		} else {
			summary.AverageSelectedCostMicrounitsPerMinute = math.MaxInt64
		}
	}

	return summary
}

func EvaluateRoutingOperationalAlerts(
	snapshot RoutingMetricsSnapshot,
	thresholds RoutingOperationalThresholds,
) []RoutingOperationalAlert {
	alerts := make([]RoutingOperationalAlert, 0, len(snapshot.ByProvider)*4+1)
	totalAttempts := saturatedAddUint64(snapshot.TotalSelections, snapshot.NoEligibleCount)
	noEligibleBasisPoints := routingBasisPoints(snapshot.NoEligibleCount, totalAttempts)
	if thresholds.MaxNoEligibleBasisPoints != 0 &&
		totalAttempts >= thresholds.MinRouteAttempts &&
		noEligibleBasisPoints > thresholds.MaxNoEligibleBasisPoints {
		alerts = append(alerts, RoutingOperationalAlert{
			Code:      "routing.no_eligible_rate_high",
			Severity:  RoutingAlertCritical,
			Observed:  int64(noEligibleBasisPoints),
			Threshold: int64(thresholds.MaxNoEligibleBasisPoints),
		})
	}

	providerIDs := make([]string, 0, len(snapshot.ByProvider))
	for providerID := range snapshot.ByProvider {
		providerIDs = append(providerIDs, providerID)
	}
	sort.Strings(providerIDs)

	for _, providerID := range providerIDs {
		metrics := snapshot.ByProvider[providerID]
		switch metrics.Health {
		case HealthDegraded:
			alerts = append(alerts, providerStateAlert(
				"provider.health_degraded", RoutingAlertWarning, providerID, 1))
		case HealthUnhealthy:
			alerts = append(alerts, providerStateAlert(
				"provider.health_unhealthy", RoutingAlertCritical, providerID, 1))
		case HealthOpen:
			alerts = append(alerts, providerStateAlert(
				"provider.circuit_open", RoutingAlertCritical, providerID, 1))
		}

		switch metrics.RateLimit {
		case RateLimitConstrained:
			alerts = append(alerts, providerStateAlert(
				"provider.rate_limit_constrained", RoutingAlertWarning, providerID, 1))
		case RateLimitExhausted:
			alerts = append(alerts, providerStateAlert(
				"provider.rate_limit_exhausted", RoutingAlertCritical, providerID, 1))
		}

		if thresholds.MaxLatencyP95Milliseconds > 0 &&
			metrics.LatencyP95Milliseconds > thresholds.MaxLatencyP95Milliseconds {
			alerts = append(alerts, RoutingOperationalAlert{
				Code:       "provider.latency_p95_high",
				Severity:   RoutingAlertWarning,
				ProviderID: providerID,
				Observed:   int64(metrics.LatencyP95Milliseconds),
				Threshold:  int64(thresholds.MaxLatencyP95Milliseconds),
			})
		}

		if metrics.CostMicrounitsPerMinute < 0 {
			alerts = append(alerts, providerStateAlert(
				"provider.cost_rate_invalid", RoutingAlertCritical, providerID, metrics.CostMicrounitsPerMinute))
		} else if thresholds.MaxCostMicrounitsPerMinute > 0 &&
			metrics.CostMicrounitsPerMinute > thresholds.MaxCostMicrounitsPerMinute {
			alerts = append(alerts, RoutingOperationalAlert{
				Code:       "provider.cost_rate_high",
				Severity:   RoutingAlertWarning,
				ProviderID: providerID,
				Observed:   metrics.CostMicrounitsPerMinute,
				Threshold:  thresholds.MaxCostMicrounitsPerMinute,
			})
		}
	}

	return alerts
}

func providerStateAlert(
	code string,
	severity RoutingAlertSeverity,
	providerID string,
	observed int64,
) RoutingOperationalAlert {
	return RoutingOperationalAlert{
		Code:       code,
		Severity:   severity,
		ProviderID: providerID,
		Observed:   observed,
	}
}

func routingBasisPoints(numerator uint64, denominator uint64) uint32 {
	if numerator == 0 || denominator == 0 {
		return 0
	}
	if numerator >= denominator {
		return uint32(routingBasisPointsScale)
	}

	hi, lo := bits.Mul64(numerator, routingBasisPointsScale)
	quotient, _ := bits.Div64(hi, lo, denominator)
	if quotient > routingBasisPointsScale {
		quotient = routingBasisPointsScale
	}
	return uint32(quotient)
}

func weightedRateContribution(cost int64, shareBasisPoints uint32) int64 {
	if cost <= 0 || shareBasisPoints == 0 {
		return 0
	}
	value := new(big.Int).Mul(
		new(big.Int).SetInt64(cost),
		new(big.Int).SetUint64(uint64(shareBasisPoints)),
	)
	value.Quo(value, new(big.Int).SetUint64(routingBasisPointsScale))
	if !value.IsInt64() {
		return math.MaxInt64
	}
	return value.Int64()
}

func saturatedAddUint64(left uint64, right uint64) uint64 {
	if math.MaxUint64-left < right {
		return math.MaxUint64
	}
	return left + right
}

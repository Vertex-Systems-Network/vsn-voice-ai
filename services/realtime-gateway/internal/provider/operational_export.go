package provider

import "strconv"

const RoutingOperationalExportSchemaVersion uint32 = 1

// RoutingOperationalExport is the cross-service/browser-safe representation of
// RoutingOperationalSnapshot. Values that can exceed JavaScript's safe integer
// range are encoded as base-10 strings so consumers cannot silently lose
// precision when decoding JSON.
type RoutingOperationalExport struct {
	SchemaVersion   uint32                         `json:"schema_version"`
	RouteAttempts   string                         `json:"route_attempts"`
	TotalSelections string                         `json:"total_selections"`
	NoEligibleCount string                         `json:"no_eligible_count"`
	WarningCount    uint32                         `json:"warning_count"`
	CriticalCount   uint32                         `json:"critical_count"`
	CostControl     RoutingCostControlExport       `json:"cost_control"`
	Alerts          []RoutingOperationalAlertExport `json:"alerts"`
}

type RoutingCostControlExport struct {
	TotalSelections                        string                      `json:"total_selections"`
	NoEligibleCount                        string                      `json:"no_eligible_count"`
	NoEligibleBasisPoints                  uint32                      `json:"no_eligible_basis_points"`
	AverageSelectedCostMicrounitsPerMinute string                      `json:"average_selected_cost_microunits_per_minute"`
	ByProvider                             []ProviderCostControlExport `json:"by_provider"`
}

type ProviderCostControlExport struct {
	ProviderID                         string         `json:"provider_id"`
	SelectionCount                     string         `json:"selection_count"`
	SelectionShareBasisPoints          uint32         `json:"selection_share_basis_points"`
	CostMicrounitsPerMinute            string         `json:"cost_microunits_per_minute"`
	WeightedCostContributionMicrounits string         `json:"weighted_cost_contribution_microunits_per_minute"`
	LatencyP95Milliseconds             string         `json:"latency_p95_ms"`
	Health                             HealthState    `json:"health"`
	RateLimit                          RateLimitState `json:"rate_limit"`
}

type RoutingOperationalAlertExport struct {
	Code       string               `json:"code"`
	Severity   RoutingAlertSeverity `json:"severity"`
	ProviderID string               `json:"provider_id,omitempty"`
	Observed   string               `json:"observed"`
	Threshold  string               `json:"threshold,omitempty"`
}

// ExportRoutingOperationalSnapshot preserves the internal snapshot semantics
// while converting potentially unsafe integer values to exact decimal strings.
func ExportRoutingOperationalSnapshot(snapshot RoutingOperationalSnapshot) RoutingOperationalExport {
	providers := make([]ProviderCostControlExport, 0, len(snapshot.CostControl.ByProvider))
	for _, provider := range snapshot.CostControl.ByProvider {
		providers = append(providers, ProviderCostControlExport{
			ProviderID:                         provider.ProviderID,
			SelectionCount:                     strconv.FormatUint(provider.SelectionCount, 10),
			SelectionShareBasisPoints:          provider.SelectionShareBasisPoints,
			CostMicrounitsPerMinute:            strconv.FormatInt(provider.CostMicrounitsPerMinute, 10),
			WeightedCostContributionMicrounits: strconv.FormatInt(provider.WeightedCostContributionMicrounits, 10),
			LatencyP95Milliseconds:             strconv.Itoa(provider.LatencyP95Milliseconds),
			Health:                             provider.Health,
			RateLimit:                          provider.RateLimit,
		})
	}

	alerts := make([]RoutingOperationalAlertExport, 0, len(snapshot.Alerts))
	for _, alert := range snapshot.Alerts {
		exported := RoutingOperationalAlertExport{
			Code:       alert.Code,
			Severity:   alert.Severity,
			ProviderID: alert.ProviderID,
			Observed:   strconv.FormatInt(alert.Observed, 10),
		}
		if alert.Threshold != 0 {
			exported.Threshold = strconv.FormatInt(alert.Threshold, 10)
		}
		alerts = append(alerts, exported)
	}

	return RoutingOperationalExport{
		SchemaVersion:   RoutingOperationalExportSchemaVersion,
		RouteAttempts:   strconv.FormatUint(snapshot.RouteAttempts, 10),
		TotalSelections: strconv.FormatUint(snapshot.TotalSelections, 10),
		NoEligibleCount: strconv.FormatUint(snapshot.NoEligibleCount, 10),
		WarningCount:    snapshot.WarningCount,
		CriticalCount:   snapshot.CriticalCount,
		CostControl: RoutingCostControlExport{
			TotalSelections:                        strconv.FormatUint(snapshot.CostControl.TotalSelections, 10),
			NoEligibleCount:                        strconv.FormatUint(snapshot.CostControl.NoEligibleCount, 10),
			NoEligibleBasisPoints:                  snapshot.CostControl.NoEligibleBasisPoints,
			AverageSelectedCostMicrounitsPerMinute: strconv.FormatInt(snapshot.CostControl.AverageSelectedCostMicrounitsPerMinute, 10),
			ByProvider:                             providers,
		},
		Alerts: alerts,
	}
}

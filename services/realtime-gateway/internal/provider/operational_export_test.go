package provider

import (
	"encoding/json"
	"math"
	"testing"
)

func TestExportRoutingOperationalSnapshotPreserves64BitPrecision(t *testing.T) {
	snapshot := RoutingOperationalSnapshot{
		SchemaVersion:   RoutingOperationalSnapshotSchemaVersion,
		RouteAttempts:   math.MaxUint64,
		TotalSelections: math.MaxUint64 - 1,
		NoEligibleCount: 1,
		WarningCount:    1,
		CriticalCount:   1,
		CostControl: RoutingCostControlSummary{
			TotalSelections:                        math.MaxUint64 - 1,
			NoEligibleCount:                        1,
			NoEligibleBasisPoints:                  1,
			AverageSelectedCostMicrounitsPerMinute: math.MaxInt64,
			ByProvider: []ProviderCostControl{
				{
					ProviderID:                         "provider-a",
					SelectionCount:                     math.MaxUint64 - 1,
					SelectionShareBasisPoints:          10_000,
					CostMicrounitsPerMinute:            math.MaxInt64,
					WeightedCostContributionMicrounits: math.MaxInt64,
					LatencyP95Milliseconds:             275,
					Health:                             HealthHealthy,
					RateLimit:                          RateLimitAvailable,
				},
			},
		},
		Alerts: []RoutingOperationalAlert{
			{
				Code:       "provider.cost_rate_invalid",
				Severity:   RoutingAlertCritical,
				ProviderID: "provider-b",
				Observed:   math.MinInt64,
			},
			{
				Code:      "provider.cost_rate_high",
				Severity:  RoutingAlertWarning,
				Observed:  math.MaxInt64,
				Threshold: math.MaxInt64 - 1,
			},
		},
	}

	exported := ExportRoutingOperationalSnapshot(snapshot)
	if exported.RouteAttempts != "18446744073709551615" {
		t.Fatalf("route attempts lost precision: %q", exported.RouteAttempts)
	}
	if exported.TotalSelections != "18446744073709551614" {
		t.Fatalf("total selections lost precision: %q", exported.TotalSelections)
	}
	if exported.CostControl.AverageSelectedCostMicrounitsPerMinute != "9223372036854775807" {
		t.Fatalf("average cost lost precision: %q", exported.CostControl.AverageSelectedCostMicrounitsPerMinute)
	}
	if exported.CostControl.ByProvider[0].SelectionCount != "18446744073709551614" {
		t.Fatalf("provider selection count lost precision: %q", exported.CostControl.ByProvider[0].SelectionCount)
	}
	if exported.Alerts[0].Observed != "-9223372036854775808" {
		t.Fatalf("signed alert observation lost precision: %q", exported.Alerts[0].Observed)
	}
	if exported.Alerts[0].Threshold != "" {
		t.Fatalf("zero threshold should stay omitted, got %q", exported.Alerts[0].Threshold)
	}
	if exported.Alerts[1].Threshold != "9223372036854775806" {
		t.Fatalf("alert threshold lost precision: %q", exported.Alerts[1].Threshold)
	}

	payload, err := json.Marshal(exported)
	if err != nil {
		t.Fatalf("marshal export: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if _, ok := decoded["route_attempts"].(string); !ok {
		t.Fatalf("route_attempts must cross JSON boundary as string: %#v", decoded["route_attempts"])
	}
}

func TestExportRoutingOperationalSnapshotCopiesSlices(t *testing.T) {
	snapshot := RoutingOperationalSnapshot{
		CostControl: RoutingCostControlSummary{
			ByProvider: []ProviderCostControl{{ProviderID: "provider-a"}},
		},
		Alerts: []RoutingOperationalAlert{{Code: "provider.health_degraded", Severity: RoutingAlertWarning}},
	}

	exported := ExportRoutingOperationalSnapshot(snapshot)
	snapshot.CostControl.ByProvider[0].ProviderID = "mutated-provider"
	snapshot.Alerts[0].Code = "mutated-alert"

	if exported.CostControl.ByProvider[0].ProviderID != "provider-a" {
		t.Fatalf("provider export aliases internal slice: %#v", exported.CostControl.ByProvider)
	}
	if exported.Alerts[0].Code != "provider.health_degraded" {
		t.Fatalf("alert export aliases internal slice: %#v", exported.Alerts)
	}
}

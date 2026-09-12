package provider

import (
	"math"
	"reflect"
	"testing"
)

func TestBuildRoutingCostControlSummaryIsDeterministicAndWeighted(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: 4,
		NoEligibleCount: 1,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-b": {
				ProviderID:              "provider-b",
				SelectionCount:          1,
				LatencyP95Milliseconds:  240,
				CostMicrounitsPerMinute: 700,
				Health:                  HealthDegraded,
				RateLimit:               RateLimitConstrained,
			},
			"provider-a": {
				ProviderID:              "provider-a",
				SelectionCount:          3,
				LatencyP95Milliseconds:  80,
				CostMicrounitsPerMinute: 100,
				Health:                  HealthHealthy,
				RateLimit:               RateLimitAvailable,
			},
		},
	}

	summary := BuildRoutingCostControlSummary(snapshot)
	if summary.TotalSelections != 4 || summary.NoEligibleCount != 1 {
		t.Fatalf("unexpected totals: %#v", summary)
	}
	if summary.NoEligibleBasisPoints != 2000 {
		t.Fatalf("expected 20%% no-eligible rate, got %d basis points", summary.NoEligibleBasisPoints)
	}
	if summary.AverageSelectedCostMicrounitsPerMinute != 250 {
		t.Fatalf("expected selection-weighted average cost rate 250, got %d", summary.AverageSelectedCostMicrounitsPerMinute)
	}
	if len(summary.ByProvider) != 2 {
		t.Fatalf("expected two providers, got %d", len(summary.ByProvider))
	}
	if summary.ByProvider[0].ProviderID != "provider-a" || summary.ByProvider[1].ProviderID != "provider-b" {
		t.Fatalf("provider output must be deterministic: %#v", summary.ByProvider)
	}
	if summary.ByProvider[0].SelectionShareBasisPoints != 7500 ||
		summary.ByProvider[1].SelectionShareBasisPoints != 2500 {
		t.Fatalf("unexpected selection shares: %#v", summary.ByProvider)
	}
	if summary.ByProvider[0].WeightedCostContributionMicrounits != 75 ||
		summary.ByProvider[1].WeightedCostContributionMicrounits != 175 {
		t.Fatalf("unexpected weighted cost contributions: %#v", summary.ByProvider)
	}
}

func TestBuildRoutingCostControlSummaryClampsInvalidCostAndLargeAverage(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: 2,
		ByProvider: map[string]ProviderRoutingMetrics{
			"negative": {
				ProviderID:              "negative",
				SelectionCount:          1,
				CostMicrounitsPerMinute: -10,
			},
			"huge": {
				ProviderID:              "huge",
				SelectionCount:          1,
				CostMicrounitsPerMinute: math.MaxInt64,
			},
		},
	}

	summary := BuildRoutingCostControlSummary(snapshot)
	if summary.ByProvider[1].ProviderID != "negative" || summary.ByProvider[1].CostMicrounitsPerMinute != 0 {
		t.Fatalf("negative operational rate must clamp to zero in summary: %#v", summary.ByProvider)
	}
	if summary.AverageSelectedCostMicrounitsPerMinute != math.MaxInt64/2 {
		t.Fatalf("unexpected large weighted average: %d", summary.AverageSelectedCostMicrounitsPerMinute)
	}
}

func TestEvaluateRoutingOperationalAlerts(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: 8,
		NoEligibleCount: 2,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-b": {
				ProviderID:              "provider-b",
				SelectionCount:          2,
				LatencyP95Milliseconds:  600,
				CostMicrounitsPerMinute: 900,
				Health:                  HealthUnhealthy,
				RateLimit:               RateLimitExhausted,
			},
			"provider-a": {
				ProviderID:              "provider-a",
				SelectionCount:          6,
				LatencyP95Milliseconds:  120,
				CostMicrounitsPerMinute: 200,
				Health:                  HealthHealthy,
				RateLimit:               RateLimitAvailable,
			},
		},
	}

	alerts := EvaluateRoutingOperationalAlerts(snapshot, RoutingOperationalThresholds{
		MaxLatencyP95Milliseconds:  300,
		MaxCostMicrounitsPerMinute: 500,
		MaxNoEligibleBasisPoints:   1000,
		MinRouteAttempts:           5,
	})

	wantCodes := []string{
		"routing.no_eligible_rate_high",
		"provider.health_unhealthy",
		"provider.rate_limit_exhausted",
		"provider.latency_p95_high",
		"provider.cost_rate_high",
	}
	if len(alerts) != len(wantCodes) {
		t.Fatalf("unexpected alerts: %#v", alerts)
	}
	for i, want := range wantCodes {
		if alerts[i].Code != want {
			t.Fatalf("alert order/code mismatch at %d: got %q want %q", i, alerts[i].Code, want)
		}
	}
	if alerts[0].Observed != 2000 || alerts[0].Threshold != 1000 {
		t.Fatalf("unexpected no-eligible alert: %#v", alerts[0])
	}
}

func TestEvaluateRoutingOperationalAlertsRespectsMinimumAttempts(t *testing.T) {
	alerts := EvaluateRoutingOperationalAlerts(RoutingMetricsSnapshot{
		TotalSelections: 0,
		NoEligibleCount: 1,
		ByProvider:      map[string]ProviderRoutingMetrics{},
	}, RoutingOperationalThresholds{
		MaxNoEligibleBasisPoints: 100,
		MinRouteAttempts:         5,
	})
	if len(alerts) != 0 {
		t.Fatalf("small sample must not emit no-eligible rate alert: %#v", alerts)
	}
}

func TestNegativeCostEmitsCriticalAlert(t *testing.T) {
	alerts := EvaluateRoutingOperationalAlerts(RoutingMetricsSnapshot{
		TotalSelections: 1,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-a": {
				ProviderID:              "provider-a",
				SelectionCount:          1,
				CostMicrounitsPerMinute: -1,
			},
		},
	}, RoutingOperationalThresholds{})
	if len(alerts) != 1 || alerts[0].Code != "provider.cost_rate_invalid" || alerts[0].Severity != RoutingAlertCritical {
		t.Fatalf("negative cost must fail closed into critical operational alert: %#v", alerts)
	}
}

func TestRoutingOperationalAlertSurfaceCannotCarryCustomerContent(t *testing.T) {
	typeOf := reflect.TypeOf(RoutingOperationalAlert{})
	want := map[string]bool{
		"Code":       true,
		"Severity":   true,
		"ProviderID": true,
		"Observed":   true,
		"Threshold":  true,
	}
	if typeOf.NumField() != len(want) {
		t.Fatalf("alert field surface changed: %d fields", typeOf.NumField())
	}
	for i := 0; i < typeOf.NumField(); i++ {
		field := typeOf.Field(i)
		if !want[field.Name] {
			t.Fatalf("unexpected alert field %q may widen telemetry surface", field.Name)
		}
	}
}

func TestRoutingBasisPointsHandlesMaximumCountersWithoutOverflow(t *testing.T) {
	if got := routingBasisPoints(math.MaxUint64-1, math.MaxUint64); got != 9999 {
		t.Fatalf("expected 9999 basis points, got %d", got)
	}
	if got := routingBasisPoints(math.MaxUint64, math.MaxUint64); got != 10000 {
		t.Fatalf("expected 10000 basis points, got %d", got)
	}
}

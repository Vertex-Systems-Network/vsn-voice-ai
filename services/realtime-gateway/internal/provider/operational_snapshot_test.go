package provider

import (
	"reflect"
	"testing"
)

func TestBuildRoutingOperationalSnapshotComposesDeterministically(t *testing.T) {
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

	result := BuildRoutingOperationalSnapshot(snapshot, RoutingOperationalThresholds{
		MaxLatencyP95Milliseconds:  300,
		MaxCostMicrounitsPerMinute: 500,
		MaxNoEligibleBasisPoints:   1000,
		MinRouteAttempts:           5,
	})

	if result.SchemaVersion != 1 {
		t.Fatalf("unexpected schema version: %d", result.SchemaVersion)
	}
	if result.RouteAttempts != 10 || result.TotalSelections != 8 || result.NoEligibleCount != 2 {
		t.Fatalf("unexpected route totals: %#v", result)
	}
	if result.WarningCount != 2 || result.CriticalCount != 3 {
		t.Fatalf("unexpected alert severity counts: %#v", result)
	}
	if result.CostControl.AverageSelectedCostMicrounitsPerMinute != 375 {
		t.Fatalf("unexpected average selected cost: %#v", result.CostControl)
	}
	if len(result.CostControl.ByProvider) != 2 ||
		result.CostControl.ByProvider[0].ProviderID != "provider-a" ||
		result.CostControl.ByProvider[1].ProviderID != "provider-b" {
		t.Fatalf("provider ordering drifted: %#v", result.CostControl.ByProvider)
	}

	wantCodes := []string{
		"routing.no_eligible_rate_high",
		"provider.health_unhealthy",
		"provider.rate_limit_exhausted",
		"provider.latency_p95_high",
		"provider.cost_rate_high",
	}
	if len(result.Alerts) != len(wantCodes) {
		t.Fatalf("unexpected alerts: %#v", result.Alerts)
	}
	for index, want := range wantCodes {
		if result.Alerts[index].Code != want {
			t.Fatalf("alert order/code mismatch at %d: got %q want %q", index, result.Alerts[index].Code, want)
		}
	}
}

func TestRoutingOperationalSnapshotHasClosedContentSafeFieldSurface(t *testing.T) {
	typeOfSnapshot := reflect.TypeOf(RoutingOperationalSnapshot{})
	want := []string{
		"SchemaVersion",
		"RouteAttempts",
		"TotalSelections",
		"NoEligibleCount",
		"WarningCount",
		"CriticalCount",
		"CostControl",
		"Alerts",
	}

	if typeOfSnapshot.NumField() != len(want) {
		t.Fatalf("snapshot field surface widened: got %d fields want %d", typeOfSnapshot.NumField(), len(want))
	}
	for index, fieldName := range want {
		if typeOfSnapshot.Field(index).Name != fieldName {
			t.Fatalf("snapshot field surface drifted at %d: got %s want %s", index, typeOfSnapshot.Field(index).Name, fieldName)
		}
	}
}

func TestBuildRoutingOperationalSnapshotDoesNotAliasAlertSlice(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: 1,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-a": {
				ProviderID:              "provider-a",
				SelectionCount:          1,
				LatencyP95Milliseconds:  900,
				CostMicrounitsPerMinute: 10,
				Health:                  HealthHealthy,
				RateLimit:               RateLimitAvailable,
			},
		},
	}

	first := BuildRoutingOperationalSnapshot(snapshot, RoutingOperationalThresholds{
		MaxLatencyP95Milliseconds: 100,
	})
	second := BuildRoutingOperationalSnapshot(snapshot, RoutingOperationalThresholds{
		MaxLatencyP95Milliseconds: 100,
	})
	if len(first.Alerts) != 1 || len(second.Alerts) != 1 {
		t.Fatalf("expected one alert from each snapshot")
	}
	first.Alerts[0].Code = "mutated"
	if second.Alerts[0].Code != "provider.latency_p95_high" {
		t.Fatalf("independent snapshot mutated through shared alert storage: %#v", second.Alerts)
	}
}

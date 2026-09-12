package provider

import (
	"math"
	"reflect"
	"testing"
)

func TestBuildRoutingMetricPointsUsesClosedContentSafeAttributes(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: 2,
		NoEligibleCount: 1,
		ByProvider: map[string]ProviderRoutingMetrics{
			"primary": {
				ProviderID:                  "primary",
				SelectionCount:              2,
				LatencyP95Milliseconds:      42,
				CostMicrounitsPerMinute:     125,
				Health:                      HealthHealthy,
				RateLimit:                   RateLimitAvailable,
			},
		},
	}

	points := BuildRoutingMetricPoints(snapshot)
	if len(points) != 4 {
		t.Fatalf("expected four points, got %d: %#v", len(points), points)
	}

	allowedAttributeKeys := map[string]bool{
		"provider.id":         true,
		"provider.health":     true,
		"provider.rate_limit": true,
	}
	for _, point := range points {
		for key := range point.Attributes {
			if !allowedAttributeKeys[key] {
				t.Fatalf("unsafe/unreviewed metric attribute key %q in %#v", key, point)
			}
		}
	}
}

func TestBuildRoutingMetricPointsCarriesOperationalValues(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		NoEligibleCount: 3,
		ByProvider: map[string]ProviderRoutingMetrics{
			"primary": {
				SelectionCount:              7,
				LatencyP95Milliseconds:      51,
				CostMicrounitsPerMinute:     900,
				Health:                      HealthDegraded,
				RateLimit:                   RateLimitConstrained,
			},
		},
	}

	points := BuildRoutingMetricPoints(snapshot)
	values := make(map[string]int64, len(points))
	for _, point := range points {
		values[point.Name] = point.Value
	}

	if values[RoutingMetricNoEligibleName] != 3 {
		t.Fatalf("unexpected no-eligible value: %d", values[RoutingMetricNoEligibleName])
	}
	if values[RoutingMetricSelectionsName] != 7 {
		t.Fatalf("unexpected selection value: %d", values[RoutingMetricSelectionsName])
	}
	if values[RoutingMetricLatencyP95Name] != 51 {
		t.Fatalf("unexpected latency value: %d", values[RoutingMetricLatencyP95Name])
	}
	if values[RoutingMetricCostName] != 900 {
		t.Fatalf("unexpected cost value: %d", values[RoutingMetricCostName])
	}
}

func TestBuildRoutingMetricPointsCopiesAttributesPerPoint(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		ByProvider: map[string]ProviderRoutingMetrics{
			"primary": {
				SelectionCount: 1,
				Health:         HealthHealthy,
				RateLimit:      RateLimitAvailable,
			},
		},
	}

	points := BuildRoutingMetricPoints(snapshot)
	var attributed []RoutingMetricPoint
	for _, point := range points {
		if point.Attributes != nil {
			attributed = append(attributed, point)
		}
	}
	if len(attributed) != 3 {
		t.Fatalf("expected three attributed points, got %d", len(attributed))
	}

	attributed[0].Attributes["provider.id"] = "mutated"
	if attributed[1].Attributes["provider.id"] != "primary" || attributed[2].Attributes["provider.id"] != "primary" {
		t.Fatal("attribute mutation leaked across metric points")
	}
}

func TestRoutingMetricPointSurfaceHasNoFreeFormContentFields(t *testing.T) {
	allowed := map[string]bool{
		"Name":       true,
		"Kind":       true,
		"Unit":       true,
		"Value":      true,
		"Attributes": true,
	}
	metricType := reflect.TypeOf(RoutingMetricPoint{})
	for i := 0; i < metricType.NumField(); i++ {
		if !allowed[metricType.Field(i).Name] {
			t.Fatalf("unsafe/unreviewed metric point field: %s", metricType.Field(i).Name)
		}
	}
}

func TestUint64ToInt64Saturated(t *testing.T) {
	if got := uint64ToInt64Saturated(42); got != 42 {
		t.Fatalf("unexpected conversion: %d", got)
	}
	if got := uint64ToInt64Saturated(math.MaxUint64); got != math.MaxInt64 {
		t.Fatalf("expected saturation to MaxInt64, got %d", got)
	}
}

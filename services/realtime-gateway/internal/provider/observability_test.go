package provider

import (
	"reflect"
	"testing"
)

func TestProviderRoutingMetricsObserverAttributesProviderCostAndLatency(t *testing.T) {
	registry := NewRegistry()
	primary := manifest("primary", 42, 95, 90, 125)
	fallback := manifest("fallback", 80, 90, 85, 75)
	mustRegister(t, registry, primary, fallback)

	observer := NewProviderRoutingMetricsObserver(registry)
	router := NewRouter(registry, observer)
	decision, err := router.Select(RoutingRequest{
		Capability:            CapabilityNoiseCancel,
		Mode:                  RoutingLowestLatency,
		RequireVerifiedAccess: true,
	})
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if decision.SelectedProvider != "primary" {
		t.Fatalf("expected primary, got %s", decision.SelectedProvider)
	}

	snapshot := observer.Snapshot()
	if snapshot.TotalSelections != 1 || snapshot.NoEligibleCount != 0 {
		t.Fatalf("unexpected counters: %#v", snapshot)
	}
	metrics, ok := snapshot.ByProvider["primary"]
	if !ok {
		t.Fatalf("missing primary provider metrics: %#v", snapshot.ByProvider)
	}
	if metrics.SelectionCount != 1 || metrics.LatencyP95Milliseconds != 42 || metrics.CostMicrounitsPerMinute != 125 {
		t.Fatalf("unexpected provider attribution: %#v", metrics)
	}
	if metrics.Health != HealthHealthy || metrics.RateLimit != RateLimitAvailable {
		t.Fatalf("unexpected provider state attribution: %#v", metrics)
	}
}

func TestProviderRoutingMetricsObserverTracksNoEligibleWithoutProviderData(t *testing.T) {
	registry := NewRegistry()
	observer := NewProviderRoutingMetricsObserver(registry)

	_, err := NewRouter(registry, observer).Select(RoutingRequest{
		Capability: CapabilityAccentConvert,
		Mode:       RoutingAuto,
	})
	if err == nil {
		t.Fatal("expected no eligible provider error")
	}

	snapshot := observer.Snapshot()
	if snapshot.TotalSelections != 0 || snapshot.NoEligibleCount != 1 {
		t.Fatalf("unexpected counters: %#v", snapshot)
	}
	if len(snapshot.ByProvider) != 0 {
		t.Fatalf("no-eligible route must not attribute provider data: %#v", snapshot.ByProvider)
	}
}

func TestProviderRoutingMetricsSnapshotIsCopyIsolated(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry, manifest("primary", 42, 95, 90, 125))
	observer := NewProviderRoutingMetricsObserver(registry)
	if _, err := NewRouter(registry, observer).Select(RoutingRequest{Capability: CapabilityNoiseCancel}); err != nil {
		t.Fatalf("select: %v", err)
	}

	first := observer.Snapshot()
	delete(first.ByProvider, "primary")
	second := observer.Snapshot()
	if _, ok := second.ByProvider["primary"]; !ok {
		t.Fatal("snapshot mutation leaked into observer state")
	}
}

func TestProviderRoutingMetricsFieldsRemainContentSafe(t *testing.T) {
	allowedMetricFields := map[string]bool{
		"ProviderID":              true,
		"SelectionCount":          true,
		"LatencyP95Milliseconds":  true,
		"CostMicrounitsPerMinute": true,
		"Health":                  true,
		"RateLimit":               true,
	}
	metricType := reflect.TypeOf(ProviderRoutingMetrics{})
	for i := 0; i < metricType.NumField(); i++ {
		if !allowedMetricFields[metricType.Field(i).Name] {
			t.Fatalf("unsafe/unreviewed provider metric field: %s", metricType.Field(i).Name)
		}
	}

	allowedSnapshotFields := map[string]bool{
		"TotalSelections": true,
		"NoEligibleCount": true,
		"ByProvider":      true,
	}
	snapshotType := reflect.TypeOf(RoutingMetricsSnapshot{})
	for i := 0; i < snapshotType.NumField(); i++ {
		if !allowedSnapshotFields[snapshotType.Field(i).Name] {
			t.Fatalf("unsafe/unreviewed snapshot field: %s", snapshotType.Field(i).Name)
		}
	}
}

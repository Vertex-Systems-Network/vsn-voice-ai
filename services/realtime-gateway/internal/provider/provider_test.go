package provider

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

func manifest(id string, latency int, quality int, privacy int, cost int64) ProviderManifest {
	return ProviderManifest{
		ID:                      id,
		Version:                 "1",
		AccessMode:              AccessAPI,
		Capabilities:            []Capability{CapabilityNoiseCancel, CapabilityAccentConvert},
		Regions:                 []string{"us-east", "eu-west"},
		Enabled:                 true,
		VerifiedAccess:          true,
		Health:                  HealthHealthy,
		LatencyP95Milliseconds:  latency,
		QualityScore:            quality,
		PrivacyScore:            privacy,
		CostMicrounitsPerMinute: cost,
	}
}

func mustRegister(t *testing.T, registry *Registry, manifests ...ProviderManifest) {
	t.Helper()
	for _, item := range manifests {
		if err := registry.Register(item); err != nil {
			t.Fatalf("register %s: %v", item.ID, err)
		}
	}
}

func TestRegistryRejectsInvalidManifest(t *testing.T) {
	registry := NewRegistry()
	if err := registry.Register(ProviderManifest{}); !errors.Is(err, ErrInvalidProvider) {
		t.Fatalf("expected ErrInvalidProvider, got %v", err)
	}
}

func TestRegistryCopiesSlices(t *testing.T) {
	registry := NewRegistry()
	item := manifest("alpha", 100, 90, 80, 20)
	mustRegister(t, registry, item)

	copyOne, ok := registry.Get("alpha")
	if !ok {
		t.Fatal("provider missing")
	}
	copyOne.Capabilities[0] = CapabilityAgentAction

	copyTwo, _ := registry.Get("alpha")
	if copyTwo.Capabilities[0] == CapabilityAgentAction {
		t.Fatal("registry leaked mutable capability slice")
	}
}

func TestRouterUsesPolicyAndReturnsFallbacks(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry,
		manifest("fast", 60, 80, 70, 40),
		manifest("quality", 140, 98, 80, 30),
		manifest("private", 120, 88, 99, 25),
	)
	router := NewRouter(registry)

	tests := []struct {
		name     string
		mode     RoutingMode
		expected string
	}{
		{"latency", RoutingLowestLatency, "fast"},
		{"quality", RoutingBestQuality, "quality"},
		{"privacy", RoutingBestPrivacy, "private"},
		{"cost", RoutingLowestCost, "private"},
		{"auto", RoutingAuto, "quality"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			decision, err := router.Select(RoutingRequest{
				Capability:            CapabilityNoiseCancel,
				Mode:                  tc.mode,
				RequireVerifiedAccess: true,
			})
			if err != nil {
				t.Fatalf("select: %v", err)
			}
			if decision.SelectedProvider != tc.expected {
				t.Fatalf("expected %s, got %s", tc.expected, decision.SelectedProvider)
			}
			if len(decision.FallbackProviders) != 2 {
				t.Fatalf("expected 2 fallbacks, got %d", len(decision.FallbackProviders))
			}
		})
	}
}

func TestRouterEnforcesEligibility(t *testing.T) {
	registry := NewRegistry()
	good := manifest("good", 90, 90, 90, 20)
	unverified := manifest("unverified", 50, 99, 99, 1)
	unverified.VerifiedAccess = false
	unhealthy := manifest("unhealthy", 40, 99, 99, 1)
	unhealthy.Health = HealthUnhealthy
	wrongRegion := manifest("wrong-region", 30, 99, 99, 1)
	wrongRegion.Regions = []string{"ap-south"}
	mustRegister(t, registry, good, unverified, unhealthy, wrongRegion)

	decision, err := NewRouter(registry).Select(RoutingRequest{
		Capability:             CapabilityAccentConvert,
		Mode:                   RoutingLowestLatency,
		RequiredRegion:         "us-east",
		AllowedProviders:       []string{"good", "unverified", "unhealthy", "wrong-region"},
		DeniedProviders:        []string{"never"},
		MaxLatencyMilliseconds: 100,
		MinQualityScore:        80,
		RequireVerifiedAccess:  true,
	})
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if decision.SelectedProvider != "good" {
		t.Fatalf("expected good, got %s", decision.SelectedProvider)
	}
}

func TestRouterReturnsNoEligibleProvider(t *testing.T) {
	registry := NewRegistry()
	item := manifest("alpha", 100, 90, 90, 20)
	item.Enabled = false
	mustRegister(t, registry, item)

	_, err := NewRouter(registry).Select(RoutingRequest{Capability: CapabilityNoiseCancel})
	if !errors.Is(err, ErrNoEligibleProvider) {
		t.Fatalf("expected ErrNoEligibleProvider, got %v", err)
	}
}

func TestCircuitBreakerOpensAndRecovers(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry, manifest("alpha", 100, 90, 90, 20))
	tracker := NewHealthTracker(registry, BreakerConfig{FailureThreshold: 2, OpenDuration: time.Second})
	now := time.Unix(1000, 0)

	if err := tracker.RecordFailure("alpha", now); err != nil {
		t.Fatalf("first failure: %v", err)
	}
	state, _ := registry.Get("alpha")
	if state.Health != HealthDegraded {
		t.Fatalf("expected degraded, got %s", state.Health)
	}

	if err := tracker.RecordFailure("alpha", now.Add(time.Millisecond)); err != nil {
		t.Fatalf("second failure: %v", err)
	}
	state, _ = registry.Get("alpha")
	if state.Health != HealthOpen {
		t.Fatalf("expected circuit open, got %s", state.Health)
	}

	_, err := NewRouter(registry).Select(RoutingRequest{Capability: CapabilityNoiseCancel})
	if !errors.Is(err, ErrNoEligibleProvider) {
		t.Fatalf("open circuit should be ineligible, got %v", err)
	}

	if err := tracker.Refresh("alpha", now.Add(2*time.Second)); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	state, _ = registry.Get("alpha")
	if state.Health != HealthDegraded {
		t.Fatalf("expected degraded after cooldown, got %s", state.Health)
	}

	if err := tracker.RecordSuccess("alpha"); err != nil {
		t.Fatalf("success: %v", err)
	}
	state, _ = registry.Get("alpha")
	if state.Health != HealthHealthy {
		t.Fatalf("expected healthy, got %s", state.Health)
	}
}

func TestFallbackOrderIsDeterministic(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry,
		manifest("charlie", 100, 90, 90, 10),
		manifest("alpha", 100, 90, 90, 10),
		manifest("bravo", 100, 90, 90, 10),
	)
	decision, err := NewRouter(registry).Select(RoutingRequest{Capability: CapabilityNoiseCancel, Mode: RoutingAuto})
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if decision.SelectedProvider != "alpha" {
		t.Fatalf("expected alpha, got %s", decision.SelectedProvider)
	}
	if !reflect.DeepEqual(decision.FallbackProviders, []string{"bravo", "charlie"}) {
		t.Fatalf("unexpected fallback order: %#v", decision.FallbackProviders)
	}
}

package provider

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

type staticAdapter struct {
	manifest ProviderManifest
}

func (a staticAdapter) Manifest() ProviderManifest {
	return a.manifest
}

type recordingObserver struct {
	events []RoutingEvent
}

func (o *recordingObserver) ObserveRouting(event RoutingEvent) {
	o.events = append(o.events, event)
}

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
		RateLimit:               RateLimitAvailable,
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

func TestExternalAndVSNAdaptersUseSameRegistrationContract(t *testing.T) {
	registry := NewRegistry()
	external := manifest("external-ai", 100, 90, 80, 20)
	vsn := manifest("vsn-ai", 30, 95, 100, 5)
	vsn.AccessMode = AccessInternal

	if err := registry.RegisterAdapter(staticAdapter{manifest: external}); err != nil {
		t.Fatalf("register external adapter: %v", err)
	}
	if err := registry.RegisterAdapter(staticAdapter{manifest: vsn}); err != nil {
		t.Fatalf("register VSN adapter: %v", err)
	}

	if _, ok := registry.Get("external-ai"); !ok {
		t.Fatal("external provider missing")
	}
	if _, ok := registry.Get("vsn-ai"); !ok {
		t.Fatal("VSN provider missing")
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
	exhausted := manifest("exhausted", 20, 100, 100, 1)
	exhausted.RateLimit = RateLimitExhausted
	mustRegister(t, registry, good, unverified, unhealthy, wrongRegion, exhausted)

	decision, err := NewRouter(registry).Select(RoutingRequest{
		Capability:             CapabilityAccentConvert,
		Mode:                   RoutingLowestLatency,
		RequiredRegion:         "us-east",
		AllowedProviders:       []string{"good", "unverified", "unhealthy", "wrong-region", "exhausted"},
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

func TestRateLimitStateCanRemoveProviderFromRouting(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry,
		manifest("primary", 50, 95, 90, 10),
		manifest("fallback", 100, 90, 90, 20),
	)
	if err := registry.SetRateLimit("primary", RateLimitExhausted, 0); err != nil {
		t.Fatalf("set rate limit: %v", err)
	}

	decision, err := NewRouter(registry).Select(RoutingRequest{Capability: CapabilityNoiseCancel, Mode: RoutingLowestLatency})
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if decision.SelectedProvider != "fallback" {
		t.Fatalf("expected fallback, got %s", decision.SelectedProvider)
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

func TestRoutingTelemetryContainsOnlyContentSafeRoutingMetadata(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry,
		manifest("primary", 50, 95, 90, 10),
		manifest("fallback", 100, 90, 90, 20),
	)
	observer := &recordingObserver{}
	router := NewRouter(registry, observer)

	decision, err := router.Select(RoutingRequest{Capability: CapabilityNoiseCancel, Mode: RoutingAuto})
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if len(observer.events) != 1 {
		t.Fatalf("expected one routing event, got %d", len(observer.events))
	}
	event := observer.events[0]
	if event.Outcome != RoutingOutcomeSelected || event.SelectedProvider != decision.SelectedProvider {
		t.Fatalf("unexpected routing event: %#v", event)
	}

	allowedFields := map[string]bool{
		"Capability":       true,
		"Mode":             true,
		"Outcome":          true,
		"SelectedProvider": true,
		"EligibleCount":    true,
		"FallbackCount":    true,
	}
	typeOfEvent := reflect.TypeOf(event)
	for i := 0; i < typeOfEvent.NumField(); i++ {
		if !allowedFields[typeOfEvent.Field(i).Name] {
			t.Fatalf("unsafe/unreviewed telemetry field: %s", typeOfEvent.Field(i).Name)
		}
	}
}

func TestNoEligibleProviderEmitsTelemetryWithoutProviderContent(t *testing.T) {
	registry := NewRegistry()
	observer := &recordingObserver{}
	_, err := NewRouter(registry, observer).Select(RoutingRequest{Capability: CapabilityAccentConvert, Mode: RoutingAuto})
	if !errors.Is(err, ErrNoEligibleProvider) {
		t.Fatalf("expected ErrNoEligibleProvider, got %v", err)
	}
	if len(observer.events) != 1 || observer.events[0].Outcome != RoutingOutcomeNoEligible {
		t.Fatalf("unexpected routing events: %#v", observer.events)
	}
	if observer.events[0].SelectedProvider != "" || observer.events[0].EligibleCount != 0 {
		t.Fatalf("unexpected provider metadata on no-eligible event: %#v", observer.events[0])
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

package provider

import (
	"errors"
	"testing"
)

func TestRegistryRejectsMalformedProviderStates(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ProviderManifest)
	}{
		{
			name: "unknown access mode",
			mutate: func(item *ProviderManifest) {
				item.AccessMode = AccessMode("untrusted_transport")
			},
		},
		{
			name: "unknown health state",
			mutate: func(item *ProviderManifest) {
				item.Health = HealthState("healthy_typo")
			},
		},
		{
			name: "unknown rate limit state",
			mutate: func(item *ProviderManifest) {
				item.RateLimit = RateLimitState("available_typo")
			},
		},
		{
			name: "capabilities normalize to empty",
			mutate: func(item *ProviderManifest) {
				item.Capabilities = []Capability{""}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			registry := NewRegistry()
			item := manifest("provider", 50, 90, 90, 10)
			tc.mutate(&item)
			if err := registry.Register(item); !errors.Is(err, ErrInvalidProvider) {
				t.Fatalf("expected ErrInvalidProvider, got %v", err)
			}
		})
	}
}

func TestRegistryRejectsMalformedRuntimeStateTransitions(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry, manifest("provider", 50, 90, 90, 10))

	if err := registry.SetHealth("provider", HealthState("unknown")); !errors.Is(err, ErrInvalidProvider) {
		t.Fatalf("expected invalid health state to be rejected, got %v", err)
	}
	if err := registry.SetRateLimit("provider", RateLimitState("unknown_new_state"), 0); !errors.Is(err, ErrInvalidProvider) {
		t.Fatalf("expected invalid rate-limit state to be rejected, got %v", err)
	}

	stored, ok := registry.Get("provider")
	if !ok {
		t.Fatal("provider missing after rejected transitions")
	}
	if stored.Health != HealthHealthy {
		t.Fatalf("rejected health transition mutated state to %q", stored.Health)
	}
	if stored.RateLimit != RateLimitAvailable {
		t.Fatalf("rejected rate-limit transition mutated state to %q", stored.RateLimit)
	}
}

func TestRouterRejectsMalformedRoutingPolicy(t *testing.T) {
	registry := NewRegistry()
	mustRegister(t, registry, manifest("provider", 50, 90, 90, 10))
	router := NewRouter(registry)

	tests := []struct {
		name    string
		request RoutingRequest
	}{
		{
			name: "unknown routing mode",
			request: RoutingRequest{
				Capability: CapabilityNoiseCancel,
				Mode:       RoutingMode("prefer_untrusted"),
			},
		},
		{
			name:    "empty capability",
			request: RoutingRequest{Mode: RoutingAuto},
		},
		{
			name: "negative latency constraint",
			request: RoutingRequest{
				Capability:             CapabilityNoiseCancel,
				Mode:                   RoutingAuto,
				MaxLatencyMilliseconds: -1,
			},
		},
		{
			name: "negative quality constraint",
			request: RoutingRequest{
				Capability:      CapabilityNoiseCancel,
				Mode:            RoutingAuto,
				MinQualityScore: -1,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := router.Select(tc.request); !errors.Is(err, ErrInvalidRoutingRequest) {
				t.Fatalf("expected ErrInvalidRoutingRequest, got %v", err)
			}
		})
	}
}

func TestRouterRejectsMissingRegistry(t *testing.T) {
	if _, err := NewRouter(nil).Select(RoutingRequest{
		Capability: CapabilityNoiseCancel,
		Mode:       RoutingAuto,
	}); !errors.Is(err, ErrInvalidRoutingRequest) {
		t.Fatalf("expected ErrInvalidRoutingRequest, got %v", err)
	}
}

func TestEligibilityFailsClosedForUnknownProviderState(t *testing.T) {
	item := manifest("provider", 50, 90, 90, 10)
	request := RoutingRequest{Capability: CapabilityNoiseCancel, Mode: RoutingAuto}

	item.Health = HealthState("unknown")
	if eligible(item, request) {
		t.Fatal("provider with unknown health state must not be eligible")
	}

	item.Health = HealthHealthy
	item.RateLimit = RateLimitState("unknown_new_state")
	if eligible(item, request) {
		t.Fatal("provider with unknown rate-limit state must not be eligible")
	}
}

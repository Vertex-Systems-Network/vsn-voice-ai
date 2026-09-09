package provider

import (
	"sync"
	"time"
)

type BreakerConfig struct {
	FailureThreshold int
	OpenDuration     time.Duration
}

type breakerState struct {
	failures  int
	openUntil time.Time
}

type HealthTracker struct {
	mu       sync.Mutex
	registry *Registry
	config   BreakerConfig
	states   map[string]breakerState
}

func NewHealthTracker(registry *Registry, config BreakerConfig) *HealthTracker {
	if config.FailureThreshold <= 0 {
		config.FailureThreshold = 3
	}
	if config.OpenDuration <= 0 {
		config.OpenDuration = 30 * time.Second
	}
	return &HealthTracker{
		registry: registry,
		config:   config,
		states:   make(map[string]breakerState),
	}
}

func (h *HealthTracker) RecordSuccess(providerID string) error {
	if _, ok := h.registry.Get(providerID); !ok {
		return ErrProviderNotFound
	}

	h.mu.Lock()
	delete(h.states, providerID)
	h.mu.Unlock()
	return h.registry.SetHealth(providerID, HealthHealthy)
}

func (h *HealthTracker) RecordFailure(providerID string, now time.Time) error {
	if _, ok := h.registry.Get(providerID); !ok {
		return ErrProviderNotFound
	}

	h.mu.Lock()
	state := h.states[providerID]
	if !state.openUntil.IsZero() && now.Before(state.openUntil) {
		h.mu.Unlock()
		return h.registry.SetHealth(providerID, HealthOpen)
	}
	if !state.openUntil.IsZero() && !now.Before(state.openUntil) {
		state = breakerState{}
	}
	state.failures++
	if state.failures >= h.config.FailureThreshold {
		state.openUntil = now.Add(h.config.OpenDuration)
		h.states[providerID] = state
		h.mu.Unlock()
		return h.registry.SetHealth(providerID, HealthOpen)
	}
	h.states[providerID] = state
	h.mu.Unlock()
	return h.registry.SetHealth(providerID, HealthDegraded)
}

func (h *HealthTracker) Refresh(providerID string, now time.Time) error {
	if _, ok := h.registry.Get(providerID); !ok {
		return ErrProviderNotFound
	}

	h.mu.Lock()
	state := h.states[providerID]
	if state.openUntil.IsZero() || now.Before(state.openUntil) {
		h.mu.Unlock()
		return nil
	}
	delete(h.states, providerID)
	h.mu.Unlock()
	return h.registry.SetHealth(providerID, HealthDegraded)
}

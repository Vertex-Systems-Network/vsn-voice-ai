package provider

import (
	"sort"
	"strings"
	"sync"
)

type Registry struct {
	mu        sync.RWMutex
	providers map[string]ProviderManifest
}

func NewRegistry() *Registry {
	return &Registry{providers: make(map[string]ProviderManifest)}
}

func (r *Registry) Register(manifest ProviderManifest) error {
	manifest.ID = strings.TrimSpace(manifest.ID)
	manifest.Version = strings.TrimSpace(manifest.Version)
	if manifest.ID == "" || manifest.Version == "" || len(manifest.Capabilities) == 0 {
		return ErrInvalidProvider
	}
	if manifest.Health == "" {
		manifest.Health = HealthHealthy
	}
	if manifest.RateLimit == "" {
		manifest.RateLimit = RateLimitUnknown
	}

	manifest.Capabilities = uniqueCapabilities(manifest.Capabilities)
	manifest.Regions = uniqueStrings(manifest.Regions)

	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[manifest.ID] = cloneManifest(manifest)
	return nil
}

func (r *Registry) Get(id string) (ProviderManifest, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	manifest, ok := r.providers[id]
	if !ok {
		return ProviderManifest{}, false
	}
	return cloneManifest(manifest), true
}

func (r *Registry) Snapshot() []ProviderManifest {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]ProviderManifest, 0, len(r.providers))
	for _, manifest := range r.providers {
		result = append(result, cloneManifest(manifest))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func (r *Registry) SetHealth(id string, state HealthState) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	manifest, ok := r.providers[id]
	if !ok {
		return ErrProviderNotFound
	}
	manifest.Health = state
	r.providers[id] = manifest
	return nil
}

func (r *Registry) SetRateLimit(id string, state RateLimitState, remainingMicrounits int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	manifest, ok := r.providers[id]
	if !ok {
		return ErrProviderNotFound
	}
	manifest.RateLimit = state
	manifest.RemainingQuotaMicrounits = remainingMicrounits
	r.providers[id] = manifest
	return nil
}

func cloneManifest(manifest ProviderManifest) ProviderManifest {
	manifest.Capabilities = append([]Capability(nil), manifest.Capabilities...)
	manifest.Regions = append([]string(nil), manifest.Regions...)
	return manifest
}

func uniqueCapabilities(values []Capability) []Capability {
	seen := make(map[Capability]struct{}, len(values))
	result := make([]Capability, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

package provider

// Adapter is the common registration boundary for both external providers and
// VSN-owned runtimes. Capability-specific execution interfaces are introduced
// alongside each capability without changing domain-facing routing contracts.
type Adapter interface {
	Manifest() ProviderManifest
}

func (r *Registry) RegisterAdapter(adapter Adapter) error {
	if adapter == nil {
		return ErrInvalidProvider
	}
	return r.Register(adapter.Manifest())
}

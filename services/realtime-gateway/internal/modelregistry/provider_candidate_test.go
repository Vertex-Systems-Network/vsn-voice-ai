package modelregistry

import (
	"errors"
	"testing"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

func TestBuildDisabledProviderCandidateRequiresFullyVerifiedModel(t *testing.T) {
	pending := pendingManifest()
	if _, err := BuildDisabledProviderCandidate(
		pending,
		ProviderCandidateConfig{ProviderID: "vsn-accent-runtime", AccessMode: provider.AccessInternal},
	); !errors.Is(err, ErrModelNotFullyVerified) {
		t.Fatalf("expected ErrModelNotFullyVerified, got %v", err)
	}

	deprecated := verifiedManifest()
	deprecated.LifecycleState = LifecycleDeprecated
	if _, err := BuildDisabledProviderCandidate(
		deprecated,
		ProviderCandidateConfig{ProviderID: "vsn-accent-runtime", AccessMode: provider.AccessInternal},
	); !errors.Is(err, ErrModelNotFullyVerified) {
		t.Fatalf("expected deprecated model rejection, got %v", err)
	}
}

func TestBuildDisabledProviderCandidateProjectsContentSafeMetadata(t *testing.T) {
	manifest := verifiedManifest()
	candidate, err := BuildDisabledProviderCandidate(
		manifest,
		ProviderCandidateConfig{ProviderID: "vsn-accent-runtime", AccessMode: provider.AccessInternal},
	)
	if err != nil {
		t.Fatalf("build disabled provider candidate: %v", err)
	}

	if candidate.ModelID != manifest.ModelID ||
		candidate.ModelVersion != manifest.ModelVersion ||
		candidate.ArtifactID != manifest.Artifact.ArtifactID ||
		candidate.ArtifactSHA256 != manifest.Artifact.SHA256 {
		t.Fatalf("candidate lost model provenance: %#v", candidate)
	}
	if candidate.Manifest.ID != "vsn-accent-runtime" ||
		candidate.Manifest.Version != manifest.ModelVersion ||
		candidate.Manifest.AccessMode != provider.AccessInternal {
		t.Fatalf("unexpected provider projection: %#v", candidate.Manifest)
	}
	if candidate.Manifest.Enabled || candidate.Manifest.VerifiedAccess {
		t.Fatal("candidate unexpectedly granted provider activation/access")
	}
	if candidate.Manifest.Health != provider.HealthUnhealthy ||
		candidate.Manifest.RateLimit != provider.RateLimitUnknown {
		t.Fatalf("candidate did not fail closed operationally: %#v", candidate.Manifest)
	}
	if len(candidate.Manifest.Regions) != 0 ||
		candidate.Manifest.RetentionPolicy != "" ||
		candidate.Manifest.LatencyP95Milliseconds != 0 ||
		candidate.Manifest.QualityScore != 0 ||
		candidate.Manifest.PrivacyScore != 0 ||
		candidate.Manifest.CostMicrounitsPerMinute != 0 ||
		candidate.Manifest.RemainingQuotaMicrounits != 0 {
		t.Fatalf("candidate invented unverified runtime/commercial metadata: %#v", candidate.Manifest)
	}
}

func TestDisabledProviderCandidateRemainsNonRoutableAfterRegistration(t *testing.T) {
	candidate, err := BuildDisabledProviderCandidate(
		verifiedManifest(),
		ProviderCandidateConfig{ProviderID: "vsn-accent-runtime", AccessMode: provider.AccessInternal},
	)
	if err != nil {
		t.Fatalf("build disabled provider candidate: %v", err)
	}

	providers := provider.NewRegistry()
	if err := providers.Register(candidate.Manifest); err != nil {
		t.Fatalf("register disabled candidate: %v", err)
	}

	router := provider.NewRouter(providers)
	_, err = router.Select(provider.RoutingRequest{
		Capability:            provider.CapabilityAccentConvert,
		Mode:                  provider.RoutingAuto,
		RequireVerifiedAccess: false,
	})
	if !errors.Is(err, provider.ErrNoEligibleProvider) {
		t.Fatalf("disabled provider candidate became routable: %v", err)
	}
}

func TestBuildDisabledProviderCandidateRequiresExplicitBoundedRuntimeIdentity(t *testing.T) {
	manifest := verifiedManifest()
	cases := map[string]ProviderCandidateConfig{
		"empty provider id": {AccessMode: provider.AccessInternal},
		"unsafe provider id": {
			ProviderID: "Customer / transcript",
			AccessMode: provider.AccessInternal,
		},
		"missing access mode": {ProviderID: "vsn-accent-runtime"},
		"unknown access mode": {
			ProviderID: "vsn-accent-runtime",
			AccessMode: provider.AccessMode("future_mode"),
		},
	}
	for name, config := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := BuildDisabledProviderCandidate(manifest, config); !errors.Is(err, ErrInvalidProviderCandidate) {
				t.Fatalf("expected ErrInvalidProviderCandidate, got %v", err)
			}
		})
	}
}

func TestProviderCandidateCapabilitiesAreDefensiveCopy(t *testing.T) {
	manifest := verifiedManifest()
	candidate, err := BuildDisabledProviderCandidate(
		manifest,
		ProviderCandidateConfig{ProviderID: "vsn-accent-runtime", AccessMode: provider.AccessLocal},
	)
	if err != nil {
		t.Fatalf("build disabled provider candidate: %v", err)
	}

	candidate.Manifest.Capabilities[0] = provider.CapabilityAgentAction
	if manifest.Capabilities[0] == provider.CapabilityAgentAction {
		t.Fatal("candidate capabilities alias model-manifest slice")
	}
}

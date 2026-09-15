package modelregistry

import (
	"errors"
	"strings"
	"testing"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

func pendingManifest() Manifest {
	return Manifest{
		SchemaVersion:  1,
		ModelID:        "vsn-accent-base",
		ModelVersion:   "1.0.0",
		LifecycleState: LifecycleVerificationRequired,
		Capabilities: []provider.Capability{
			provider.CapabilityAccentConvert,
			provider.CapabilityIdentityPreserve,
		},
		Artifact: Artifact{
			ArtifactID: "MODELART-ACCENT-BASE-1",
			Format:     ArtifactFormatONNX,
			SHA256:     strings.Repeat("a", 64),
		},
		Provenance: Provenance{
			DatasetRegistryRefs:   []string{"DATASET-ACCENT-EVAL-1"},
			RightsReviewStatus:    VerificationRequired,
			DeletionLineageStatus: VerificationRequired,
		},
		Verification: Verification{
			ArtifactIntegrity: VerificationRequired,
			Benchmark:         VerificationRequired,
			SecurityReview:    VerificationRequired,
			Rollback:          VerificationRequired,
		},
	}
}

func verifiedManifest() Manifest {
	manifest := pendingManifest()
	manifest.LifecycleState = LifecycleVerified
	manifest.Provenance.RightsReviewStatus = VerificationVerified
	manifest.Provenance.DeletionLineageStatus = VerificationVerified
	manifest.Verification.ArtifactIntegrity = VerificationVerified
	manifest.Verification.Benchmark = VerificationVerified
	manifest.Verification.SecurityReview = VerificationVerified
	manifest.Verification.Rollback = VerificationVerified
	return manifest
}

func TestRegistryStoresPendingMetadataWithoutProviderActivation(t *testing.T) {
	models := NewRegistry()
	manifest := pendingManifest()
	if err := models.Register(manifest); err != nil {
		t.Fatalf("register pending model: %v", err)
	}

	providers := provider.NewRegistry()
	if _, ok := providers.Get(manifest.ModelID); ok {
		t.Fatal("model registration unexpectedly mutated provider routing registry")
	}
	if got := models.VerifiedSnapshot(); len(got) != 0 {
		t.Fatalf("pending model appeared in verified snapshot: %#v", got)
	}
}

func TestRegistryAcceptsVerifiedManifestOnlyAfterAllGatesPass(t *testing.T) {
	manifest := verifiedManifest()
	if err := NewRegistry().Register(manifest); err != nil {
		t.Fatalf("register fully verified model: %v", err)
	}

	cases := map[string]func(*Manifest){
		"rights review": func(value *Manifest) {
			value.Provenance.RightsReviewStatus = VerificationRequired
		},
		"deletion lineage": func(value *Manifest) {
			value.Provenance.DeletionLineageStatus = VerificationRequired
		},
		"artifact integrity": func(value *Manifest) {
			value.Verification.ArtifactIntegrity = VerificationRequired
		},
		"benchmark": func(value *Manifest) {
			value.Verification.Benchmark = VerificationRequired
		},
		"security review": func(value *Manifest) {
			value.Verification.SecurityReview = VerificationRequired
		},
		"rollback": func(value *Manifest) {
			value.Verification.Rollback = VerificationRequired
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			candidate := verifiedManifest()
			mutate(&candidate)
			if err := NewRegistry().Register(candidate); !errors.Is(err, ErrInvalidManifest) {
				t.Fatalf("expected ErrInvalidManifest, got %v", err)
			}
		})
	}
}

func TestRegistryRejectsMalformedOrAmbiguousMetadata(t *testing.T) {
	cases := map[string]func(*Manifest){
		"wrong schema version": func(value *Manifest) {
			value.SchemaVersion = 2
		},
		"invalid model id": func(value *Manifest) {
			value.ModelID = "VSN Invalid"
		},
		"invalid version": func(value *Manifest) {
			value.ModelVersion = "latest"
		},
		"invalid lifecycle": func(value *Manifest) {
			value.LifecycleState = LifecycleState("active")
		},
		"unknown capability": func(value *Manifest) {
			value.Capabilities = []provider.Capability{"audio.unknown"}
		},
		"duplicate capability": func(value *Manifest) {
			value.Capabilities = []provider.Capability{
				provider.CapabilityAccentConvert,
				provider.CapabilityAccentConvert,
			}
		},
		"invalid artifact id": func(value *Manifest) {
			value.Artifact.ArtifactID = "artifact/path"
		},
		"unsupported artifact format": func(value *Manifest) {
			value.Artifact.Format = "pytorch"
		},
		"zero artifact digest": func(value *Manifest) {
			value.Artifact.SHA256 = strings.Repeat("0", 64)
		},
		"uppercase artifact digest": func(value *Manifest) {
			value.Artifact.SHA256 = strings.Repeat("A", 64)
		},
		"invalid dataset ref": func(value *Manifest) {
			value.Provenance.DatasetRegistryRefs = []string{"/datasets/customer-a"}
		},
		"duplicate dataset ref": func(value *Manifest) {
			value.Provenance.DatasetRegistryRefs = []string{
				"DATASET-ACCENT-EVAL-1",
				"DATASET-ACCENT-EVAL-1",
			}
		},
		"unknown verification state": func(value *Manifest) {
			value.Verification.SecurityReview = VerificationState("approved")
		},
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			candidate := pendingManifest()
			mutate(&candidate)
			if err := NewRegistry().Register(candidate); !errors.Is(err, ErrInvalidManifest) {
				t.Fatalf("expected ErrInvalidManifest, got %v", err)
			}
		})
	}
}

func TestRegistryIsImmutablePerModelVersion(t *testing.T) {
	registry := NewRegistry()
	manifest := pendingManifest()
	if err := registry.Register(manifest); err != nil {
		t.Fatalf("register model: %v", err)
	}
	if err := registry.Register(manifest); !errors.Is(err, ErrModelAlreadyRegistered) {
		t.Fatalf("expected duplicate registration rejection, got %v", err)
	}

	secondVersion := manifest
	secondVersion.ModelVersion = "1.1.0"
	if err := registry.Register(secondVersion); err != nil {
		t.Fatalf("register second immutable version: %v", err)
	}
	if _, err := registry.Get(manifest.ModelID, "9.9.9"); !errors.Is(err, ErrModelNotFound) {
		t.Fatalf("expected ErrModelNotFound, got %v", err)
	}
}

func TestRegistryReturnsDefensiveCopiesAndDeterministicSnapshots(t *testing.T) {
	registry := NewRegistry()
	zeta := pendingManifest()
	zeta.ModelID = "vsn-zeta"
	zeta.Capabilities = []provider.Capability{provider.CapabilityVAD}
	zeta.Provenance.DatasetRegistryRefs = []string{"DATASET-ZETA-1"}

	alpha := verifiedManifest()
	alpha.ModelID = "vsn-alpha"
	alpha.Artifact.ArtifactID = "MODELART-ALPHA-1"
	alpha.Provenance.DatasetRegistryRefs = []string{"DATASET-ALPHA-1"}

	if err := registry.Register(zeta); err != nil {
		t.Fatalf("register zeta: %v", err)
	}
	if err := registry.Register(alpha); err != nil {
		t.Fatalf("register alpha: %v", err)
	}

	zeta.Capabilities[0] = provider.CapabilityAgentAction
	zeta.Provenance.DatasetRegistryRefs[0] = "DATASET-MUTATED"

	stored, err := registry.Get("vsn-zeta", "1.0.0")
	if err != nil {
		t.Fatalf("get zeta: %v", err)
	}
	if stored.Capabilities[0] != provider.CapabilityVAD {
		t.Fatalf("stored capabilities mutated through caller slice: %#v", stored.Capabilities)
	}
	if stored.Provenance.DatasetRegistryRefs[0] != "DATASET-ZETA-1" {
		t.Fatalf("stored provenance mutated through caller slice: %#v", stored.Provenance.DatasetRegistryRefs)
	}

	stored.Capabilities[0] = provider.CapabilityAgentAction
	stored.Provenance.DatasetRegistryRefs[0] = "DATASET-MUTATED-AGAIN"
	storedAgain, err := registry.Get("vsn-zeta", "1.0.0")
	if err != nil {
		t.Fatalf("get zeta again: %v", err)
	}
	if storedAgain.Capabilities[0] != provider.CapabilityVAD ||
		storedAgain.Provenance.DatasetRegistryRefs[0] != "DATASET-ZETA-1" {
		t.Fatal("Get returned mutable registry-owned slices")
	}

	snapshot := registry.Snapshot()
	if len(snapshot) != 2 || snapshot[0].ModelID != "vsn-alpha" || snapshot[1].ModelID != "vsn-zeta" {
		t.Fatalf("unexpected deterministic snapshot: %#v", snapshot)
	}
	verified := registry.VerifiedSnapshot()
	if len(verified) != 1 || verified[0].ModelID != "vsn-alpha" {
		t.Fatalf("unexpected verified snapshot: %#v", verified)
	}
}

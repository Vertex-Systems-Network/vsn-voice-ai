package modelregistry

import (
	"errors"
	"testing"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

func TestActivationReviewRegistryRequiresValidatedExactCandidate(t *testing.T) {
	registry := NewActivationReviewRegistry()
	candidate := disabledCandidateForActivationReview(t)
	review := activationReviewFixture(t)
	review.ModelVersion = "2.0.0"

	if err := registry.Register(candidate, review); !errors.Is(err, ErrProviderActivationReviewMismatch) {
		t.Fatalf("expected candidate/review mismatch rejection, got %v", err)
	}
	if snapshot := registry.Snapshot(); len(snapshot) != 0 {
		t.Fatalf("invalid review was persisted: %#v", snapshot)
	}
}

func TestActivationReviewRegistryIsAppendOnlyByReviewID(t *testing.T) {
	registry := NewActivationReviewRegistry()
	candidate := disabledCandidateForActivationReview(t)
	review := activationReviewFixture(t)
	if err := registry.Register(candidate, review); err != nil {
		t.Fatalf("register activation review: %v", err)
	}
	if err := registry.Register(candidate, review); !errors.Is(err, ErrActivationReviewAlreadyRegistered) {
		t.Fatalf("expected duplicate review rejection, got %v", err)
	}

	changed := activationReviewFixture(t)
	changed.EvidenceRefs.RuntimeAccess = "EVIDENCE-RUNTIME-ACCESS-REPLACEMENT-1"
	if err := registry.Register(candidate, changed); !errors.Is(err, ErrActivationReviewAlreadyRegistered) {
		t.Fatalf("expected same review ID replacement rejection, got %v", err)
	}

	stored, err := registry.Get(review.ReviewID)
	if err != nil {
		t.Fatalf("get stored activation review: %v", err)
	}
	if stored.EvidenceRefs.RuntimeAccess != review.EvidenceRefs.RuntimeAccess {
		t.Fatalf("stored review was overwritten: %#v", stored)
	}
}

func TestActivationReviewRegistryUsesDefensiveCopies(t *testing.T) {
	registry := NewActivationReviewRegistry()
	candidate := disabledCandidateForActivationReview(t)
	review := activationReviewFixture(t)
	if err := registry.Register(candidate, review); err != nil {
		t.Fatalf("register activation review: %v", err)
	}

	review.Capabilities[0] = provider.CapabilityAgentAction
	stored, err := registry.Get(review.ReviewID)
	if err != nil {
		t.Fatalf("get activation review: %v", err)
	}
	if stored.Capabilities[0] == provider.CapabilityAgentAction {
		t.Fatal("registry retained caller-owned capability slice")
	}

	stored.Capabilities[0] = provider.CapabilityAgentAction
	again, err := registry.Get(review.ReviewID)
	if err != nil {
		t.Fatalf("get activation review again: %v", err)
	}
	if again.Capabilities[0] == provider.CapabilityAgentAction {
		t.Fatal("registry returned mutable registry-owned capability slice")
	}
}

func TestActivationReviewRegistrySnapshotIsDeterministic(t *testing.T) {
	registry := NewActivationReviewRegistry()
	candidate := disabledCandidateForActivationReview(t)

	second := activationReviewFixture(t)
	second.ReviewID = "ACTREVIEW-Z-1"
	first := activationReviewFixture(t)
	first.ReviewID = "ACTREVIEW-A-1"
	if err := registry.Register(candidate, second); err != nil {
		t.Fatalf("register second review: %v", err)
	}
	if err := registry.Register(candidate, first); err != nil {
		t.Fatalf("register first review: %v", err)
	}

	snapshot := registry.Snapshot()
	if len(snapshot) != 2 || snapshot[0].ReviewID != "ACTREVIEW-A-1" || snapshot[1].ReviewID != "ACTREVIEW-Z-1" {
		t.Fatalf("unexpected deterministic snapshot: %#v", snapshot)
	}

	snapshot[0].Capabilities[0] = provider.CapabilityAgentAction
	again := registry.Snapshot()
	if again[0].Capabilities[0] == provider.CapabilityAgentAction {
		t.Fatal("snapshot exposed mutable registry-owned capability slice")
	}
}

func TestNilActivationReviewRegistryFailsClosed(t *testing.T) {
	var registry *ActivationReviewRegistry
	candidate := disabledCandidateForActivationReview(t)
	review := activationReviewFixture(t)
	if err := registry.Register(candidate, review); !errors.Is(err, ErrInvalidProviderActivationReview) {
		t.Fatalf("expected nil registry rejection, got %v", err)
	}
	if _, err := registry.Get(review.ReviewID); !errors.Is(err, ErrActivationReviewNotFound) {
		t.Fatalf("expected nil registry lookup failure, got %v", err)
	}
	if snapshot := registry.Snapshot(); snapshot != nil {
		t.Fatalf("expected nil snapshot, got %#v", snapshot)
	}
}

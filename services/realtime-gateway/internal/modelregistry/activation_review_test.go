package modelregistry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

func activationReviewFixture(t *testing.T) ProviderActivationReview {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "vsn-provider-activation-review.json")
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared provider activation review fixture: %v", err)
	}
	var review ProviderActivationReview
	if err := json.Unmarshal(payload, &review); err != nil {
		t.Fatalf("decode shared provider activation review fixture: %v", err)
	}
	return review
}

func disabledCandidateForActivationReview(t *testing.T) ProviderCandidate {
	t.Helper()
	candidate, err := BuildDisabledProviderCandidate(
		verifiedManifest(),
		verificationEvidenceFixture(t),
		verifiedDatasetRegistry(t),
		ProviderCandidateConfig{ProviderID: "vsn-accent-runtime", AccessMode: provider.AccessInternal},
	)
	if err != nil {
		t.Fatalf("build disabled provider candidate: %v", err)
	}
	return candidate
}

func TestActivationReviewFixtureMatchesGoContract(t *testing.T) {
	candidate := disabledCandidateForActivationReview(t)
	review := activationReviewFixture(t)
	if err := ValidateProviderActivationReview(candidate, review); err != nil {
		t.Fatalf("validate shared activation review fixture: %v", err)
	}

	actualJSON, err := json.Marshal(review)
	if err != nil {
		t.Fatalf("marshal activation review: %v", err)
	}
	fixturePath := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "vsn-provider-activation-review.json")
	expectedJSON, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read shared activation review fixture: %v", err)
	}
	var actual any
	var expected any
	if err := json.Unmarshal(actualJSON, &actual); err != nil {
		t.Fatalf("decode marshaled activation review: %v", err)
	}
	if err := json.Unmarshal(expectedJSON, &expected); err != nil {
		t.Fatalf("decode shared activation review fixture: %v", err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("Go activation review drifted from shared fixture\nactual: %s\nexpected: %s", actualJSON, expectedJSON)
	}
}

func TestActivationReviewCannotAuthorizeOrPromoteCandidateState(t *testing.T) {
	candidate := disabledCandidateForActivationReview(t)
	cases := map[string]func(*ProviderActivationReview){
		"activation authorization": func(review *ProviderActivationReview) {
			review.ActivationAuthorized = true
		},
		"enabled": func(review *ProviderActivationReview) {
			review.CandidateState.Enabled = true
		},
		"verified access": func(review *ProviderActivationReview) {
			review.CandidateState.VerifiedAccess = true
		},
		"healthy": func(review *ProviderActivationReview) {
			review.CandidateState.Health = "healthy"
		},
		"rate limit available": func(review *ProviderActivationReview) {
			review.CandidateState.RateLimit = "available"
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			review := activationReviewFixture(t)
			mutate(&review)
			if err := ValidateProviderActivationReview(candidate, review); !errors.Is(err, ErrInvalidProviderActivationReview) {
				t.Fatalf("expected ErrInvalidProviderActivationReview, got %v", err)
			}
		})
	}
}

func TestActivationReviewRequiresUniqueOpaqueEvidenceReferences(t *testing.T) {
	candidate := disabledCandidateForActivationReview(t)

	review := activationReviewFixture(t)
	review.EvidenceRefs.RuntimeAccess = "https://example.invalid/runtime"
	if err := ValidateProviderActivationReview(candidate, review); !errors.Is(err, ErrInvalidProviderActivationReview) {
		t.Fatalf("expected malformed evidence ref rejection, got %v", err)
	}

	review = activationReviewFixture(t)
	review.EvidenceRefs.ArtifactSignature = review.EvidenceRefs.RuntimeAccess
	if err := ValidateProviderActivationReview(candidate, review); !errors.Is(err, ErrInvalidProviderActivationReview) {
		t.Fatalf("expected duplicate evidence ref rejection, got %v", err)
	}
}

func TestActivationReviewMustMatchExactCandidateIdentity(t *testing.T) {
	candidate := disabledCandidateForActivationReview(t)
	cases := map[string]func(*ProviderActivationReview){
		"verification evidence": func(review *ProviderActivationReview) {
			review.VerificationEvidenceID = "MODELEVID-OTHER-1"
		},
		"model": func(review *ProviderActivationReview) {
			review.ModelID = "vsn-other-model"
		},
		"model version": func(review *ProviderActivationReview) {
			review.ModelVersion = "2.0.0"
		},
		"artifact": func(review *ProviderActivationReview) {
			review.ArtifactID = "MODELART-OTHER-1"
		},
		"artifact digest": func(review *ProviderActivationReview) {
			review.ArtifactSHA256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		},
		"provider": func(review *ProviderActivationReview) {
			review.ProviderID = "vsn-other-runtime"
		},
		"access mode": func(review *ProviderActivationReview) {
			review.AccessMode = provider.AccessLocal
		},
		"capabilities": func(review *ProviderActivationReview) {
			review.Capabilities = []provider.Capability{provider.CapabilityAccentConvert}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			review := activationReviewFixture(t)
			mutate(&review)
			if err := ValidateProviderActivationReview(candidate, review); !errors.Is(err, ErrProviderActivationReviewMismatch) {
				t.Fatalf("expected ErrProviderActivationReviewMismatch, got %v", err)
			}
		})
	}
}

func TestActivationReviewRejectsPromotedOrMalformedCandidate(t *testing.T) {
	review := activationReviewFixture(t)

	candidate := disabledCandidateForActivationReview(t)
	candidate.Manifest.Enabled = true
	if err := ValidateProviderActivationReview(candidate, review); !errors.Is(err, ErrInvalidProviderCandidate) {
		t.Fatalf("expected enabled candidate rejection, got %v", err)
	}

	candidate = disabledCandidateForActivationReview(t)
	candidate.Manifest.Health = provider.HealthHealthy
	if err := ValidateProviderActivationReview(candidate, review); !errors.Is(err, ErrInvalidProviderCandidate) {
		t.Fatalf("expected healthy candidate rejection, got %v", err)
	}
}

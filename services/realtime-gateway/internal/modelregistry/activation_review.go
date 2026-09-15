package modelregistry

import (
	"errors"
	"regexp"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

const providerActivationReviewSchemaVersion = 1

var (
	ErrInvalidProviderActivationReview  = errors.New("invalid VSN provider activation review")
	ErrProviderActivationReviewMismatch = errors.New("VSN provider activation review does not match candidate")

	providerActivationReviewIDPattern = regexp.MustCompile(`^ACTREVIEW-[A-Z0-9][A-Z0-9._-]{0,63}$`)
)

type ProviderActivationCandidateState struct {
	Enabled        bool   `json:"enabled"`
	VerifiedAccess bool   `json:"verified_access"`
	Health         string `json:"health"`
	RateLimit      string `json:"rate_limit"`
}

type ProviderActivationEvidenceRefs struct {
	RuntimeAccess     string `json:"runtime_access"`
	ArtifactSignature string `json:"artifact_signature"`
	ReleaseProvenance string `json:"release_provenance"`
	BenchmarkPolicy   string `json:"benchmark_policy"`
	RollbackReadiness string `json:"rollback_readiness"`
}

type ProviderActivationReview struct {
	SchemaVersion          int                              `json:"schema_version"`
	ReviewID               string                           `json:"review_id"`
	VerificationEvidenceID string                           `json:"verification_evidence_id"`
	ModelID                string                           `json:"model_id"`
	ModelVersion           string                           `json:"model_version"`
	ArtifactID             string                           `json:"artifact_id"`
	ArtifactSHA256         string                           `json:"artifact_sha256"`
	ProviderID             string                           `json:"provider_id"`
	AccessMode             provider.AccessMode              `json:"access_mode"`
	Capabilities           []provider.Capability            `json:"capabilities"`
	CandidateState         ProviderActivationCandidateState `json:"candidate_state"`
	EvidenceRefs           ProviderActivationEvidenceRefs   `json:"evidence_refs"`
	ActivationAuthorized   bool                             `json:"activation_authorized"`
}

// ValidateProviderActivationReview binds a content-safe review packet to one
// exact disabled provider candidate. It validates references and candidate
// identity only; it never evaluates external evidence, mutates provider state,
// grants verified access, authorizes activation or performs deployment.
func ValidateProviderActivationReview(candidate ProviderCandidate, review ProviderActivationReview) error {
	if err := validateDisabledProviderCandidateForReview(candidate); err != nil {
		return err
	}
	if err := validateProviderActivationReview(review); err != nil {
		return err
	}
	if review.VerificationEvidenceID != candidate.VerificationEvidenceID ||
		review.ModelID != candidate.ModelID ||
		review.ModelVersion != candidate.ModelVersion ||
		review.ArtifactID != candidate.ArtifactID ||
		review.ArtifactSHA256 != candidate.ArtifactSHA256 ||
		review.ProviderID != candidate.Manifest.ID ||
		review.AccessMode != candidate.Manifest.AccessMode ||
		!sameCapabilitySequence(review.Capabilities, candidate.Manifest.Capabilities) ||
		review.CandidateState.Enabled != candidate.Manifest.Enabled ||
		review.CandidateState.VerifiedAccess != candidate.Manifest.VerifiedAccess ||
		review.CandidateState.Health != string(candidate.Manifest.Health) ||
		review.CandidateState.RateLimit != string(candidate.Manifest.RateLimit) {
		return ErrProviderActivationReviewMismatch
	}
	return nil
}

func validateDisabledProviderCandidateForReview(candidate ProviderCandidate) error {
	if candidate.SchemaVersion != providerCandidateSchemaVersion ||
		!modelVerificationEvidenceIDPattern.MatchString(candidate.VerificationEvidenceID) ||
		!modelIDPattern.MatchString(candidate.ModelID) ||
		!modelVersionPattern.MatchString(candidate.ModelVersion) ||
		!artifactIDPattern.MatchString(candidate.ArtifactID) ||
		!sha256Pattern.MatchString(candidate.ArtifactSHA256) ||
		candidate.ArtifactSHA256 == zeroSHA256 ||
		!providerCandidateIDPattern.MatchString(candidate.Manifest.ID) ||
		candidate.Manifest.Version != candidate.ModelVersion ||
		!validCandidateAccessMode(candidate.Manifest.AccessMode) ||
		candidate.Manifest.Enabled ||
		candidate.Manifest.VerifiedAccess ||
		candidate.Manifest.Health != provider.HealthUnhealthy ||
		candidate.Manifest.RateLimit != provider.RateLimitUnknown {
		return ErrInvalidProviderCandidate
	}
	if err := validateCapabilities(candidate.Manifest.Capabilities); err != nil {
		return ErrInvalidProviderCandidate
	}
	return nil
}

func validateProviderActivationReview(review ProviderActivationReview) error {
	if review.SchemaVersion != providerActivationReviewSchemaVersion ||
		!providerActivationReviewIDPattern.MatchString(review.ReviewID) ||
		!modelVerificationEvidenceIDPattern.MatchString(review.VerificationEvidenceID) ||
		!modelIDPattern.MatchString(review.ModelID) ||
		!modelVersionPattern.MatchString(review.ModelVersion) ||
		!artifactIDPattern.MatchString(review.ArtifactID) ||
		!sha256Pattern.MatchString(review.ArtifactSHA256) ||
		review.ArtifactSHA256 == zeroSHA256 ||
		!providerCandidateIDPattern.MatchString(review.ProviderID) ||
		!validCandidateAccessMode(review.AccessMode) ||
		review.ActivationAuthorized ||
		review.CandidateState.Enabled ||
		review.CandidateState.VerifiedAccess ||
		review.CandidateState.Health != string(provider.HealthUnhealthy) ||
		review.CandidateState.RateLimit != string(provider.RateLimitUnknown) {
		return ErrInvalidProviderActivationReview
	}
	if err := validateCapabilities(review.Capabilities); err != nil {
		return ErrInvalidProviderActivationReview
	}

	refs := []string{
		review.EvidenceRefs.RuntimeAccess,
		review.EvidenceRefs.ArtifactSignature,
		review.EvidenceRefs.ReleaseProvenance,
		review.EvidenceRefs.BenchmarkPolicy,
		review.EvidenceRefs.RollbackReadiness,
	}
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if !modelEvidenceRefPattern.MatchString(ref) {
			return ErrInvalidProviderActivationReview
		}
		if _, exists := seen[ref]; exists {
			return ErrInvalidProviderActivationReview
		}
		seen[ref] = struct{}{}
	}
	return nil
}

func sameCapabilitySequence(left []provider.Capability, right []provider.Capability) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

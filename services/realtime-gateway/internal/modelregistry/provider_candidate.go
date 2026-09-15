package modelregistry

import (
	"errors"
	"regexp"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

const providerCandidateSchemaVersion = 2

var (
	ErrModelNotFullyVerified    = errors.New("VSN model is not fully verified")
	ErrInvalidProviderCandidate = errors.New("invalid VSN provider candidate configuration")

	providerCandidateIDPattern = regexp.MustCompile(`^vsn-[a-z0-9][a-z0-9._-]{0,62}$`)
)

// ProviderCandidateConfig contains runtime/provider identity decisions that are
// intentionally absent from model metadata. Callers must supply them explicitly.
type ProviderCandidateConfig struct {
	ProviderID string
	AccessMode provider.AccessMode
}

// ProviderCandidate is a reviewable projection only. ProviderManifest is
// permanently emitted disabled, unverified and unhealthy by this builder, so
// registering the candidate alone cannot make the model routable.
type ProviderCandidate struct {
	SchemaVersion          int                       `json:"schema_version"`
	VerificationEvidenceID string                    `json:"verification_evidence_id"`
	ModelID                string                    `json:"model_id"`
	ModelVersion           string                    `json:"model_version"`
	ArtifactID             string                    `json:"artifact_id"`
	ArtifactSHA256         string                    `json:"artifact_sha256"`
	Manifest               provider.ProviderManifest `json:"provider_manifest"`
}

// BuildDisabledProviderCandidate converts fully verified model metadata plus an
// exact evidence-reference bundle into a fail-closed provider registration
// candidate. Every dataset referenced by the manifest must also resolve through
// the dataset provenance registry with verified rights and deletion-lineage
// state. The function does not mutate either registry, grant dataset access,
// authorize training, activate runtime access or evaluate external evidence.
func BuildDisabledProviderCandidate(
	manifest Manifest,
	evidence ModelVerificationEvidence,
	datasets *DatasetProvenanceRegistry,
	config ProviderCandidateConfig,
) (ProviderCandidate, error) {
	if err := validateManifest(manifest); err != nil {
		return ProviderCandidate{}, err
	}
	if manifest.LifecycleState != LifecycleVerified || !allVerificationGatesPassed(manifest) {
		return ProviderCandidate{}, ErrModelNotFullyVerified
	}
	if err := ValidateVerificationEvidence(manifest, evidence); err != nil {
		return ProviderCandidate{}, err
	}
	if _, err := datasets.VerifiedForManifest(manifest); err != nil {
		return ProviderCandidate{}, err
	}
	if !providerCandidateIDPattern.MatchString(config.ProviderID) || !validCandidateAccessMode(config.AccessMode) {
		return ProviderCandidate{}, ErrInvalidProviderCandidate
	}

	capabilities := append([]provider.Capability(nil), manifest.Capabilities...)
	return ProviderCandidate{
		SchemaVersion:          providerCandidateSchemaVersion,
		VerificationEvidenceID: evidence.EvidenceID,
		ModelID:                manifest.ModelID,
		ModelVersion:           manifest.ModelVersion,
		ArtifactID:             manifest.Artifact.ArtifactID,
		ArtifactSHA256:         manifest.Artifact.SHA256,
		Manifest: provider.ProviderManifest{
			ID:             config.ProviderID,
			Version:        manifest.ModelVersion,
			AccessMode:     config.AccessMode,
			Capabilities:   capabilities,
			Enabled:        false,
			VerifiedAccess: false,
			Health:         provider.HealthUnhealthy,
			RateLimit:      provider.RateLimitUnknown,
		},
	}, nil
}

func validCandidateAccessMode(mode provider.AccessMode) bool {
	switch mode {
	case provider.AccessAPI,
		provider.AccessSDK,
		provider.AccessLocal,
		provider.AccessOnPrem,
		provider.AccessInternal:
		return true
	default:
		return false
	}
}

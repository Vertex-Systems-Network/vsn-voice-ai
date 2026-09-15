package modelregistry

import (
	"errors"
	"regexp"
)

const modelVerificationEvidenceSchemaVersion = 1

var (
	ErrInvalidVerificationEvidence  = errors.New("invalid VSN model verification evidence")
	ErrVerificationEvidenceMismatch = errors.New("VSN model verification evidence does not match manifest")

	modelVerificationEvidenceIDPattern = regexp.MustCompile(`^MODELEVID-[A-Z0-9][A-Z0-9._-]{0,63}$`)
	modelEvidenceRefPattern             = regexp.MustCompile(`^EVIDENCE-[A-Z0-9][A-Z0-9._-]{0,95}$`)
)

type VerificationEvidenceRefs struct {
	DatasetProvenance []string `json:"dataset_provenance"`
	LeakageTest       string   `json:"leakage_test"`
	ModelRegression   string   `json:"model_regression"`
	Benchmark         string   `json:"benchmark"`
	SecurityReview    string   `json:"security_review"`
	Rollback          string   `json:"rollback"`
	ArtifactIntegrity string   `json:"artifact_integrity"`
}

type ModelVerificationEvidence struct {
	SchemaVersion       int                      `json:"schema_version"`
	EvidenceID          string                   `json:"evidence_id"`
	ModelID             string                   `json:"model_id"`
	ModelVersion        string                   `json:"model_version"`
	ArtifactID          string                   `json:"artifact_id"`
	ArtifactSHA256      string                   `json:"artifact_sha256"`
	DatasetRegistryRefs []string                 `json:"dataset_registry_refs"`
	EvidenceRefs        VerificationEvidenceRefs `json:"evidence_refs"`
}

// ValidateVerificationEvidence verifies the evidence-reference contract and
// binds it to one exact manifest identity. Evidence values are opaque record
// identifiers only; this function never fetches, evaluates or promotes the
// referenced evidence and does not mutate model/provider state.
func ValidateVerificationEvidence(manifest Manifest, evidence ModelVerificationEvidence) error {
	if err := validateManifest(manifest); err != nil {
		return err
	}
	if err := validateVerificationEvidence(evidence); err != nil {
		return err
	}
	if evidence.ModelID != manifest.ModelID ||
		evidence.ModelVersion != manifest.ModelVersion ||
		evidence.ArtifactID != manifest.Artifact.ArtifactID ||
		evidence.ArtifactSHA256 != manifest.Artifact.SHA256 ||
		!sameStringSet(evidence.DatasetRegistryRefs, manifest.Provenance.DatasetRegistryRefs) {
		return ErrVerificationEvidenceMismatch
	}
	return nil
}

func validateVerificationEvidence(evidence ModelVerificationEvidence) error {
	if evidence.SchemaVersion != modelVerificationEvidenceSchemaVersion ||
		!modelVerificationEvidenceIDPattern.MatchString(evidence.EvidenceID) ||
		!modelIDPattern.MatchString(evidence.ModelID) ||
		!modelVersionPattern.MatchString(evidence.ModelVersion) ||
		!artifactIDPattern.MatchString(evidence.ArtifactID) ||
		!sha256Pattern.MatchString(evidence.ArtifactSHA256) ||
		evidence.ArtifactSHA256 == zeroSHA256 {
		return ErrInvalidVerificationEvidence
	}
	if err := validateDatasetRefs(evidence.DatasetRegistryRefs); err != nil {
		return ErrInvalidVerificationEvidence
	}
	if err := validateEvidenceRefs(evidence.EvidenceRefs); err != nil {
		return err
	}
	return nil
}

func validateEvidenceRefs(refs VerificationEvidenceRefs) error {
	if len(refs.DatasetProvenance) == 0 || len(refs.DatasetProvenance) > 64 {
		return ErrInvalidVerificationEvidence
	}

	all := make([]string, 0, len(refs.DatasetProvenance)+6)
	all = append(all, refs.DatasetProvenance...)
	all = append(all,
		refs.LeakageTest,
		refs.ModelRegression,
		refs.Benchmark,
		refs.SecurityReview,
		refs.Rollback,
		refs.ArtifactIntegrity,
	)

	seen := make(map[string]struct{}, len(all))
	for _, ref := range all {
		if !modelEvidenceRefPattern.MatchString(ref) {
			return ErrInvalidVerificationEvidence
		}
		if _, exists := seen[ref]; exists {
			return ErrInvalidVerificationEvidence
		}
		seen[ref] = struct{}{}
	}
	return nil
}

func sameStringSet(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	values := make(map[string]struct{}, len(left))
	for _, value := range left {
		values[value] = struct{}{}
	}
	if len(values) != len(left) {
		return false
	}
	for _, value := range right {
		if _, ok := values[value]; !ok {
			return false
		}
	}
	return true
}

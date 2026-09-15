package modelregistry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func verificationEvidenceFixture(t *testing.T) ModelVerificationEvidence {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "vsn-model-verification-evidence.json")
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared model verification evidence fixture: %v", err)
	}
	var evidence ModelVerificationEvidence
	if err := json.Unmarshal(payload, &evidence); err != nil {
		t.Fatalf("decode shared model verification evidence fixture: %v", err)
	}
	return evidence
}

func TestVerificationEvidenceFixtureBindsToVerifiedManifest(t *testing.T) {
	if err := ValidateVerificationEvidence(verifiedManifest(), verificationEvidenceFixture(t)); err != nil {
		t.Fatalf("validate verification evidence: %v", err)
	}
}

func TestVerificationEvidenceRejectsManifestIdentityMismatch(t *testing.T) {
	cases := map[string]func(*ModelVerificationEvidence){
		"model id": func(value *ModelVerificationEvidence) {
			value.ModelID = "vsn-other-model"
		},
		"model version": func(value *ModelVerificationEvidence) {
			value.ModelVersion = "2.0.0"
		},
		"artifact id": func(value *ModelVerificationEvidence) {
			value.ArtifactID = "MODELART-OTHER-1"
		},
		"artifact digest": func(value *ModelVerificationEvidence) {
			value.ArtifactSHA256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		},
		"dataset registry": func(value *ModelVerificationEvidence) {
			value.DatasetRegistryRefs = []string{"DATASET-OTHER-1"}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			evidence := verificationEvidenceFixture(t)
			mutate(&evidence)
			if err := ValidateVerificationEvidence(verifiedManifest(), evidence); !errors.Is(err, ErrVerificationEvidenceMismatch) {
				t.Fatalf("expected ErrVerificationEvidenceMismatch, got %v", err)
			}
		})
	}
}

func TestVerificationEvidenceDatasetBindingIsOrderIndependentButExact(t *testing.T) {
	manifest := verifiedManifest()
	manifest.Provenance.DatasetRegistryRefs = []string{"DATASET-ACCENT-EVAL-1", "DATASET-ACCENT-EVAL-2"}
	evidence := verificationEvidenceFixture(t)
	evidence.DatasetRegistryRefs = []string{"DATASET-ACCENT-EVAL-2", "DATASET-ACCENT-EVAL-1"}
	if err := ValidateVerificationEvidence(manifest, evidence); err != nil {
		t.Fatalf("expected exact dataset set to bind regardless of order: %v", err)
	}

	evidence.DatasetRegistryRefs = []string{"DATASET-ACCENT-EVAL-1"}
	if err := ValidateVerificationEvidence(manifest, evidence); !errors.Is(err, ErrVerificationEvidenceMismatch) {
		t.Fatalf("expected missing dataset ref to fail binding, got %v", err)
	}
}

func TestVerificationEvidenceRejectsMalformedOrReusedEvidenceReferences(t *testing.T) {
	cases := map[string]func(*ModelVerificationEvidence){
		"wrong schema version": func(value *ModelVerificationEvidence) {
			value.SchemaVersion = 2
		},
		"unsafe evidence id": func(value *ModelVerificationEvidence) {
			value.EvidenceID = "unsafe evidence/id"
		},
		"missing dataset provenance": func(value *ModelVerificationEvidence) {
			value.EvidenceRefs.DatasetProvenance = nil
		},
		"url evidence ref": func(value *ModelVerificationEvidence) {
			value.EvidenceRefs.Benchmark = "https://example.invalid/benchmark.json"
		},
		"duplicate gate evidence": func(value *ModelVerificationEvidence) {
			value.EvidenceRefs.Rollback = value.EvidenceRefs.Benchmark
		},
		"duplicate dataset provenance": func(value *ModelVerificationEvidence) {
			value.EvidenceRefs.DatasetProvenance = append(
				value.EvidenceRefs.DatasetProvenance,
				value.EvidenceRefs.DatasetProvenance[0],
			)
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			evidence := verificationEvidenceFixture(t)
			mutate(&evidence)
			if err := ValidateVerificationEvidence(verifiedManifest(), evidence); !errors.Is(err, ErrInvalidVerificationEvidence) {
				t.Fatalf("expected ErrInvalidVerificationEvidence, got %v", err)
			}
		})
	}
}

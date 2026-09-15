package modelregistry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func datasetProvenanceFixture(t *testing.T) DatasetProvenanceRecord {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "vsn-dataset-provenance.json")
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared dataset provenance fixture: %v", err)
	}
	var record DatasetProvenanceRecord
	if err := json.Unmarshal(payload, &record); err != nil {
		t.Fatalf("decode shared dataset provenance fixture: %v", err)
	}
	return record
}

func TestDatasetProvenanceFixtureMatchesGoContract(t *testing.T) {
	record := datasetProvenanceFixture(t)
	if err := validateDatasetProvenanceRecord(record); err != nil {
		t.Fatalf("validate shared dataset provenance fixture: %v", err)
	}

	actual, err := json.Marshal(record)
	if err != nil {
		t.Fatalf("marshal dataset provenance record: %v", err)
	}
	path := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "vsn-dataset-provenance.json")
	expectedJSON, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared fixture: %v", err)
	}
	var actualValue any
	var expectedValue any
	if err := json.Unmarshal(actual, &actualValue); err != nil {
		t.Fatalf("decode marshaled record: %v", err)
	}
	if err := json.Unmarshal(expectedJSON, &expectedValue); err != nil {
		t.Fatalf("decode shared fixture: %v", err)
	}
	if !reflect.DeepEqual(actualValue, expectedValue) {
		t.Fatalf("Go dataset record drifted from shared fixture\nactual: %s\nexpected: %s", actual, expectedJSON)
	}
}

func TestDatasetProvenanceRegistryIsImmutableAndDefensive(t *testing.T) {
	registry := NewDatasetProvenanceRegistry()
	record := datasetProvenanceFixture(t)
	if err := registry.Register(record); err != nil {
		t.Fatalf("register dataset provenance: %v", err)
	}
	if err := registry.Register(record); !errors.Is(err, ErrDatasetAlreadyRegistered) {
		t.Fatalf("expected duplicate rejection, got %v", err)
	}

	record.SourceProvenanceRefs[0] = "EVIDENCE-MUTATED-CALLER"
	stored, err := registry.Get("DATASET-ACCENT-EVAL-1")
	if err != nil {
		t.Fatalf("get dataset provenance: %v", err)
	}
	if stored.SourceProvenanceRefs[0] == "EVIDENCE-MUTATED-CALLER" {
		t.Fatal("registry retained caller-owned provenance slice")
	}

	stored.SourceProvenanceRefs[0] = "EVIDENCE-MUTATED-READ"
	again, err := registry.Get("DATASET-ACCENT-EVAL-1")
	if err != nil {
		t.Fatalf("get dataset provenance again: %v", err)
	}
	if again.SourceProvenanceRefs[0] == "EVIDENCE-MUTATED-READ" {
		t.Fatal("registry returned mutable provenance slice")
	}
}

func TestDatasetProvenanceRegistrySnapshotIsDeterministic(t *testing.T) {
	registry := NewDatasetProvenanceRegistry()
	second := datasetProvenanceFixture(t)
	second.DatasetID = "DATASET-Z-1"
	first := datasetProvenanceFixture(t)
	first.DatasetID = "DATASET-A-1"
	if err := registry.Register(second); err != nil {
		t.Fatalf("register second dataset: %v", err)
	}
	if err := registry.Register(first); err != nil {
		t.Fatalf("register first dataset: %v", err)
	}

	snapshot := registry.Snapshot()
	if len(snapshot) != 2 || snapshot[0].DatasetID != "DATASET-A-1" || snapshot[1].DatasetID != "DATASET-Z-1" {
		t.Fatalf("unexpected deterministic snapshot: %#v", snapshot)
	}
}

func TestDatasetProvenanceCustomerContentPolicyFailsClosed(t *testing.T) {
	excluded := datasetProvenanceFixture(t)
	excluded.AuthorizationEvidenceRef = "EVIDENCE-UNNEEDED-AUTH-1"
	if err := validateDatasetProvenanceRecord(excluded); !errors.Is(err, ErrInvalidDatasetProvenance) {
		t.Fatalf("expected excluded customer content auth ref rejection, got %v", err)
	}

	authorized := datasetProvenanceFixture(t)
	authorized.CustomerContentPolicy = CustomerContentSeparatelyAuthorized
	authorized.ProductionToResearchTransferStatus = ResearchTransferVerificationRequired
	if err := validateDatasetProvenanceRecord(authorized); !errors.Is(err, ErrInvalidDatasetProvenance) {
		t.Fatalf("expected unverified transfer rejection, got %v", err)
	}

	authorized.AuthorizationEvidenceRef = "EVIDENCE-CUSTOMER-CONTENT-AUTH-1"
	authorized.ProductionToResearchTransferStatus = ResearchTransferVerified
	if err := validateDatasetProvenanceRecord(authorized); err != nil {
		t.Fatalf("expected separately authorized record to validate: %v", err)
	}
}

func TestVerifiedForManifestRequiresEveryReferencedDataset(t *testing.T) {
	manifest := verifiedManifest()
	registry := NewDatasetProvenanceRegistry()
	if _, err := registry.VerifiedForManifest(manifest); !errors.Is(err, ErrDatasetProvenanceNotFound) {
		t.Fatalf("expected missing dataset provenance failure, got %v", err)
	}

	if err := registry.Register(datasetProvenanceFixture(t)); err != nil {
		t.Fatalf("register referenced dataset: %v", err)
	}
	resolved, err := registry.VerifiedForManifest(manifest)
	if err != nil {
		t.Fatalf("resolve verified provenance: %v", err)
	}
	if len(resolved) != 1 || resolved[0].DatasetID != manifest.Provenance.DatasetRegistryRefs[0] {
		t.Fatalf("unexpected resolved provenance: %#v", resolved)
	}
}

func TestVerifiedForManifestRequiresRightsAndDeletionVerification(t *testing.T) {
	for name, mutate := range map[string]func(*DatasetProvenanceRecord){
		"rights": func(record *DatasetProvenanceRecord) {
			record.RightsReviewStatus = VerificationRequired
		},
		"deletion lineage": func(record *DatasetProvenanceRecord) {
			record.DeletionLineageStatus = VerificationRequired
		},
	} {
		t.Run(name, func(t *testing.T) {
			registry := NewDatasetProvenanceRegistry()
			record := datasetProvenanceFixture(t)
			mutate(&record)
			if err := registry.Register(record); err != nil {
				t.Fatalf("register verification-required dataset: %v", err)
			}
			if _, err := registry.VerifiedForManifest(verifiedManifest()); !errors.Is(err, ErrDatasetProvenanceNotVerified) {
				t.Fatalf("expected ErrDatasetProvenanceNotVerified, got %v", err)
			}
		})
	}
}

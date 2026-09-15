package modelregistry

import (
	"errors"
	"sort"
	"sync"
)

const (
	datasetProvenanceSchemaVersion   = 1
	datasetClassificationRestricted  = "restricted"
	datasetStorageSegregatedResearch = "segregated_research_storage"
)

type CustomerContentPolicy string
type ResearchTransferStatus string

const (
	CustomerContentExcluded             CustomerContentPolicy = "excluded"
	CustomerContentSeparatelyAuthorized CustomerContentPolicy = "separately_authorized"

	ResearchTransferNotApplicable        ResearchTransferStatus = "not_applicable"
	ResearchTransferVerificationRequired ResearchTransferStatus = "verification_required"
	ResearchTransferVerified             ResearchTransferStatus = "verified"
)

var (
	ErrInvalidDatasetProvenance     = errors.New("invalid VSN dataset provenance record")
	ErrDatasetAlreadyRegistered     = errors.New("VSN dataset provenance record already registered")
	ErrDatasetProvenanceNotFound    = errors.New("VSN dataset provenance record not found")
	ErrDatasetProvenanceNotVerified = errors.New("VSN dataset provenance is not fully verified")
)

type DatasetProvenanceRecord struct {
	SchemaVersion                      int                    `json:"schema_version"`
	DatasetID                          string                 `json:"dataset_id"`
	Classification                     string                 `json:"classification"`
	StorageClass                       string                 `json:"storage_class"`
	CustomerContentPolicy              CustomerContentPolicy  `json:"customer_content_policy"`
	AuthorizationEvidenceRef           string                 `json:"authorization_evidence_ref,omitempty"`
	SourceProvenanceRefs               []string               `json:"source_provenance_refs"`
	RightsReviewStatus                 VerificationState      `json:"rights_review_status"`
	DeletionLineageStatus              VerificationState      `json:"deletion_lineage_status"`
	DeletionLineageRef                 string                 `json:"deletion_lineage_ref"`
	RetentionPolicyRef                 string                 `json:"retention_policy_ref"`
	ProductionToResearchTransferStatus ResearchTransferStatus `json:"production_to_research_transfer_status"`
}

type DatasetProvenanceRegistry struct {
	mu      sync.RWMutex
	records map[string]DatasetProvenanceRecord
}

func NewDatasetProvenanceRegistry() *DatasetProvenanceRegistry {
	return &DatasetProvenanceRegistry{records: make(map[string]DatasetProvenanceRecord)}
}

func (r *DatasetProvenanceRegistry) Register(record DatasetProvenanceRecord) error {
	if r == nil {
		return ErrInvalidDatasetProvenance
	}
	if err := validateDatasetProvenanceRecord(record); err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.records[record.DatasetID]; exists {
		return ErrDatasetAlreadyRegistered
	}
	r.records[record.DatasetID] = cloneDatasetProvenanceRecord(record)
	return nil
}

func (r *DatasetProvenanceRegistry) Get(datasetID string) (DatasetProvenanceRecord, error) {
	if r == nil {
		return DatasetProvenanceRecord{}, ErrDatasetProvenanceNotFound
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.records[datasetID]
	if !ok {
		return DatasetProvenanceRecord{}, ErrDatasetProvenanceNotFound
	}
	return cloneDatasetProvenanceRecord(record), nil
}

func (r *DatasetProvenanceRegistry) Snapshot() []DatasetProvenanceRecord {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]DatasetProvenanceRecord, 0, len(r.records))
	for _, record := range r.records {
		result = append(result, cloneDatasetProvenanceRecord(record))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].DatasetID < result[j].DatasetID
	})
	return result
}

// VerifiedForManifest resolves only the dataset records referenced by one model
// manifest and fails closed unless every referenced record has verified rights
// and deletion-lineage review. It returns metadata only and never authorizes or
// performs training, data transfer or dataset access.
func (r *DatasetProvenanceRegistry) VerifiedForManifest(manifest Manifest) ([]DatasetProvenanceRecord, error) {
	if err := validateManifest(manifest); err != nil {
		return nil, err
	}
	if r == nil {
		return nil, ErrDatasetProvenanceNotFound
	}

	result := make([]DatasetProvenanceRecord, 0, len(manifest.Provenance.DatasetRegistryRefs))
	for _, datasetID := range manifest.Provenance.DatasetRegistryRefs {
		record, err := r.Get(datasetID)
		if err != nil {
			return nil, err
		}
		if record.RightsReviewStatus != VerificationVerified ||
			record.DeletionLineageStatus != VerificationVerified {
			return nil, ErrDatasetProvenanceNotVerified
		}
		result = append(result, record)
	}
	return result, nil
}

func validateDatasetProvenanceRecord(record DatasetProvenanceRecord) error {
	if record.SchemaVersion != datasetProvenanceSchemaVersion ||
		!datasetRefPattern.MatchString(record.DatasetID) ||
		record.Classification != datasetClassificationRestricted ||
		record.StorageClass != datasetStorageSegregatedResearch ||
		!validVerificationState(record.RightsReviewStatus) ||
		!validVerificationState(record.DeletionLineageStatus) ||
		!modelEvidenceRefPattern.MatchString(record.DeletionLineageRef) ||
		!modelEvidenceRefPattern.MatchString(record.RetentionPolicyRef) {
		return ErrInvalidDatasetProvenance
	}
	if len(record.SourceProvenanceRefs) == 0 || len(record.SourceProvenanceRefs) > 64 {
		return ErrInvalidDatasetProvenance
	}
	seen := make(map[string]struct{}, len(record.SourceProvenanceRefs))
	for _, ref := range record.SourceProvenanceRefs {
		if !modelEvidenceRefPattern.MatchString(ref) {
			return ErrInvalidDatasetProvenance
		}
		if _, exists := seen[ref]; exists {
			return ErrInvalidDatasetProvenance
		}
		seen[ref] = struct{}{}
	}

	switch record.CustomerContentPolicy {
	case CustomerContentExcluded:
		if record.AuthorizationEvidenceRef != "" ||
			record.ProductionToResearchTransferStatus != ResearchTransferNotApplicable {
			return ErrInvalidDatasetProvenance
		}
	case CustomerContentSeparatelyAuthorized:
		if !modelEvidenceRefPattern.MatchString(record.AuthorizationEvidenceRef) ||
			record.ProductionToResearchTransferStatus != ResearchTransferVerified {
			return ErrInvalidDatasetProvenance
		}
	default:
		return ErrInvalidDatasetProvenance
	}
	return nil
}

func cloneDatasetProvenanceRecord(record DatasetProvenanceRecord) DatasetProvenanceRecord {
	record.SourceProvenanceRefs = append([]string(nil), record.SourceProvenanceRefs...)
	return record
}

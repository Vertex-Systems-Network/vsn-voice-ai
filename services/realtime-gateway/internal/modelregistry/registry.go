package modelregistry

import (
	"errors"
	"regexp"
	"sort"
	"sync"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

type LifecycleState string

type VerificationState string

const (
	LifecycleRegistered           LifecycleState = "registered"
	LifecycleVerificationRequired LifecycleState = "verification_required"
	LifecycleVerified             LifecycleState = "verified"
	LifecycleDeprecated           LifecycleState = "deprecated"

	VerificationRequired VerificationState = "verification_required"
	VerificationVerified VerificationState = "verified"

	ArtifactFormatONNX = "onnx"
)

var (
	ErrInvalidManifest       = errors.New("invalid VSN model manifest")
	ErrModelAlreadyRegistered = errors.New("VSN model version already registered")
	ErrModelNotFound          = errors.New("VSN model version not found")

	modelIDPattern    = regexp.MustCompile(`^vsn-[a-z0-9][a-z0-9._-]{0,62}$`)
	modelVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]{1,32})?$`)
	artifactIDPattern = regexp.MustCompile(`^MODELART-[A-Z0-9][A-Z0-9._-]{0,63}$`)
	sha256Pattern     = regexp.MustCompile(`^[a-f0-9]{64}$`)
	datasetRefPattern = regexp.MustCompile(`^DATASET-[A-Z0-9][A-Z0-9._-]{0,63}$`)
)

const zeroSHA256 = "0000000000000000000000000000000000000000000000000000000000000000"

type Artifact struct {
	ArtifactID string `json:"artifact_id"`
	Format     string `json:"format"`
	SHA256     string `json:"sha256"`
}

type Provenance struct {
	DatasetRegistryRefs  []string          `json:"dataset_registry_refs"`
	RightsReviewStatus   VerificationState `json:"rights_review_status"`
	DeletionLineageStatus VerificationState `json:"deletion_lineage_status"`
}

type Verification struct {
	ArtifactIntegrity VerificationState `json:"artifact_integrity"`
	Benchmark         VerificationState `json:"benchmark"`
	SecurityReview    VerificationState `json:"security_review"`
	Rollback          VerificationState `json:"rollback"`
}

type Manifest struct {
	SchemaVersion  int                   `json:"schema_version"`
	ModelID        string                `json:"model_id"`
	ModelVersion   string                `json:"model_version"`
	LifecycleState LifecycleState        `json:"lifecycle_state"`
	Capabilities   []provider.Capability `json:"capabilities"`
	Artifact       Artifact              `json:"artifact"`
	Provenance     Provenance            `json:"provenance"`
	Verification   Verification          `json:"verification"`
}

type Registry struct {
	mu     sync.RWMutex
	models map[string]Manifest
}

func NewRegistry() *Registry {
	return &Registry{models: make(map[string]Manifest)}
}

func (r *Registry) Register(manifest Manifest) error {
	if err := validateManifest(manifest); err != nil {
		return err
	}

	key := manifestKey(manifest.ModelID, manifest.ModelVersion)
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.models[key]; exists {
		return ErrModelAlreadyRegistered
	}
	r.models[key] = cloneManifest(manifest)
	return nil
}

func (r *Registry) Get(modelID string, modelVersion string) (Manifest, error) {
	key := manifestKey(modelID, modelVersion)
	r.mu.RLock()
	defer r.mu.RUnlock()
	manifest, ok := r.models[key]
	if !ok {
		return Manifest{}, ErrModelNotFound
	}
	return cloneManifest(manifest), nil
}

func (r *Registry) Snapshot() []Manifest {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]Manifest, 0, len(r.models))
	for _, manifest := range r.models {
		result = append(result, cloneManifest(manifest))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ModelID == result[j].ModelID {
			return result[i].ModelVersion < result[j].ModelVersion
		}
		return result[i].ModelID < result[j].ModelID
	})
	return result
}

func validateManifest(manifest Manifest) error {
	if manifest.SchemaVersion != 1 ||
		!modelIDPattern.MatchString(manifest.ModelID) ||
		!modelVersionPattern.MatchString(manifest.ModelVersion) ||
		!validLifecycleState(manifest.LifecycleState) {
		return ErrInvalidManifest
	}
	if err := validateCapabilities(manifest.Capabilities); err != nil {
		return err
	}
	if !artifactIDPattern.MatchString(manifest.Artifact.ArtifactID) ||
		manifest.Artifact.Format != ArtifactFormatONNX ||
		!sha256Pattern.MatchString(manifest.Artifact.SHA256) ||
		manifest.Artifact.SHA256 == zeroSHA256 {
		return ErrInvalidManifest
	}
	if err := validateDatasetRefs(manifest.Provenance.DatasetRegistryRefs); err != nil {
		return err
	}
	if !validVerificationState(manifest.Provenance.RightsReviewStatus) ||
		!validVerificationState(manifest.Provenance.DeletionLineageStatus) ||
		!validVerificationState(manifest.Verification.ArtifactIntegrity) ||
		!validVerificationState(manifest.Verification.Benchmark) ||
		!validVerificationState(manifest.Verification.SecurityReview) ||
		!validVerificationState(manifest.Verification.Rollback) {
		return ErrInvalidManifest
	}
	if manifest.LifecycleState == LifecycleVerified && !allVerificationGatesPassed(manifest) {
		return ErrInvalidManifest
	}
	return nil
}

func validateCapabilities(capabilities []provider.Capability) error {
	if len(capabilities) == 0 || len(capabilities) > 20 {
		return ErrInvalidManifest
	}
	seen := make(map[provider.Capability]struct{}, len(capabilities))
	for _, capability := range capabilities {
		if !validCapability(capability) {
			return ErrInvalidManifest
		}
		if _, exists := seen[capability]; exists {
			return ErrInvalidManifest
		}
		seen[capability] = struct{}{}
	}
	return nil
}

func validateDatasetRefs(refs []string) error {
	if len(refs) == 0 || len(refs) > 64 {
		return ErrInvalidManifest
	}
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if !datasetRefPattern.MatchString(ref) {
			return ErrInvalidManifest
		}
		if _, exists := seen[ref]; exists {
			return ErrInvalidManifest
		}
		seen[ref] = struct{}{}
	}
	return nil
}

func validLifecycleState(state LifecycleState) bool {
	switch state {
	case LifecycleRegistered, LifecycleVerificationRequired, LifecycleVerified, LifecycleDeprecated:
		return true
	default:
		return false
	}
}

func validVerificationState(state VerificationState) bool {
	return state == VerificationRequired || state == VerificationVerified
}

func allVerificationGatesPassed(manifest Manifest) bool {
	return manifest.Provenance.RightsReviewStatus == VerificationVerified &&
		manifest.Provenance.DeletionLineageStatus == VerificationVerified &&
		manifest.Verification.ArtifactIntegrity == VerificationVerified &&
		manifest.Verification.Benchmark == VerificationVerified &&
		manifest.Verification.SecurityReview == VerificationVerified &&
		manifest.Verification.Rollback == VerificationVerified
}

func validCapability(capability provider.Capability) bool {
	switch capability {
	case provider.CapabilityNoiseCancel,
		provider.CapabilityBackgroundVoice,
		provider.CapabilityEchoReduce,
		provider.CapabilityVAD,
		provider.CapabilityAccentConvert,
		provider.CapabilityIdentityPreserve,
		provider.CapabilityDeepfakeDetect,
		provider.CapabilitySpeakerVerify,
		provider.CapabilityTranslateRealtime,
		provider.CapabilityTranscribeStream,
		provider.CapabilityTranscribeFinalize,
		provider.CapabilitySynthesize,
		provider.CapabilityMeetingCapture,
		provider.CapabilityMeetingTranscript,
		provider.CapabilityMeetingIntelligence,
		provider.CapabilityConversationScore,
		provider.CapabilityKnowledgeSearch,
		provider.CapabilityAssistantRealtime,
		provider.CapabilityAgentAction,
		provider.CapabilityTelephonyMedia:
		return true
	default:
		return false
	}
}

func manifestKey(modelID string, modelVersion string) string {
	return modelID + "@" + modelVersion
}

func cloneManifest(manifest Manifest) Manifest {
	manifest.Capabilities = append([]provider.Capability(nil), manifest.Capabilities...)
	manifest.Provenance.DatasetRegistryRefs = append([]string(nil), manifest.Provenance.DatasetRegistryRefs...)
	return manifest
}

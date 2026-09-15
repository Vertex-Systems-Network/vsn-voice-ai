package modelregistry

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
)

var (
	ErrInvalidArtifactDigestPolicy = errors.New("invalid artifact digest verification policy")
	ErrArtifactTooLarge            = errors.New("model artifact exceeds configured verification bound")
	ErrArtifactDigestMismatch      = errors.New("model artifact digest mismatch")
)

// ArtifactDigestPolicy makes the caller choose an explicit resource bound for
// digest verification. The registry does not invent one global model-size cap.
type ArtifactDigestPolicy struct {
	MaxBytes int64
}

// ArtifactDigestResult contains only content-safe integrity metadata. It never
// includes model bytes, storage paths, URLs, signatures, credentials or dataset
// content and does not mutate the manifest verification state.
type ArtifactDigestResult struct {
	ArtifactID     string `json:"artifact_id"`
	ExpectedSHA256 string `json:"expected_sha256"`
	ObservedSHA256 string `json:"observed_sha256"`
	BytesRead      int64  `json:"bytes_read"`
	DigestMatches  bool   `json:"digest_matches"`
}

// VerifyArtifactDigest hashes caller-supplied artifact bytes inside an explicit
// byte bound and compares them with the immutable manifest digest. A successful
// digest match is integrity evidence only; it is not signature/release
// provenance, provider activation, deployment approval or a manifest mutation.
func VerifyArtifactDigest(manifest Manifest, reader io.Reader, policy ArtifactDigestPolicy) (ArtifactDigestResult, error) {
	if reader == nil || policy.MaxBytes <= 0 {
		return ArtifactDigestResult{}, ErrInvalidArtifactDigestPolicy
	}
	if err := validateManifest(manifest); err != nil {
		return ArtifactDigestResult{}, err
	}

	hasher := sha256.New()
	limited := &io.LimitedReader{R: reader, N: policy.MaxBytes + 1}
	bytesRead, err := io.Copy(hasher, limited)
	if err != nil {
		return ArtifactDigestResult{}, err
	}

	observed := hex.EncodeToString(hasher.Sum(nil))
	result := ArtifactDigestResult{
		ArtifactID:     manifest.Artifact.ArtifactID,
		ExpectedSHA256: manifest.Artifact.SHA256,
		ObservedSHA256: observed,
		BytesRead:      bytesRead,
		DigestMatches:  false,
	}
	if bytesRead > policy.MaxBytes {
		return result, ErrArtifactTooLarge
	}

	result.DigestMatches = observed == manifest.Artifact.SHA256
	if !result.DigestMatches {
		return result, ErrArtifactDigestMismatch
	}
	return result, nil
}

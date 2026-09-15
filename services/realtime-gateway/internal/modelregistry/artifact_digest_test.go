package modelregistry

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const syntheticArtifactSHA256 = "32c8b2f8b800da1ca3f48c1b3e5ccb2446a6fc994483ec6d25a314245c9d0971"

func digestManifest() Manifest {
	manifest := pendingManifest()
	manifest.Artifact.SHA256 = syntheticArtifactSHA256
	return manifest
}

func TestVerifyArtifactDigestMatchesInsideExplicitBound(t *testing.T) {
	manifest := digestManifest()
	result, err := VerifyArtifactDigest(
		manifest,
		strings.NewReader("synthetic-vsn-model-bytes"),
		ArtifactDigestPolicy{MaxBytes: 1024},
	)
	if err != nil {
		t.Fatalf("verify artifact digest: %v", err)
	}
	if !result.DigestMatches {
		t.Fatal("expected digest match")
	}
	if result.ArtifactID != manifest.Artifact.ArtifactID ||
		result.ExpectedSHA256 != syntheticArtifactSHA256 ||
		result.ObservedSHA256 != syntheticArtifactSHA256 ||
		result.BytesRead != 25 {
		t.Fatalf("unexpected content-safe digest result: %#v", result)
	}
	if manifest.Verification.ArtifactIntegrity != VerificationRequired {
		t.Fatal("digest verification unexpectedly mutated manifest verification state")
	}
}

func TestVerifyArtifactDigestFailsClosedOnMismatch(t *testing.T) {
	manifest := digestManifest()
	result, err := VerifyArtifactDigest(
		manifest,
		strings.NewReader("different-model-bytes"),
		ArtifactDigestPolicy{MaxBytes: 1024},
	)
	if !errors.Is(err, ErrArtifactDigestMismatch) {
		t.Fatalf("expected ErrArtifactDigestMismatch, got %v", err)
	}
	if result.DigestMatches {
		t.Fatal("mismatched artifact reported a match")
	}
	if result.ExpectedSHA256 != syntheticArtifactSHA256 || result.ObservedSHA256 == "" {
		t.Fatalf("unexpected mismatch evidence: %#v", result)
	}
}

func TestVerifyArtifactDigestStopsAfterConfiguredBoundPlusSentinelByte(t *testing.T) {
	manifest := digestManifest()
	payload := bytes.Repeat([]byte("x"), 4096)
	result, err := VerifyArtifactDigest(
		manifest,
		bytes.NewReader(payload),
		ArtifactDigestPolicy{MaxBytes: 128},
	)
	if !errors.Is(err, ErrArtifactTooLarge) {
		t.Fatalf("expected ErrArtifactTooLarge, got %v", err)
	}
	if result.BytesRead != 129 {
		t.Fatalf("expected bounded 129-byte read, got %d", result.BytesRead)
	}
	if result.DigestMatches {
		t.Fatal("oversized artifact reported a digest match")
	}
}

func TestVerifyArtifactDigestRejectsInvalidPolicyReaderAndManifest(t *testing.T) {
	manifest := digestManifest()
	for name, reader, policy := range map[string]struct {
		reader *strings.Reader
		policy ArtifactDigestPolicy
	}{
		"zero bound": {strings.NewReader("data"), ArtifactDigestPolicy{}},
		"negative bound": {strings.NewReader("data"), ArtifactDigestPolicy{MaxBytes: -1}},
		"nil reader": {nil, ArtifactDigestPolicy{MaxBytes: 1024}},
	} {
		t.Run(name, func(t *testing.T) {
			var source interface{ Read([]byte) (int, error) }
			if reader != nil {
				source = reader
			}
			result, err := VerifyArtifactDigest(manifest, source, policy)
			if !errors.Is(err, ErrInvalidArtifactDigestPolicy) {
				t.Fatalf("expected ErrInvalidArtifactDigestPolicy, got %v", err)
			}
			if result != (ArtifactDigestResult{}) {
				t.Fatalf("invalid policy returned evidence: %#v", result)
			}
		})
	}

	invalid := manifest
	invalid.Artifact.SHA256 = strings.Repeat("0", 64)
	if _, err := VerifyArtifactDigest(
		invalid,
		strings.NewReader("synthetic-vsn-model-bytes"),
		ArtifactDigestPolicy{MaxBytes: 1024},
	); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("expected invalid manifest rejection, got %v", err)
	}
}

func TestArtifactDigestResultJSONIsContentSafeMetadataOnly(t *testing.T) {
	result, err := VerifyArtifactDigest(
		digestManifest(),
		strings.NewReader("synthetic-vsn-model-bytes"),
		ArtifactDigestPolicy{MaxBytes: 1024},
	)
	if err != nil {
		t.Fatalf("verify artifact digest: %v", err)
	}
	payload, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal digest result: %v", err)
	}
	text := string(payload)
	for _, forbidden := range []string{
		"artifact_path",
		"artifact_url",
		"credential",
		"dataset",
		"transcript",
		"audio",
		"tenant",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("digest result exposed forbidden field token %q: %s", forbidden, text)
		}
	}
}

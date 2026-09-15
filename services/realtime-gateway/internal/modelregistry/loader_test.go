package modelregistry

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sharedFixture(t *testing.T) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "vsn-model-manifest.json")
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared model manifest fixture: %v", err)
	}
	return payload
}

func TestDecodeManifestAcceptsSharedFixture(t *testing.T) {
	manifest, err := DecodeManifest(bytes.NewReader(sharedFixture(t)))
	if err != nil {
		t.Fatalf("decode shared fixture: %v", err)
	}
	if manifest.ModelID != "vsn-noise-foundation" || manifest.ModelVersion != "0.1.0" {
		t.Fatalf("unexpected fixture identity: %#v", manifest)
	}
	if manifest.LifecycleState != LifecycleVerificationRequired {
		t.Fatalf("unexpected fixture lifecycle: %q", manifest.LifecycleState)
	}
}

func TestRegisterJSONUsesImmutableRegistryBoundary(t *testing.T) {
	registry := NewRegistry()
	fixture := sharedFixture(t)
	if err := registry.RegisterJSON(bytes.NewReader(fixture)); err != nil {
		t.Fatalf("register JSON fixture: %v", err)
	}
	if err := registry.RegisterJSON(bytes.NewReader(fixture)); !errors.Is(err, ErrModelAlreadyRegistered) {
		t.Fatalf("expected immutable duplicate rejection, got %v", err)
	}
}

func TestDecodeManifestRejectsUnknownFields(t *testing.T) {
	fixture := string(sharedFixture(t))
	cases := []string{
		strings.Replace(fixture, "\n}", ",\n  \"tenant_id\": \"tenant_123\"\n}", 1),
		strings.Replace(fixture, "\"format\": \"onnx\",", "\"format\": \"onnx\",\n    \"path\": \"C:\\\\models\\\\secret.onnx\",", 1),
	}
	for index, payload := range cases {
		if _, err := DecodeManifest(strings.NewReader(payload)); !errors.Is(err, ErrInvalidManifest) {
			t.Fatalf("case %d: expected ErrInvalidManifest, got %v", index, err)
		}
	}
}

func TestDecodeManifestRejectsTrailingJSON(t *testing.T) {
	payload := append(sharedFixture(t), []byte("\n{\"schema_version\":1}")...)
	if _, err := DecodeManifest(bytes.NewReader(payload)); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("expected trailing JSON rejection, got %v", err)
	}
}

func TestDecodeManifestRejectsOversizedOrEmptyInput(t *testing.T) {
	if _, err := DecodeManifest(strings.NewReader(strings.Repeat(" ", int(maxManifestBytes)+1))); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("expected oversized input rejection, got %v", err)
	}
	if _, err := DecodeManifest(bytes.NewReader(nil)); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("expected empty input rejection, got %v", err)
	}
	if _, err := DecodeManifest(nil); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("expected nil reader rejection, got %v", err)
	}
}

func TestDecodeManifestReusesRegistryVerificationRules(t *testing.T) {
	payload := string(sharedFixture(t))
	payload = strings.Replace(payload, "\"lifecycle_state\": \"verification_required\"", "\"lifecycle_state\": \"verified\"", 1)
	if _, err := DecodeManifest(strings.NewReader(payload)); !errors.Is(err, ErrInvalidManifest) {
		t.Fatalf("expected premature verified lifecycle rejection, got %v", err)
	}
}

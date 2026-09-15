package modelregistry

import (
	"bytes"
	"encoding/json"
	"io"
)

const maxManifestBytes int64 = 64 * 1024

// DecodeManifest decodes one bounded, closed model-manifest JSON document.
// Unknown fields, trailing JSON values, oversized inputs and registry-invalid
// metadata are rejected before a manifest can enter the in-memory registry.
func DecodeManifest(reader io.Reader) (Manifest, error) {
	if reader == nil {
		return Manifest{}, ErrInvalidManifest
	}

	payload, err := io.ReadAll(io.LimitReader(reader, maxManifestBytes+1))
	if err != nil || len(payload) == 0 || int64(len(payload)) > maxManifestBytes {
		return Manifest{}, ErrInvalidManifest
	}

	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()

	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, ErrInvalidManifest
	}

	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Manifest{}, ErrInvalidManifest
	}
	if err := validateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return cloneManifest(manifest), nil
}

// RegisterJSON decodes and validates one JSON manifest before immutable
// registration. It does not load an artifact or touch the provider registry.
func (r *Registry) RegisterJSON(reader io.Reader) error {
	if r == nil {
		return ErrInvalidManifest
	}
	manifest, err := DecodeManifest(reader)
	if err != nil {
		return err
	}
	return r.Register(manifest)
}

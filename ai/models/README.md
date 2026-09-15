# VSN Model Registry Boundary

This directory is the repository entry point for WU-011 model-registry metadata and policy. It is **not** a model-artifact store and it does not authorize model training, dataset ingestion, paid compute, provider activation, or production deployment.

## Current scope

The registry contract is `packages/contracts/schemas/vsn-model-manifest.schema.json`.

The realtime-gateway module also contains an in-memory metadata registry at `services/realtime-gateway/internal/modelregistry`. That registry:

- enforces the same bounded identifiers, capabilities, ONNX artifact digest metadata and provenance/verification states as the JSON contract;
- keeps each `(model_id, model_version)` immutable once registered;
- supports multiple explicit versions of one model;
- returns defensive copies so callers cannot mutate registry-owned metadata;
- exposes a `VerifiedSnapshot` view only for manifests whose lifecycle and all six provenance/verification gates are verified;
- provides a bounded JSON loader that rejects unknown fields, oversized manifests and trailing JSON values;
- provides an immutable metadata-only dataset provenance registry for the opaque `DATASET-*` references used by model manifests;
- binds verification evidence references to the exact model/version/artifact digest and dataset registry set before a provider candidate can be projected;
- can project fully verified, evidence-bound model metadata into an explicitly disabled provider-registration candidate without activating routing;
- does not register, enable, mutate or otherwise activate anything in the provider routing registry.

A manifest may record only bounded operational metadata:

- a VSN model identifier and semantic version;
- normalized provider-gateway capabilities;
- an opaque model-artifact identifier;
- ONNX artifact SHA-256 integrity metadata;
- opaque dataset-registry references;
- provenance/rights and deletion-lineage review state;
- artifact-integrity, benchmark, security-review and rollback verification state.

The manifest intentionally has no artifact URL/path, tenant/customer identity, raw dataset content, transcript/audio content, credentials, free-form notes, provider ID, `enabled`, or routing-eligibility field.

## Fail-closed lifecycle

Allowed lifecycle states are:

- `registered`
- `verification_required`
- `verified`
- `deprecated`

`verified` is schema-valid and registry-valid only when all provenance and verification gates are `verified`:

- dataset rights review;
- dataset deletion-lineage review;
- artifact integrity;
- benchmark evidence;
- security review;
- rollback evidence.

A registry manifest never makes a model routable by itself. `VerifiedSnapshot` is only a filtered metadata view. A separately verified runtime/provider adapter must translate an approved VSN model into the existing `ProviderManifest` contract, and the provider gateway remains the routing authority with its own `Enabled`, `VerifiedAccess`, health and rate-limit gates.

## Data and training boundary

`DATA-010` classifies VSN proprietary training/evaluation datasets and model artifacts as restricted. Customer content is excluded from training by default. `THREAT-010` requires explicit rights/provenance controls before customer content can enter proprietary training/evaluation data.

Therefore, repository work in this directory must not:

- commit model binaries (`.onnx`, PyTorch checkpoints, weights or equivalent artifacts);
- commit datasets, raw audio, transcripts, voice embeddings or production customer content;
- embed model/dataset storage URLs, filesystem paths, credentials or signed download links in manifests;
- copy production customer content into research fixtures;
- run model training or material paid GPU workloads without the separate authorization required by WU-011;
- mark benchmark, security, provenance or rollback gates `verified` without repository-backed review evidence.

## Dataset provenance registry boundary

`packages/contracts/schemas/vsn-dataset-provenance.schema.json` defines a metadata-only record for one restricted `DATA-010` dataset identity. It never carries dataset bytes, audio, transcripts, embeddings, tenant identifiers, storage paths/URLs, credentials or free-form notes.

The record locks storage to the `segregated_research_storage` class and carries only bounded evidence references for source provenance, rights review, deletion lineage and retention policy. `DatasetProvenanceRegistry` stores those records immutably in-process and returns defensive copies.

Customer content is fail-closed:

- `customer_content_policy=excluded` permits no authorization reference and requires `production_to_research_transfer_status=not_applicable`;
- `customer_content_policy=separately_authorized` requires an opaque authorization evidence reference and a verified production-to-research transfer status;
- neither mode moves, reads or grants access to any dataset.

`VerifiedForManifest` resolves only dataset IDs explicitly referenced by a model manifest and fails unless every referenced record exists with verified rights review and verified deletion-lineage review. A `verified` metadata status still identifies repository/runtime state only; it does not independently prove the external evidence record is valid or grant training authorization.

## Artifact integrity evidence boundary

`VerifyArtifactDigest` accepts model bytes only through a caller-supplied `io.Reader` and requires the caller to provide an explicit positive `MaxBytes` policy. The model registry does not invent one global model-size ceiling.

The verifier:

- hashes at most `MaxBytes + 1` bytes so oversize inputs fail closed without reading an unbounded stream;
- compares the observed SHA-256 with the immutable manifest digest;
- returns only content-safe metadata: artifact ID, expected/observed digests, byte count and match state;
- does not retain or return model bytes;
- does not resolve artifact paths or URLs;
- does not fetch or store artifacts;
- does not verify signatures or release provenance;
- does not mutate `verification.artifact_integrity` or any other manifest state;
- does not register or enable a provider.

A digest match is integrity evidence only. A separate reviewed process must decide whether artifact-integrity evidence is sufficient to update registry metadata, and signing/release provenance remains a separate `THREAT-007` control.

## Verification evidence bundle boundary

`packages/contracts/schemas/vsn-model-verification-evidence.schema.json` defines a content-safe evidence-reference bundle for one exact VSN model artifact. It carries no reports, customer content, datasets, paths, URLs or credentials. It binds:

- model ID and semantic version;
- artifact ID and SHA-256;
- the exact set of opaque dataset-registry references;
- opaque dataset-provenance evidence references;
- leakage-test evidence;
- model-regression evidence;
- benchmark evidence;
- security-review evidence;
- rollback evidence;
- artifact-integrity evidence.

`ValidateVerificationEvidence` rejects malformed evidence identifiers, duplicate/reused gate references, artifact/model identity mismatches and dataset-set mismatches. Evidence references identify reviewed records; their presence does **not** prove that the referenced review was valid, sufficient or approved. This layer only prevents a candidate from being assembled against evidence belonging to another model, version, artifact or dataset set.

## Disabled provider candidate boundary

`BuildDisabledProviderCandidate` accepts only a fully verified model manifest plus a verification-evidence bundle that matches the same model/version/artifact digest and dataset registry set. Runtime identity choices that are intentionally absent from model metadata—provider ID and access mode—must be supplied explicitly by the caller.

Provider-candidate schema version 2 carries the opaque `verification_evidence_id` for downstream traceability. The projection copies model/version/artifact provenance plus normalized capabilities, but the generated `ProviderManifest` is always:

- `enabled=false`;
- `verified_access=false`;
- `health=unhealthy`;
- `rate_limit=unknown`;
- empty for region, retention, latency, quality, privacy, cost and quota metadata that has not been separately verified.

Candidate creation does not write to the provider registry. Even if the disabled candidate is explicitly registered there, the existing router rejects it because `Enabled` is false. A separate, reviewed runtime-access and operational-verification process is required before any later activation change.

## Artifact delivery boundary

Production model artifacts belong in the approved encrypted artifact/model store, outside Git. Delivery must eventually satisfy the model/update supply-chain controls from `THREAT-007`, including digest verification, signed artifacts where required, staged rollout and rollback. The manifest SHA-256 is integrity metadata; it is not a substitute for signing or release provenance.

## Next implementation slice

A later WU-011 slice may require verified dataset-provenance registry resolution as an input to provider-candidate projection, then define a reviewed activation-evidence boundary for runtime access, signature/release provenance, benchmark thresholds and rollback readiness without making activation automatic. Runtime loading, artifact retrieval/signature verification, production provider activation, datasets and model training remain separate authorization and verification work.

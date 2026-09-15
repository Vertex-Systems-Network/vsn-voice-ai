# VSN Model Registry Boundary

This directory is the repository entry point for WU-011 model-registry metadata and policy. It is **not** a model-artifact store and it does not authorize model training, dataset ingestion, paid compute, provider activation, or production deployment.

## Current scope

The first registry contract is `packages/contracts/schemas/vsn-model-manifest.schema.json`.

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

`verified` is schema-valid only when all provenance and verification gates are `verified`:

- dataset rights review;
- dataset deletion-lineage review;
- artifact integrity;
- benchmark evidence;
- security review;
- rollback evidence.

A registry manifest never makes a model routable by itself. A separately verified runtime/provider adapter must translate an approved VSN model into the existing `ProviderManifest` contract, and the provider gateway remains the routing authority.

## Data and training boundary

`DATA-010` classifies VSN proprietary training/evaluation datasets and model artifacts as restricted. Customer content is excluded from training by default. `THREAT-010` requires explicit rights/provenance controls before customer content can enter proprietary training/evaluation data.

Therefore, repository work in this directory must not:

- commit model binaries (`.onnx`, PyTorch checkpoints, weights or equivalent artifacts);
- commit datasets, raw audio, transcripts, voice embeddings or production customer content;
- embed model/dataset storage URLs, filesystem paths, credentials or signed download links in manifests;
- copy production customer content into research fixtures;
- run model training or material paid GPU workloads without the separate authorization required by WU-011;
- mark benchmark, security, provenance or rollback gates `verified` without repository-backed review evidence.

## Artifact delivery boundary

Production model artifacts belong in the approved encrypted artifact/model store, outside Git. Delivery must eventually satisfy the model/update supply-chain controls from `THREAT-007`, including digest verification, signed artifacts where required, staged rollout and rollback. The manifest SHA-256 is integrity metadata; it is not a substitute for signing or release provenance.

## Next implementation slice

A later WU-011 slice may add a metadata registry loader that enforces unique `(model_id, model_version)` entries and exposes only manifests that pass the required verification state. It must remain separate from training/data ingestion and from provider routing activation.

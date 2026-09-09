# ANPOS Pro Premium Pack Boundary

Status: **verification contract + entitlement-gated distribution source implemented — no premium payload or production premium E2E is evidenced**.

This document defines how a future private ANPOS Premium Pack must be structured, certified, pinned and delivered. It does not satisfy the `premium_blueprints` or `premium_provider_adapters` entitlements by itself and does not make ANPOS Pro sale-ready.

## Why the boundary is separate

The public canonical repository contains the reusable ANPOS core protocol and commercial control-plane contracts. Pro must deliver value that is genuinely distinct from that public core. Creating public files and labeling them “premium” would not create a defensible paid package.

Therefore:

- premium customer assets belong in a separate private premium repository or equivalent immutable private artifact;
- canonical source contains only the schema, verifier, safety rules and entitlement/distribution runtime;
- a private pack must be versioned, content-addressed and independently verifiable;
- exact copies of canonical tracked files are rejected as premium payload;
- source-side release/archive routes are not evidence that a private pack exists or is live in production.

## Manifest

Every pack root must contain exactly one `ANPOS-PREMIUM-MANIFEST.json` conforming to `schemas/premium-pack-manifest.schema.json`.

The manifest binds:

- stable `pack_id`;
- semantic `pack_version`;
- supported ANPOS protocol range;
- premium capability IDs;
- provider adapter metadata where applicable;
- every payload file path, asset class, SHA-256, byte count and capability mapping;
- private-distribution and no-secret provenance assertions.

All payload files must live under one of:

- `premium/blueprints/`;
- `premium/providers/`;
- `premium/governance/`;
- `premium/docs/`.

Root-level application/runtime/configuration trees such as `.github/`, `.ai/`, `commercial-service/`, `config/`, `schemas/`, `scripts/` and `tests/` are not premium payload locations.

## Premium blueprints

A premium blueprint must solve a concrete reusable customer problem beyond the public core. Before an asset is marketed, its manifest capability should identify the value it implements and its compatibility assumptions should be tested.

Examples of acceptable future differentiation may include specialized production workflows, domain-specific governance packs or advanced automation recipes, but the actual private assets must exist and be independently useful. The contract does not pre-authorize any particular marketing claim.

## Premium provider adapters

Provider adapters require stricter evidence than merely naming a provider.

Each private adapter must:

- live under `premium/providers/<provider_id>/...`;
- have a matching provider entry in the manifest;
- carry its own adapter version;
- state the provider version/API surface actually tested;
- map to explicit premium capability IDs;
- ship no OAuth tokens, private keys, customer credentials or operator secrets;
- make no partnership/certification claim unless separately and legitimately authorized outside this default contract.

A passing pack verifier proves integrity/declared mapping, not live provider compatibility. Live provider behavior still requires runtime evidence.

## Offline verification

Run from the canonical ANPOS checkout that is intended to certify the pack:

```bash
python scripts/verify_premium_pack.py \
  --repository /path/to/private-premium-checkout \
  --expected-pack-id anpos-premium-pro \
  --expected-pack-version X.Y.Z \
  --expected-protocol-version 1.3.13
```

The verifier fails closed on:

- invalid manifest/schema;
- unsupported protocol range;
- duplicate/unknown capability or provider mappings;
- missing, extra or unmanifested payload files;
- SHA-256 or byte-count mismatch;
- symlinks/path traversal;
- high-confidence secret markers;
- provider adapter files without provider manifest evidence;
- exact byte-for-byte copies of any tracked canonical source file;
- provenance that does not require private immutable distribution.

A successful receipt includes pack/version, file count, total bytes, manifest/content-set digests and the canonical verifier revision/tree when available.

## Source-side distribution runtime

Commercial service **0.3.9** adds conditional premium delivery plumbing while leaving Developer-only operation independent from premium configuration.

When `ANPOS_MARKETPLACE_PLAN_MAP` contains `pro`, `team`, or `enterprise`, full `/api/ready` fails closed unless all of these real external values are configured:

- `ANPOS_PRIVATE_PREMIUM_REPO` — a private premium repository distinct from the private commercial-template repository;
- `ANPOS_PREMIUM_RELEASE_REF` — the exact 40-character immutable premium repository commit SHA;
- `ANPOS_PREMIUM_MANIFEST_SHA256` — copied from the successful offline verifier receipt;
- `ANPOS_PREMIUM_CONTENT_SET_SHA256` — copied from the same successful offline verifier receipt.

A Developer-only paid mapping does **not** require these values.

The runtime uses the separate private Vendor Distribution GitHub App with operation-scoped **Contents: read** access. It fetches `ANPOS-PREMIUM-MANIFEST.json` at the exact configured commit, checks the raw manifest SHA-256, parses the declared protocol/capability/provider/file/provenance contract, recomputes the declared content-set digest, and rejects any mismatch with the offline verifier receipt.

Customer routes are:

- `GET /api/v1/premium/releases/current` — billing-reconciled, identity-authenticated metadata for a customer holding both `premium_blueprints` and `premium_provider_adapters`; organization use also requires an active assigned seat;
- `GET /api/v1/premium/archive` — repeats the premium release gate and returns a temporary GitHub archive redirect for the same exact immutable revision.

The runtime deliberately does not claim to re-perform the offline verifier's filesystem checks over an archive. Instead, the offline verifier certifies the real private checkout, and the production runtime binds the exact immutable commit to the verifier's manifest/content-set digests. A source route, successful build, or valid configuration does not prove the private pack exists or contains useful premium assets.

## Private repository release flow

The operator flow is:

1. implement genuinely premium private assets;
2. build/update `ANPOS-PREMIUM-MANIFEST.json` with exact digests;
3. run `scripts/verify_premium_pack.py` from the exact canonical ANPOS revision intended to support the pack;
4. retain the successful JSON receipt;
5. commit the verified private pack and record that exact private commit SHA;
6. configure the distinct private repo, exact commit SHA, manifest SHA and content-set SHA from the retained receipt;
7. ensure the Vendor Distribution App has only the required read access to the premium repository;
8. activate a higher paid Marketplace mapping only after the premium configuration is real;
9. verify `/api/ready`, purchase/entitlement → premium release metadata → archive E2E in production;
10. only then change `premium_blueprints` / `premium_provider_adapters` product truth from planned to implemented as supported by evidence.

## Current readiness

Current canonical source truth for this lane is:

- premium contract/schema/offline verifier: **implemented**;
- entitlement-gated immutable premium distribution source: **implemented in commercial service 0.3.9**;
- conditional higher-tier readiness configuration: **implemented in source**;
- private premium repository: **not evidenced**;
- premium blueprint payload: **not implemented/evidenced**;
- premium provider adapter payload: **not implemented/evidenced**;
- live entitlement-gated premium distribution: **not verified**;
- Pro production E2E: **not verified**;
- Pro sale-ready: **false**.

The implemented source is preparation for a real paid layer, not proof that the paid layer exists in production.

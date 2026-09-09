import assert from "node:assert/strict";
import test from "node:test";
import { PLAN_FEATURES } from "../lib/plans";
import { parsePremiumReleaseManifest } from "../lib/premium-releases";

function manifest() {
  return {
    schema_version: 1,
    pack_id: "anpos-premium-pro",
    pack_version: "1.0.0",
    source_protocol_compatibility: { minimum: "1.3.13", maximum: "1.3.13" },
    capabilities: [
      {
        id: "premium_delivery_workflow",
        display_name: "Premium Delivery Workflow",
        asset_classes: ["premium_blueprint", "premium_documentation"],
      },
      {
        id: "premium_provider_automation",
        display_name: "Premium Provider Automation",
        asset_classes: ["premium_provider_adapter"],
      },
    ],
    providers: [
      {
        provider_id: "example",
        adapter_version: "1.0.0",
        tested_provider_version_or_api: "test-api-v1",
        capability_ids: ["premium_provider_automation"],
        partnership_or_certification_claim: false,
      },
    ],
    files: [
      {
        path: "premium/blueprints/delivery.md",
        asset_class: "premium_blueprint",
        sha256: "1".repeat(64),
        bytes: 11,
        capability_ids: ["premium_delivery_workflow"],
      },
      {
        path: "premium/providers/example/adapter.ts",
        asset_class: "premium_provider_adapter",
        sha256: "2".repeat(64),
        bytes: 13,
        capability_ids: ["premium_provider_automation"],
      },
    ],
    provenance: {
      distribution_scope: "private_premium_repository",
      contains_customer_secrets: false,
      contains_operator_secrets: false,
      derived_only_from_public_core: false,
      immutable_release_identity_required: true,
    },
  };
}

test("premium release manifest produces deterministic immutable release metadata", () => {
  const parsed = parsePremiumReleaseManifest(manifest(), "1.3.13");
  assert.equal(parsed.pack_id, "anpos-premium-pro");
  assert.equal(parsed.pack_version, "1.0.0");
  assert.deepEqual(parsed.capability_ids, ["premium_delivery_workflow", "premium_provider_automation"]);
  assert.deepEqual(parsed.provider_ids, ["example"]);
  assert.equal(parsed.file_count, 2);
  assert.equal(parsed.total_bytes, 24);
  assert.match(parsed.content_set_sha256, /^[a-f0-9]{64}$/);
  assert.equal(parsed.distribution_scope, "private_premium_repository");
  assert.equal(parsed.derived_only_from_public_core, false);
  assert.equal(parsed.immutable_release_identity_required, true);

  const reordered = manifest();
  reordered.files.reverse();
  assert.equal(
    parsePremiumReleaseManifest(reordered, "1.3.13").content_set_sha256,
    parsed.content_set_sha256,
  );
});

test("premium release manifest rejects incompatible ANPOS protocol", () => {
  const value = manifest();
  value.source_protocol_compatibility = { minimum: "1.3.10", maximum: "1.3.12" };
  assert.throws(() => parsePremiumReleaseManifest(value, "1.3.13"), /PREMIUM_RELEASE_PROTOCOL_NOT_COMPATIBLE/);
});

test("premium release manifest rejects invalid provenance and provider claims", () => {
  const provenance = manifest();
  provenance.provenance.derived_only_from_public_core = true;
  assert.throws(() => parsePremiumReleaseManifest(provenance, "1.3.13"), /UNVERIFIED_PREMIUM_PROVENANCE/);

  const partnership = manifest();
  partnership.providers[0].partnership_or_certification_claim = true;
  assert.throws(() => parsePremiumReleaseManifest(partnership, "1.3.13"), /PREMIUM_PROVIDER_PARTNERSHIP_CLAIM_FORBIDDEN/);
});

test("premium provider adapter requires matching provider capability mapping", () => {
  const missingProvider = manifest();
  missingProvider.providers = [];
  assert.throws(() => parsePremiumReleaseManifest(missingProvider, "1.3.13"), /PREMIUM_PROVIDER_MANIFEST_ENTRY_REQUIRED/);

  const wrongCapability = manifest();
  wrongCapability.providers[0].capability_ids = ["premium_delivery_workflow"];
  assert.throws(() => parsePremiumReleaseManifest(wrongCapability, "1.3.13"), /PREMIUM_PROVIDER_CAPABILITY_MISMATCH/);
});

test("premium manifest binds path class digest and byte constraints", () => {
  const unsafePath = manifest();
  unsafePath.files[0].path = "../premium.md";
  assert.throws(() => parsePremiumReleaseManifest(unsafePath, "1.3.13"), /INVALID_PREMIUM_FILE_PATH/);

  const wrongClass = manifest();
  wrongClass.files[0].asset_class = "premium_documentation";
  assert.throws(() => parsePremiumReleaseManifest(wrongClass, "1.3.13"), /PREMIUM_ASSET_CLASS_PATH_MISMATCH/);

  const badDigest = manifest();
  badDigest.files[0].sha256 = "bad";
  assert.throws(() => parsePremiumReleaseManifest(badDigest, "1.3.13"), /INVALID_PREMIUM_FILE_DIGEST/);

  const badBytes = manifest();
  badBytes.files[0].bytes = 0;
  assert.throws(() => parsePremiumReleaseManifest(badBytes, "1.3.13"), /INVALID_PREMIUM_FILE_SIZE/);
});

test("Developer stays non-premium while Pro Team Enterprise include both premium entitlements", () => {
  assert.equal(PLAN_FEATURES.developer.includes("premium_blueprints"), false);
  assert.equal(PLAN_FEATURES.developer.includes("premium_provider_adapters"), false);
  for (const planId of ["pro", "team", "enterprise"] as const) {
    assert.ok(PLAN_FEATURES[planId].includes("premium_blueprints"));
    assert.ok(PLAN_FEATURES[planId].includes("premium_provider_adapters"));
  }
  assert.ok(PLAN_FEATURES.pro.includes("hosted_orchestrator_when_offered"));
});

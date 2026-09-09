import assert from "node:assert/strict";
import test from "node:test";
import { PLAN_FEATURES } from "../lib/plans";
import { parseTemplateReleaseManifest } from "../lib/releases";

function manifest() {
  return {
    schema_version: 1,
    export_mode: "template",
    source_revision: "1".repeat(40),
    source_tree: "2".repeat(40),
    source_scope: "canonical-minus-vendor-only-paths",
    source_material: "committed_git_blobs_at_head",
    tracked_source_only: true,
    contains_secrets: false,
    files: [
      {
        path: "START-HERE.md",
        origin: "START-HERE.md",
        git_mode: "100644",
        git_object: "3".repeat(40),
        size: 3,
        sha256: "4".repeat(64),
      },
    ],
    file_count: 1,
    total_bytes: 3,
  };
}

test("certified release manifest requires deterministic template export evidence", () => {
  const parsed = parseTemplateReleaseManifest(manifest());
  assert.equal(parsed.export_mode, "template");
  assert.equal(parsed.source_revision, "1".repeat(40));
  assert.equal(parsed.source_tree, "2".repeat(40));
  assert.equal(parsed.tracked_source_only, true);
  assert.equal(parsed.contains_secrets, false);
  assert.equal(parsed.file_count, 1);
  assert.equal(parsed.total_bytes, 3);
});

test("commercial release manifest rejects mutable or unverifiable identity", () => {
  const mutable = { ...manifest(), source_revision: "main" };
  assert.throws(() => parseTemplateReleaseManifest(mutable), /INVALID_COMMERCIAL_RELEASE_SOURCE_IDENTITY/);

  const unverified = { ...manifest(), tracked_source_only: false };
  assert.throws(() => parseTemplateReleaseManifest(unverified), /UNVERIFIED_COMMERCIAL_RELEASE_MANIFEST/);

  const wrongMode = { ...manifest(), export_mode: "service" };
  assert.throws(() => parseTemplateReleaseManifest(wrongMode), /INVALID_COMMERCIAL_RELEASE_MANIFEST/);
});

test("commercial release manifest binds file count bytes paths and digests", () => {
  assert.throws(
    () => parseTemplateReleaseManifest({ ...manifest(), file_count: 2 }),
    /COMMERCIAL_RELEASE_FILE_COUNT_MISMATCH/,
  );
  assert.throws(
    () => parseTemplateReleaseManifest({ ...manifest(), total_bytes: 4 }),
    /COMMERCIAL_RELEASE_TOTAL_BYTES_MISMATCH/,
  );
  const unsafePath = manifest();
  unsafePath.files[0].path = "../secret";
  assert.throws(() => parseTemplateReleaseManifest(unsafePath), /INVALID_COMMERCIAL_RELEASE_FILE_PATH/);

  const badDigest = manifest();
  badDigest.files[0].sha256 = "not-a-digest";
  assert.throws(() => parseTemplateReleaseManifest(badDigest), /INVALID_COMMERCIAL_RELEASE_FILE_DIGEST/);
});

test("paid plans include certified update channel while provider compatibility stays core", () => {
  assert.deepEqual(PLAN_FEATURES.developer, ["private_template_access", "protocol_update_channel"]);
  for (const features of Object.values(PLAN_FEATURES)) {
    assert.ok(features.includes("protocol_update_channel"));
    assert.equal(features.includes("standard_provider_adapters"), false);
  }
});

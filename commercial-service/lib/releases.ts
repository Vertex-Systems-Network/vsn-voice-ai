type ManifestFile = {
  path?: unknown;
  origin?: unknown;
  git_mode?: unknown;
  git_object?: unknown;
  size?: unknown;
  sha256?: unknown;
};

export type VerifiedTemplateRelease = {
  schema_version: 1;
  export_mode: "template";
  source_revision: string;
  source_tree: string;
  source_scope: "canonical-minus-vendor-only-paths";
  source_material: "committed_git_blobs_at_head";
  tracked_source_only: true;
  contains_secrets: false;
  file_count: number;
  total_bytes: number;
};

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_MODE = /^(100644|100755)$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_COMMERCIAL_RELEASE_MANIFEST");
  }
  return value as Record<string, unknown>;
}

function safePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !value.startsWith("/")
    && !value.split("/").includes("..")
    && !/[\r\n]/.test(value);
}

export function parseTemplateReleaseManifest(value: unknown): VerifiedTemplateRelease {
  const manifest = record(value);
  if (manifest.schema_version !== 1 || manifest.export_mode !== "template") {
    throw new Error("INVALID_COMMERCIAL_RELEASE_MANIFEST");
  }
  if (!SHA40.test(String(manifest.source_revision ?? "")) || !SHA40.test(String(manifest.source_tree ?? ""))) {
    throw new Error("INVALID_COMMERCIAL_RELEASE_SOURCE_IDENTITY");
  }
  if (
    manifest.source_scope !== "canonical-minus-vendor-only-paths"
    || manifest.source_material !== "committed_git_blobs_at_head"
    || manifest.tracked_source_only !== true
    || manifest.contains_secrets !== false
  ) {
    throw new Error("UNVERIFIED_COMMERCIAL_RELEASE_MANIFEST");
  }

  const fileCount = Number(manifest.file_count);
  const totalBytes = Number(manifest.total_bytes);
  const files = manifest.files;
  if (!Number.isSafeInteger(fileCount) || fileCount < 1 || !Number.isSafeInteger(totalBytes) || totalBytes < 1 || !Array.isArray(files)) {
    throw new Error("INVALID_COMMERCIAL_RELEASE_MANIFEST");
  }
  if (files.length !== fileCount) throw new Error("COMMERCIAL_RELEASE_FILE_COUNT_MISMATCH");

  let summedBytes = 0;
  const seen = new Set<string>();
  for (const raw of files as ManifestFile[]) {
    const row = record(raw);
    if (!safePath(row.path) || seen.has(row.path)) throw new Error("INVALID_COMMERCIAL_RELEASE_FILE_PATH");
    seen.add(row.path);
    if (typeof row.origin !== "string" || !row.origin || /[\r\n]/.test(row.origin)) {
      throw new Error("INVALID_COMMERCIAL_RELEASE_FILE_ORIGIN");
    }
    if (typeof row.git_mode !== "string" || !SAFE_MODE.test(row.git_mode)) {
      throw new Error("INVALID_COMMERCIAL_RELEASE_FILE_MODE");
    }
    if (row.git_object != null && (typeof row.git_object !== "string" || !SHA40.test(row.git_object))) {
      throw new Error("INVALID_COMMERCIAL_RELEASE_GIT_OBJECT");
    }
    if (typeof row.sha256 !== "string" || !SHA256.test(row.sha256)) {
      throw new Error("INVALID_COMMERCIAL_RELEASE_FILE_DIGEST");
    }
    const size = Number(row.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("INVALID_COMMERCIAL_RELEASE_FILE_SIZE");
    summedBytes += size;
    if (!Number.isSafeInteger(summedBytes)) throw new Error("INVALID_COMMERCIAL_RELEASE_TOTAL_BYTES");
  }
  if (summedBytes !== totalBytes) throw new Error("COMMERCIAL_RELEASE_TOTAL_BYTES_MISMATCH");

  return {
    schema_version: 1,
    export_mode: "template",
    source_revision: String(manifest.source_revision),
    source_tree: String(manifest.source_tree),
    source_scope: "canonical-minus-vendor-only-paths",
    source_material: "committed_git_blobs_at_head",
    tracked_source_only: true,
    contains_secrets: false,
    file_count: fileCount,
    total_bytes: totalBytes,
  };
}

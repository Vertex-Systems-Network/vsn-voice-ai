import { createHash } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const PACK_ID = /^anpos-premium-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPABILITY_ID = /^premium_[a-z0-9_]+$/;
const PROVIDER_ID = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const ALLOWED_ASSET_CLASSES = new Set([
  "premium_blueprint",
  "premium_provider_adapter",
  "premium_governance_recipe",
  "premium_documentation",
]);
const CLASS_PREFIX: Record<string, string> = {
  premium_blueprint: "premium/blueprints/",
  premium_provider_adapter: "premium/providers/",
  premium_governance_recipe: "premium/governance/",
  premium_documentation: "premium/docs/",
};

export type VerifiedPremiumRelease = {
  schema_version: 1;
  pack_id: string;
  pack_version: string;
  source_protocol_compatibility: { minimum: string; maximum: string };
  capability_ids: string[];
  provider_ids: string[];
  file_count: number;
  total_bytes: number;
  content_set_sha256: string;
  distribution_scope: "private_premium_repository";
  contains_customer_secrets: false;
  contains_operator_secrets: false;
  derived_only_from_public_core: false;
  immutable_release_identity_required: true;
};

type Capability = { id: string; assetClasses: Set<string> };
type Provider = { id: string; capabilityIds: Set<string> };

function record(value: unknown, code = "INVALID_PREMIUM_RELEASE_MANIFEST"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.some((item) => typeof item !== "string")) throw new Error(code);
  const result = value as string[];
  if (new Set(result).size !== result.length) throw new Error(code);
  return result;
}

function semverTuple(value: string): [number, number, number] {
  if (!SEMVER.test(value)) throw new Error("INVALID_PREMIUM_RELEASE_SEMVER");
  const [major, minor, patch] = value.split("-", 1)[0].split(".").map(Number);
  return [major, minor, patch];
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function safePayloadPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 300 || value.startsWith("/") || value.includes("\\") || /[\r\n]/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function contentSetDigest(rows: string[]): string {
  return createHash("sha256").update([...rows].sort().join(""), "utf8").digest("hex");
}

export function parsePremiumReleaseManifest(value: unknown, expectedProtocolVersion: string): VerifiedPremiumRelease {
  const manifest = record(value);
  if (manifest.schema_version !== 1) throw new Error("INVALID_PREMIUM_RELEASE_MANIFEST");

  const packId = String(manifest.pack_id ?? "");
  const packVersion = String(manifest.pack_version ?? "");
  if (!PACK_ID.test(packId) || !SEMVER.test(packVersion)) throw new Error("INVALID_PREMIUM_RELEASE_IDENTITY");

  const compatibility = record(manifest.source_protocol_compatibility, "INVALID_PREMIUM_PROTOCOL_COMPATIBILITY");
  const minimum = String(compatibility.minimum ?? "");
  const maximum = String(compatibility.maximum ?? "");
  const minimumTuple = semverTuple(minimum);
  const maximumTuple = semverTuple(maximum);
  const requestedTuple = semverTuple(expectedProtocolVersion);
  if (compareSemver(minimumTuple, maximumTuple) > 0) throw new Error("INVALID_PREMIUM_PROTOCOL_COMPATIBILITY");
  if (compareSemver(requestedTuple, minimumTuple) < 0 || compareSemver(requestedTuple, maximumTuple) > 0) {
    throw new Error("PREMIUM_RELEASE_PROTOCOL_NOT_COMPATIBLE");
  }

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length < 1) throw new Error("INVALID_PREMIUM_CAPABILITIES");
  const capabilities = new Map<string, Capability>();
  for (const raw of manifest.capabilities) {
    const row = record(raw, "INVALID_PREMIUM_CAPABILITY");
    const id = String(row.id ?? "");
    if (!CAPABILITY_ID.test(id) || capabilities.has(id)) throw new Error("INVALID_PREMIUM_CAPABILITY");
    const displayName = String(row.display_name ?? "");
    if (displayName.length < 3 || displayName.length > 120) throw new Error("INVALID_PREMIUM_CAPABILITY");
    const assetClasses = stringArray(row.asset_classes, "INVALID_PREMIUM_CAPABILITY_ASSET_CLASSES");
    if (assetClasses.some((assetClass) => !ALLOWED_ASSET_CLASSES.has(assetClass))) throw new Error("INVALID_PREMIUM_CAPABILITY_ASSET_CLASSES");
    capabilities.set(id, { id, assetClasses: new Set(assetClasses) });
  }

  if (!Array.isArray(manifest.providers)) throw new Error("INVALID_PREMIUM_PROVIDERS");
  const providers = new Map<string, Provider>();
  for (const raw of manifest.providers) {
    const row = record(raw, "INVALID_PREMIUM_PROVIDER");
    const id = String(row.provider_id ?? "");
    if (!PROVIDER_ID.test(id) || providers.has(id)) throw new Error("INVALID_PREMIUM_PROVIDER");
    if (!SEMVER.test(String(row.adapter_version ?? ""))) throw new Error("INVALID_PREMIUM_PROVIDER_VERSION");
    const testedApi = String(row.tested_provider_version_or_api ?? "");
    if (!testedApi || testedApi.length > 160 || /[\r\n]/.test(testedApi)) throw new Error("INVALID_PREMIUM_PROVIDER_API_EVIDENCE");
    if (row.partnership_or_certification_claim !== false) throw new Error("PREMIUM_PROVIDER_PARTNERSHIP_CLAIM_FORBIDDEN");
    const capabilityIds = stringArray(row.capability_ids, "INVALID_PREMIUM_PROVIDER_CAPABILITIES");
    if (capabilityIds.some((idValue) => !capabilities.has(idValue))) throw new Error("PREMIUM_PROVIDER_UNKNOWN_CAPABILITY");
    providers.set(id, { id, capabilityIds: new Set(capabilityIds) });
  }

  if (!Array.isArray(manifest.files) || manifest.files.length < 1) throw new Error("INVALID_PREMIUM_FILES");
  const seenPaths = new Set<string>();
  const contentRows: string[] = [];
  let totalBytes = 0;
  for (const raw of manifest.files) {
    const row = record(raw, "INVALID_PREMIUM_FILE");
    if (!safePayloadPath(row.path) || seenPaths.has(row.path)) throw new Error("INVALID_PREMIUM_FILE_PATH");
    const path = row.path;
    seenPaths.add(path);

    const assetClass = String(row.asset_class ?? "");
    const expectedPrefix = CLASS_PREFIX[assetClass];
    if (!expectedPrefix || !path.startsWith(expectedPrefix)) throw new Error("PREMIUM_ASSET_CLASS_PATH_MISMATCH");

    const sha256 = String(row.sha256 ?? "");
    if (!SHA256.test(sha256)) throw new Error("INVALID_PREMIUM_FILE_DIGEST");
    const bytes = Number(row.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 10 * 1024 * 1024) throw new Error("INVALID_PREMIUM_FILE_SIZE");
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes)) throw new Error("INVALID_PREMIUM_TOTAL_BYTES");

    const capabilityIds = stringArray(row.capability_ids, "INVALID_PREMIUM_FILE_CAPABILITIES");
    for (const capabilityId of capabilityIds) {
      const capability = capabilities.get(capabilityId);
      if (!capability) throw new Error("PREMIUM_FILE_UNKNOWN_CAPABILITY");
      if (!capability.assetClasses.has(assetClass)) throw new Error("PREMIUM_CAPABILITY_ASSET_CLASS_MISMATCH");
    }

    if (assetClass === "premium_provider_adapter") {
      const parts = path.split("/");
      if (parts.length < 4 || parts[0] !== "premium" || parts[1] !== "providers") throw new Error("INVALID_PREMIUM_PROVIDER_FILE_PATH");
      const provider = providers.get(parts[2]);
      if (!provider) throw new Error("PREMIUM_PROVIDER_MANIFEST_ENTRY_REQUIRED");
      if (capabilityIds.some((capabilityId) => !provider.capabilityIds.has(capabilityId))) {
        throw new Error("PREMIUM_PROVIDER_CAPABILITY_MISMATCH");
      }
    }

    contentRows.push(`${path}\0${sha256}\0${bytes}\n`);
  }

  const provenance = record(manifest.provenance, "INVALID_PREMIUM_PROVENANCE");
  if (
    provenance.distribution_scope !== "private_premium_repository"
    || provenance.contains_customer_secrets !== false
    || provenance.contains_operator_secrets !== false
    || provenance.derived_only_from_public_core !== false
    || provenance.immutable_release_identity_required !== true
  ) {
    throw new Error("UNVERIFIED_PREMIUM_PROVENANCE");
  }

  return {
    schema_version: 1,
    pack_id: packId,
    pack_version: packVersion,
    source_protocol_compatibility: { minimum, maximum },
    capability_ids: [...capabilities.keys()].sort(),
    provider_ids: [...providers.keys()].sort(),
    file_count: seenPaths.size,
    total_bytes: totalBytes,
    content_set_sha256: contentSetDigest(contentRows),
    distribution_scope: "private_premium_repository",
    contains_customer_secrets: false,
    contains_operator_secrets: false,
    derived_only_from_public_core: false,
    immutable_release_identity_required: true,
  };
}

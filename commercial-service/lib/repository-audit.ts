import { verifyMarketplaceRepositoryAuditInstallation } from "./github";

const GITHUB_API = "https://api.github.com";
const CANONICAL_REPOSITORY = "Vertex-Systems-Network/ai-native-project-operating-system";
const MAX_CONTROL_FILE_BYTES = 256_000;

export const COMMUNITY_AUDIT_PATHS = [
  ".ai/manifest.json",
  "config/protocol/instance.json",
  "config/protocol/version.json",
  "config/quality/quality-policy.json",
  "config/security/control-plane-policy.json",
  "config/github/ruleset-policy.json",
  "config/design/design-assurance.json",
  "config/data/data-governance.json",
  "config/release/release-policy.json",
  "config/operations/operations-policy.json",
] as const;

export type CommunityAuditPath = typeof COMMUNITY_AUDIT_PATHS[number];

export class RepositoryAuditError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

type GitHubRepository = {
  id: number;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
  owner?: { id?: number; login?: string; type?: string };
};

type GitHubContentsFile = {
  type?: string;
  encoding?: string;
  content?: string;
  size?: number;
  sha?: string;
};

export type ControlFileObservation = {
  present: boolean;
  json_valid: boolean;
  sha: string | null;
  json: Record<string, unknown> | null;
};

export type RepositoryAuditClassification =
  | "not_anpos"
  | "canonical_source"
  | "uninitialized_child"
  | "active_child"
  | "partial_or_malformed";

export type RepositoryAuditResult = {
  audit_version: 1;
  repository: {
    id: number;
    full_name: string;
    private: boolean;
    archived: boolean;
    default_branch: string;
  };
  classification: RepositoryAuditClassification;
  protocol: {
    detected: boolean;
    version: string | null;
    instance_status: string | null;
    bootstrap_completed: boolean | null;
  };
  readiness: {
    level: "not_anpos" | "canonical_source" | "needs_bootstrap" | "baseline_present" | "needs_repair";
    control_files_present: number;
    control_files_total: number;
  };
  controls: Record<CommunityAuditPath, { status: "present" | "missing" | "invalid_json"; sha: string | null }>;
  gaps: string[];
  privacy_scope: {
    source_code_read: false;
    audited_paths: readonly CommunityAuditPath[];
    result_persistence: "not_persisted_by_repository_audit";
  };
  limitations: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function normalizeRepositorySlug(value: unknown): string {
  if (typeof value !== "string") throw new RepositoryAuditError(400, "repository_required");
  const normalized = value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(normalized);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new RepositoryAuditError(400, "invalid_repository");
  }
  return `${match[1]}/${match[2]}`;
}

function apiPathForFile(repository: string, path: CommunityAuditPath, ref: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `/repos/${repository.split("/").map(encodeURIComponent).join("/")}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
}

async function githubGet(path: string, token: string): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "ANPOS-Commercial-Service/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

async function repositoryMetadata(repository: string, userToken: string): Promise<GitHubRepository> {
  const response = await githubGet(`/repos/${repository.split("/").map(encodeURIComponent).join("/")}`, userToken);
  if (response.status === 404) throw new RepositoryAuditError(404, "repository_not_found_or_inaccessible");
  if (response.status === 401) throw new RepositoryAuditError(401, "github_user_token_invalid");
  if (response.status === 403) throw new RepositoryAuditError(403, "repository_access_forbidden");
  if (!response.ok) throw new RepositoryAuditError(502, "github_repository_lookup_failed");
  const body = await response.json() as GitHubRepository;
  if (!Number.isSafeInteger(body.id) || body.id <= 0 || !body.full_name || !body.default_branch) {
    throw new RepositoryAuditError(502, "github_repository_metadata_invalid");
  }
  return body;
}

async function readControlFile(
  repository: string,
  path: CommunityAuditPath,
  ref: string,
  userToken: string,
): Promise<ControlFileObservation> {
  const response = await githubGet(apiPathForFile(repository, path, ref), userToken);
  if (response.status === 404) return { present: false, json_valid: false, sha: null, json: null };
  if (response.status === 403) throw new RepositoryAuditError(403, "github_user_control_file_permission_required");
  if (response.status === 401) throw new RepositoryAuditError(401, "github_user_token_invalid");
  if (!response.ok) throw new RepositoryAuditError(502, "github_control_file_read_failed");

  const body = await response.json() as GitHubContentsFile;
  if (body.type !== "file" || body.encoding !== "base64" || typeof body.content !== "string") {
    throw new RepositoryAuditError(502, "github_control_file_response_invalid");
  }
  if (typeof body.size === "number" && body.size > MAX_CONTROL_FILE_BYTES) {
    throw new RepositoryAuditError(422, "anpos_control_file_too_large");
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8"));
  } catch {
    return { present: true, json_valid: false, sha: typeof body.sha === "string" ? body.sha : null, json: null };
  }
  return {
    present: true,
    json_valid: isObject(parsed),
    sha: typeof body.sha === "string" ? body.sha : null,
    json: isObject(parsed) ? parsed : null,
  };
}

function classify(
  metadata: GitHubRepository,
  files: Record<CommunityAuditPath, ControlFileObservation>,
): RepositoryAuditClassification {
  const manifest = files[".ai/manifest.json"].json;
  const instance = files["config/protocol/instance.json"].json;
  const protocolDetected = manifest?.protocol === "ANPOS";
  const instanceStatus = stringValue(instance?.instance_status);
  const bootstrapCompleted = booleanValue(instance?.bootstrap_completed);
  const canonical = metadata.full_name.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase();

  if (canonical && protocolDetected && instanceStatus === "template_source") return "canonical_source";
  if (!protocolDetected && !files["config/protocol/instance.json"].present) return "not_anpos";
  if (protocolDetected && !canonical && instanceStatus === "template_source" && bootstrapCompleted !== true) {
    return "uninitialized_child";
  }
  if (protocolDetected && instanceStatus === "active_project" && bootstrapCompleted === true) return "active_child";
  return "partial_or_malformed";
}

export function buildRepositoryAudit(
  metadata: GitHubRepository,
  files: Record<CommunityAuditPath, ControlFileObservation>,
): RepositoryAuditResult {
  const classification = classify(metadata, files);
  const manifest = files[".ai/manifest.json"].json;
  const instance = files["config/protocol/instance.json"].json;
  const version = files["config/protocol/version.json"].json;
  const protocolDetected = manifest?.protocol === "ANPOS";
  const instanceStatus = stringValue(instance?.instance_status);
  const bootstrapCompleted = booleanValue(instance?.bootstrap_completed);
  const protocolVersion = stringValue(version?.version) ?? stringValue(instance?.source_protocol_version);

  const controls = {} as RepositoryAuditResult["controls"];
  let present = 0;
  for (const path of COMMUNITY_AUDIT_PATHS) {
    const observation = files[path];
    if (observation.present) present += 1;
    controls[path] = {
      status: !observation.present ? "missing" : observation.json_valid ? "present" : "invalid_json",
      sha: observation.sha,
    };
  }

  const gaps: string[] = [];
  if (classification === "not_anpos") {
    gaps.push("ANPOS manifest/instance was not detected in the approved audit file set.");
  } else if (classification === "uninitialized_child") {
    gaps.push("Repository appears to be a copied ANPOS template that has not completed child bootstrap; run scripts/bootstrap_child.py before project development.");
  } else if (classification === "partial_or_malformed") {
    gaps.push("ANPOS control state is partial, malformed, or internally inconsistent and requires repair before development claims can be trusted.");
  }

  if (protocolDetected && classification !== "canonical_source") {
    for (const path of COMMUNITY_AUDIT_PATHS) {
      const observation = files[path];
      if (!observation.present) gaps.push(`Expected ANPOS control file not detected: ${path}`);
      else if (!observation.json_valid) gaps.push(`ANPOS control file is not valid JSON: ${path}`);
    }
  }

  const readinessLevel: RepositoryAuditResult["readiness"]["level"] =
    classification === "not_anpos" ? "not_anpos"
      : classification === "canonical_source" ? "canonical_source"
        : classification === "uninitialized_child" ? "needs_bootstrap"
          : classification === "active_child" && gaps.length === 0 ? "baseline_present"
            : "needs_repair";

  return {
    audit_version: 1,
    repository: {
      id: metadata.id,
      full_name: metadata.full_name,
      private: metadata.private,
      archived: metadata.archived,
      default_branch: metadata.default_branch,
    },
    classification,
    protocol: {
      detected: protocolDetected,
      version: protocolVersion,
      instance_status: instanceStatus,
      bootstrap_completed: bootstrapCompleted,
    },
    readiness: {
      level: readinessLevel,
      control_files_present: present,
      control_files_total: COMMUNITY_AUDIT_PATHS.length,
    },
    controls,
    gaps: [...new Set(gaps)],
    privacy_scope: {
      source_code_read: false,
      audited_paths: COMMUNITY_AUDIT_PATHS,
      result_persistence: "not_persisted_by_repository_audit",
    },
    limitations: [
      "This audit reads only the ten explicitly approved ANPOS control files; it does not read application source code.",
      "The target Marketplace App installation and its ten-file permission set are verified before reads; the reads themselves use the authenticated GitHub user token so repository access remains user-bound.",
      "It does not inspect GitHub branch protection, repository rulesets, required-check enforcement, workflow execution results, secrets, environments, deployments, billing state, PM connections, or attached AI runtimes.",
      "File presence is evidence of repository configuration only; it is not proof that an external platform capability is enabled or enforced.",
    ],
  };
}

export async function auditRepository(repositoryInput: unknown, userToken: string): Promise<RepositoryAuditResult> {
  const repository = normalizeRepositorySlug(repositoryInput);
  const metadata = await repositoryMetadata(repository, userToken);
  const [owner, repo] = metadata.full_name.split("/", 2);
  if (!owner || !repo) throw new RepositoryAuditError(502, "github_repository_metadata_invalid");

  await verifyMarketplaceRepositoryAuditInstallation(owner, repo, COMMUNITY_AUDIT_PATHS);
  const entries = await Promise.all(
    COMMUNITY_AUDIT_PATHS.map(async (path) => [
      path,
      await readControlFile(metadata.full_name, path, metadata.default_branch, userToken),
    ] as const),
  );
  return buildRepositoryAudit(metadata, Object.fromEntries(entries) as Record<CommunityAuditPath, ControlFileObservation>);
}

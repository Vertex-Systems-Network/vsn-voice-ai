import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepositoryAudit,
  COMMUNITY_AUDIT_PATHS,
  type CommunityAuditPath,
  type ControlFileObservation,
  normalizeRepositorySlug,
  RepositoryAuditError,
} from "../lib/repository-audit";

function observation(json: Record<string, unknown> | null = {}): ControlFileObservation {
  return {
    present: true,
    json_valid: json !== null,
    sha: "a".repeat(40),
    json,
  };
}

function missing(): ControlFileObservation {
  return { present: false, json_valid: false, sha: null, json: null };
}

function controlFiles(overrides: Partial<Record<CommunityAuditPath, ControlFileObservation>> = {}) {
  const files = Object.fromEntries(COMMUNITY_AUDIT_PATHS.map((path) => [path, observation()])) as Record<CommunityAuditPath, ControlFileObservation>;
  files[".ai/manifest.json"] = observation({ protocol: "ANPOS", schema_version: 7 });
  files["config/protocol/instance.json"] = observation({
    instance_status: "active_project",
    bootstrap_completed: true,
    source_protocol_version: "1.3.13",
  });
  files["config/protocol/version.json"] = observation({ version: "1.3.13" });
  Object.assign(files, overrides);
  return files;
}

const childRepo = {
  id: 100,
  full_name: "example/project",
  private: true,
  archived: false,
  default_branch: "main",
};

test("Community audit scope is exactly ten ANPOS control files and excludes application source", () => {
  assert.equal(COMMUNITY_AUDIT_PATHS.length, 10);
  assert.deepEqual(COMMUNITY_AUDIT_PATHS, [
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
  ]);
  for (const path of COMMUNITY_AUDIT_PATHS) {
    assert.equal(/\.(ts|tsx|js|jsx|py|php|java|go|rs|rb|cs|cpp|c|h)$/i.test(path), false);
  }
});

test("repository slug normalization accepts GitHub URL and rejects unsafe input", () => {
  assert.equal(normalizeRepositorySlug("https://github.com/example/project.git"), "example/project");
  assert.equal(normalizeRepositorySlug("example/project"), "example/project");
  assert.throws(
    () => normalizeRepositorySlug("example/project/extra"),
    (error: unknown) => error instanceof RepositoryAuditError && error.status === 400 && error.code === "invalid_repository",
  );
  assert.throws(() => normalizeRepositorySlug(undefined), RepositoryAuditError);
});

test("initialized ANPOS child reports baseline present without persisting source", () => {
  const audit = buildRepositoryAudit(childRepo, controlFiles());
  assert.equal(audit.classification, "active_child");
  assert.equal(audit.readiness.level, "baseline_present");
  assert.equal(audit.protocol.detected, true);
  assert.equal(audit.protocol.version, "1.3.13");
  assert.equal(audit.readiness.control_files_present, 10);
  assert.deepEqual(audit.gaps, []);
  assert.equal(audit.privacy_scope.source_code_read, false);
  assert.equal(audit.privacy_scope.result_persistence, "not_persisted_by_repository_audit");
});

test("copied template source is identified as an uninitialized child", () => {
  const files = controlFiles({
    "config/protocol/instance.json": observation({
      instance_status: "template_source",
      bootstrap_completed: false,
      source_protocol_version: "1.3.13",
    }),
  });
  const audit = buildRepositoryAudit(childRepo, files);
  assert.equal(audit.classification, "uninitialized_child");
  assert.equal(audit.readiness.level, "needs_bootstrap");
  assert.ok(audit.gaps.some((gap) => gap.includes("bootstrap_child.py")));
});

test("canonical source is not misreported as an uninitialized customer child", () => {
  const files = controlFiles({
    "config/protocol/instance.json": observation({
      instance_status: "template_source",
      bootstrap_completed: false,
      source_protocol_version: "1.3.13",
    }),
  });
  const audit = buildRepositoryAudit({
    ...childRepo,
    id: 1354593418,
    full_name: "Vertex-Systems-Network/ai-native-project-operating-system",
    private: false,
  }, files);
  assert.equal(audit.classification, "canonical_source");
  assert.equal(audit.readiness.level, "canonical_source");
});

test("missing or malformed ANPOS control files are explicit gaps", () => {
  const files = controlFiles({
    "config/security/control-plane-policy.json": missing(),
    "config/data/data-governance.json": observation(null),
  });
  const audit = buildRepositoryAudit(childRepo, files);
  assert.equal(audit.classification, "active_child");
  assert.equal(audit.readiness.level, "needs_repair");
  assert.equal(audit.controls["config/security/control-plane-policy.json"].status, "missing");
  assert.equal(audit.controls["config/data/data-governance.json"].status, "invalid_json");
  assert.ok(audit.gaps.some((gap) => gap.includes("control-plane-policy.json")));
  assert.ok(audit.gaps.some((gap) => gap.includes("data-governance.json")));
});

test("non-ANPOS repository is reported without inventing readiness", () => {
  const files = Object.fromEntries(COMMUNITY_AUDIT_PATHS.map((path) => [path, missing()])) as Record<CommunityAuditPath, ControlFileObservation>;
  const audit = buildRepositoryAudit(childRepo, files);
  assert.equal(audit.classification, "not_anpos");
  assert.equal(audit.readiness.level, "not_anpos");
  assert.equal(audit.protocol.detected, false);
  assert.equal(audit.readiness.control_files_present, 0);
});

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  listMarketplaceUserInstallationRepositories,
  verifyMarketplaceUserInstallationAccess,
} from "../lib/github";
import {
  auditRepository,
  COMMUNITY_AUDIT_PATHS,
  RepositoryAuditError,
} from "../lib/repository-audit";

const marketplaceKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const marketplacePrivateKey = marketplaceKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();

const MANAGED_ENV = [
  "GITHUB_MARKETPLACE_APP_ID",
  "GITHUB_MARKETPLACE_APP_PRIVATE_KEY",
  "GITHUB_MARKETPLACE_CLIENT_ID",
  "GITHUB_MARKETPLACE_CLIENT_SECRET",
  "ANPOS_PUBLIC_BASE_URL",
  "ANPOS_SESSION_SECRET",
] as const;

const originalFetch = globalThis.fetch;

function configureMarketplaceApp(): void {
  process.env.GITHUB_MARKETPLACE_APP_ID = "123456";
  process.env.GITHUB_MARKETPLACE_APP_PRIVATE_KEY = marketplacePrivateKey;
  process.env.GITHUB_MARKETPLACE_CLIENT_ID = "Iv1.community-negative-123";
  process.env.GITHUB_MARKETPLACE_CLIENT_SECRET = "c".repeat(48);
  process.env.ANPOS_PUBLIC_BASE_URL = "https://license.example.test";
  process.env.ANPOS_SESSION_SECRET = "s".repeat(48);
}

function cleanup(): void {
  globalThis.fetch = originalFetch;
  for (const key of MANAGED_ENV) delete process.env[key];
}

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function repositoryMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: 5001,
    full_name: "acme/private-anpos",
    private: true,
    archived: false,
    default_branch: "main",
    ...overrides,
  };
}

function installation(overrides: Record<string, unknown> = {}) {
  return {
    id: 7001,
    suspended_at: null,
    permissions: { single_file: "read", metadata: "read" },
    single_file_paths: [...COMMUNITY_AUDIT_PATHS],
    ...overrides,
  };
}

function controlFileBody(url: string) {
  let value: Record<string, unknown> = {};
  if (url.includes(".ai/manifest.json")) value = { protocol: "ANPOS", schema_version: 7 };
  if (url.includes("config/protocol/instance.json")) {
    value = { instance_status: "active_project", bootstrap_completed: true, source_protocol_version: "1.3.13" };
  }
  if (url.includes("config/protocol/version.json")) value = { version: "1.3.13" };
  const raw = Buffer.from(JSON.stringify(value), "utf8");
  return {
    type: "file",
    encoding: "base64",
    content: raw.toString("base64"),
    size: raw.length,
    sha: "a".repeat(40),
  };
}

function baseAuditFetch(url: string): Response {
  if (url === "https://api.github.com/repos/acme/private-anpos") return jsonResponse(repositoryMetadata());
  if (url === "https://api.github.com/repos/acme/private-anpos/installation") return jsonResponse(installation());
  if (url.startsWith("https://api.github.com/repos/acme/private-anpos/contents/")) return jsonResponse(controlFileBody(url));
  return jsonResponse({ message: "unexpected test URL" }, 500);
}

test("Community audit can evaluate an authorized private repository without broad source access", { concurrency: false }, async () => {
  configureMarketplaceApp();
  installFetch((url) => baseAuditFetch(url));
  try {
    const result = await auditRepository("acme/private-anpos", "ghu_private_repo_user_token");
    assert.equal(result.repository.private, true);
    assert.equal(result.repository.full_name, "acme/private-anpos");
    assert.equal(result.classification, "active_child");
    assert.equal(result.readiness.level, "baseline_present");
    assert.equal(result.readiness.control_files_present, 10);
    assert.equal(result.privacy_scope.source_code_read, false);
    assert.deepEqual(result.privacy_scope.audited_paths, COMMUNITY_AUDIT_PATHS);
  } finally {
    cleanup();
  }
});

test("Community audit maps GitHub private repository permission denial without hiding it as not-found", { concurrency: false }, async () => {
  configureMarketplaceApp();
  installFetch((url) => {
    if (url === "https://api.github.com/repos/acme/private-anpos") return jsonResponse({ message: "forbidden" }, 403);
    return jsonResponse({}, 500);
  });
  try {
    await assert.rejects(
      () => auditRepository("acme/private-anpos", "ghu_denied"),
      (error: unknown) => error instanceof RepositoryAuditError
        && error.status === 403
        && error.code === "repository_access_forbidden",
    );
  } finally {
    cleanup();
  }
});

test("Community audit rejects malformed GitHub repository metadata", { concurrency: false }, async () => {
  configureMarketplaceApp();
  installFetch((url) => {
    if (url === "https://api.github.com/repos/acme/private-anpos") {
      return jsonResponse(repositoryMetadata({ id: "not-an-integer", default_branch: "" }));
    }
    return jsonResponse({}, 500);
  });
  try {
    await assert.rejects(
      () => auditRepository("acme/private-anpos", "ghu_malformed_metadata"),
      (error: unknown) => error instanceof RepositoryAuditError
        && error.status === 502
        && error.code === "github_repository_metadata_invalid",
    );
  } finally {
    cleanup();
  }
});

test("Community audit fails closed when Marketplace App single-file permission is absent", { concurrency: false }, async () => {
  configureMarketplaceApp();
  installFetch((url) => {
    if (url === "https://api.github.com/repos/acme/private-anpos") return jsonResponse(repositoryMetadata());
    if (url === "https://api.github.com/repos/acme/private-anpos/installation") {
      return jsonResponse(installation({ permissions: { metadata: "read" } }));
    }
    return jsonResponse({}, 500);
  });
  try {
    await assert.rejects(
      () => auditRepository("acme/private-anpos", "ghu_missing_single_file_permission"),
      /MARKETPLACE_APP_SINGLE_FILE_READ_REQUIRED/,
    );
  } finally {
    cleanup();
  }
});

test("Community audit fails closed when even one approved control path is not granted", { concurrency: false }, async () => {
  configureMarketplaceApp();
  installFetch((url) => {
    if (url === "https://api.github.com/repos/acme/private-anpos") return jsonResponse(repositoryMetadata());
    if (url === "https://api.github.com/repos/acme/private-anpos/installation") {
      return jsonResponse(installation({ single_file_paths: COMMUNITY_AUDIT_PATHS.slice(0, -1) }));
    }
    return jsonResponse({}, 500);
  });
  try {
    await assert.rejects(
      () => auditRepository("acme/private-anpos", "ghu_missing_control_path"),
      /MARKETPLACE_APP_AUDIT_PATHS_NOT_GRANTED/,
    );
  } finally {
    cleanup();
  }
});

test("Community audit rejects malformed GitHub contents responses instead of treating them as control files", { concurrency: false }, async () => {
  configureMarketplaceApp();
  installFetch((url) => {
    if (url === "https://api.github.com/repos/acme/private-anpos") return jsonResponse(repositoryMetadata());
    if (url === "https://api.github.com/repos/acme/private-anpos/installation") return jsonResponse(installation());
    if (url.includes("/contents/.ai/manifest.json")) {
      return jsonResponse({ type: "dir", encoding: "none", content: null, size: 1, sha: "b".repeat(40) });
    }
    if (url.startsWith("https://api.github.com/repos/acme/private-anpos/contents/")) return jsonResponse(controlFileBody(url));
    return jsonResponse({}, 500);
  });
  try {
    await assert.rejects(
      () => auditRepository("acme/private-anpos", "ghu_bad_contents"),
      (error: unknown) => error instanceof RepositoryAuditError
        && error.status === 502
        && error.code === "github_control_file_response_invalid",
    );
  } finally {
    cleanup();
  }
});

test("Community user-installation access verification rejects a denied or mismatched installation", { concurrency: false }, async () => {
  installFetch((url) => {
    assert.equal(url, "https://api.github.com/user/installations/7001/repositories?per_page=1&page=1");
    return jsonResponse({ message: "resource not accessible for user" }, 403);
  });
  try {
    await assert.rejects(
      () => verifyMarketplaceUserInstallationAccess("ghu_wrong_user_or_installation", 7001),
      /MARKETPLACE_INSTALLATION_USER_ACCESS_REQUIRED/,
    );
  } finally {
    cleanup();
  }
});

test("Community installation repository listing sanitizes malformed external repository rows", { concurrency: false }, async () => {
  installFetch((url) => {
    assert.equal(url, "https://api.github.com/user/installations/7001/repositories?per_page=100&page=1");
    return jsonResponse({
      total_count: 3,
      repositories: [
        repositoryMetadata(),
        { id: "bad", full_name: "acme/bad", default_branch: "main", private: true },
        { id: 5002, full_name: "", default_branch: "main", private: true },
      ],
    });
  });
  try {
    const result = await listMarketplaceUserInstallationRepositories("ghu_listing", 7001, 1, 100);
    assert.equal(result.total_count, 3);
    assert.deepEqual(result.repositories, [{
      id: 5001,
      full_name: "acme/private-anpos",
      private: true,
      archived: false,
      default_branch: "main",
    }]);
  } finally {
    cleanup();
  }
});

import { createHash, createPrivateKey, sign } from "node:crypto";
import packageJson from "@/package.json";
import { marketplaceAppConfig, premiumDistributionConfig, serviceConfig } from "./env";
import { parsePremiumReleaseManifest, type VerifiedPremiumRelease } from "./premium-releases";
import { parseTemplateReleaseManifest, type VerifiedTemplateRelease } from "./releases";

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

type GitHubAppRole = "marketplace" | "vendor";

function githubAppJwt(role: GitHubAppRole): string {
  const now = Math.floor(Date.now() / 1000);
  let appId: string;
  let privateKeyPem: string;
  if (role === "marketplace") {
    const cfg = marketplaceAppConfig();
    appId = cfg.githubMarketplaceAppId;
    privateKeyPem = cfg.githubMarketplaceAppPrivateKeyPem;
  } else {
    const cfg = serviceConfig();
    appId = cfg.githubVendorAppId;
    privateKeyPem = cfg.githubVendorAppPrivateKeyPem;
  }
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 8 * 60, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), createPrivateKey(privateKeyPem)).toString("base64url");
  return `${signingInput}.${signature}`;
}

const githubHeaders = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "ANPOS-Commercial-Service/1.0",
});

function privateRepository(full: string): { full: string; owner: string; repo: string } {
  const [owner, repo, ...rest] = full.split("/");
  if (!owner || !repo || rest.length) throw new Error("INVALID_VENDOR_REPOSITORY");
  return { full, owner, repo };
}

function privateTemplateRepository(): { full: string; owner: string; repo: string } {
  return privateRepository(serviceConfig().privateTemplateRepo);
}

function privatePremiumRepository(): { full: string; owner: string; repo: string } {
  return privateRepository(premiumDistributionConfig().privatePremiumRepo);
}

const serviceIdentity = packageJson as {
  anpos?: { source_protocol_version?: string };
};

function sourceProtocolVersion(): string {
  const value = serviceIdentity.anpos?.source_protocol_version;
  if (!value) throw new Error("SOURCE_PROTOCOL_VERSION_UNAVAILABLE");
  return value;
}

export type MarketplaceSubscription = {
  id: number;
  login: string;
  type: string;
  marketplace_purchase?: {
    billing_cycle?: string | null;
    next_billing_date?: string | null;
    unit_count?: number | null;
    on_free_trial?: boolean;
    free_trial_ends_on?: string | null;
    updated_at?: string | null;
    plan?: { id: number; number?: number; name?: string; state?: string };
  };
};

type MarketplaceRepositoryInstallation = {
  id?: number;
  suspended_at?: string | null;
  permissions?: Record<string, string>;
  single_file_paths?: string[] | null;
};

export type MarketplaceUserRepository = {
  id: number;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
};

export async function getMarketplaceSubscription(accountId: number): Promise<MarketplaceSubscription | null> {
  const response = await fetch(`https://api.github.com/marketplace_listing/accounts/${accountId}`, {
    headers: githubHeaders(githubAppJwt("marketplace")),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub Marketplace reconciliation failed: ${response.status}`);
  return response.json() as Promise<MarketplaceSubscription>;
}

export async function verifyMarketplaceRepositoryAuditInstallation(
  owner: string,
  repo: string,
  requiredSingleFilePaths: readonly string[],
): Promise<number> {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new Error("INVALID_MARKETPLACE_REPOSITORY");
  }
  if (!requiredSingleFilePaths.length || requiredSingleFilePaths.length > 10) {
    throw new Error("INVALID_MARKETPLACE_AUDIT_PATHS");
  }
  for (const path of requiredSingleFilePaths) {
    if (!path || path.length > 255 || path.startsWith("/") || path.includes("..") || /[\r\n]/.test(path)) {
      throw new Error("INVALID_MARKETPLACE_AUDIT_PATHS");
    }
  }

  const installationResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
    {
      headers: githubHeaders(githubAppJwt("marketplace")),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (installationResponse.status === 404) throw new Error("MARKETPLACE_APP_NOT_INSTALLED_FOR_REPOSITORY");
  if (!installationResponse.ok) throw new Error(`MARKETPLACE_APP_INSTALLATION_LOOKUP_FAILED_${installationResponse.status}`);
  const installation = await installationResponse.json() as MarketplaceRepositoryInstallation;
  if (!Number.isSafeInteger(installation.id) || Number(installation.id) <= 0) {
    throw new Error("MARKETPLACE_APP_INSTALLATION_INVALID");
  }
  if (installation.suspended_at) throw new Error("MARKETPLACE_APP_INSTALLATION_SUSPENDED");

  const singleFilePermission = installation.permissions?.single_file;
  if (!singleFilePermission || !["read", "write"].includes(singleFilePermission)) {
    throw new Error("MARKETPLACE_APP_SINGLE_FILE_READ_REQUIRED");
  }
  const grantedPaths = new Set((installation.single_file_paths ?? []).map((path) => String(path)));
  const missingPaths = requiredSingleFilePaths.filter((path) => !grantedPaths.has(path));
  if (missingPaths.length) throw new Error("MARKETPLACE_APP_AUDIT_PATHS_NOT_GRANTED");
  return Number(installation.id);
}

export async function listMarketplaceUserInstallationRepositories(
  userToken: string,
  installationId: number,
  page = 1,
  perPage = 100,
): Promise<{ total_count: number; repositories: MarketplaceUserRepository[] }> {
  if (!userToken || userToken.length > 4096) throw new Error("UNAUTHORIZED_GITHUB");
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("INVALID_INSTALLATION_ID");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new Error("INVALID_PAGE");
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) throw new Error("INVALID_PER_PAGE");
  const response = await fetch(
    `https://api.github.com/user/installations/${installationId}/repositories?per_page=${perPage}&page=${page}`,
    {
      headers: githubHeaders(userToken),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if ([401, 403, 404].includes(response.status)) throw new Error("MARKETPLACE_INSTALLATION_USER_ACCESS_REQUIRED");
  if (!response.ok) throw new Error(`MARKETPLACE_USER_REPOSITORIES_FAILED_${response.status}`);
  const body = await response.json() as { total_count?: number; repositories?: Array<Record<string, unknown>> };
  const repositories = Array.isArray(body.repositories) ? body.repositories : [];
  return {
    total_count: Number.isSafeInteger(body.total_count) ? Number(body.total_count) : repositories.length,
    repositories: repositories.flatMap((repo) => {
      const id = Number(repo.id);
      const fullName = typeof repo.full_name === "string" ? repo.full_name : "";
      const defaultBranch = typeof repo.default_branch === "string" ? repo.default_branch : "";
      if (!Number.isSafeInteger(id) || id <= 0 || !fullName || !defaultBranch) return [];
      return [{
        id,
        full_name: fullName,
        private: repo.private === true,
        archived: repo.archived === true,
        default_branch: defaultBranch,
      }];
    }),
  };
}

export async function verifyMarketplaceUserInstallationAccess(userToken: string, installationId: number): Promise<void> {
  await listMarketplaceUserInstallationRepositories(userToken, installationId, 1, 1);
}

async function vendorInstallationToken(
  repository: { full: string; owner: string; repo: string },
  operation: "archive" | "collaborator",
): Promise<string> {
  const cfg = serviceConfig();
  const installationId = cfg.githubVendorInstallationId;
  const permissions = operation === "collaborator"
    ? { administration: "write" }
    : { contents: "read" };
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { ...githubHeaders(githubAppJwt("vendor")), "Content-Type": "application/json" },
    body: JSON.stringify({ repositories: [repository.repo], permissions }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Vendor installation token failed: ${response.status}`);
  const body = await response.json() as { token?: string };
  if (!body.token) throw new Error("Vendor installation token missing");
  return body.token;
}

export type CommercialReleaseMetadata = VerifiedTemplateRelease & {
  repository: string;
  release_ref: string;
};

export async function templateReleaseManifest(): Promise<CommercialReleaseMetadata> {
  const cfg = serviceConfig();
  const repository = privateTemplateRepository();
  const token = await vendorInstallationToken(repository, "archive");
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/contents/EXPORT-MANIFEST.json?ref=${cfg.commercialReleaseRef}`,
    {
      headers: { ...githubHeaders(token), Accept: "application/vnd.github.raw+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Commercial release manifest failed: ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) {
    throw new Error("COMMERCIAL_RELEASE_MANIFEST_TOO_LARGE");
  }
  const raw = await response.text();
  if (!raw || raw.length > 2 * 1024 * 1024) throw new Error("COMMERCIAL_RELEASE_MANIFEST_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("INVALID_COMMERCIAL_RELEASE_MANIFEST_JSON"); }
  const manifest = parseTemplateReleaseManifest(parsed);
  return {
    ...manifest,
    repository: repository.full,
    release_ref: cfg.commercialReleaseRef,
  };
}

export async function templateArchiveRedirect(): Promise<{ repository: string; release_ref: string; location: string }> {
  const cfg = serviceConfig();
  const repository = privateTemplateRepository();
  const token = await vendorInstallationToken(repository, "archive");
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/zipball/${cfg.commercialReleaseRef}`,
    {
      headers: githubHeaders(token),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status !== 302) throw new Error(`Template archive redirect failed: ${response.status}`);
  const location = response.headers.get("location");
  if (!location) throw new Error("Template archive redirect missing");
  const destination = new URL(location);
  if (destination.protocol !== "https:" || destination.hostname !== "codeload.github.com") {
    throw new Error("Unexpected template archive redirect host");
  }
  return { repository: repository.full, release_ref: cfg.commercialReleaseRef, location };
}

export type PremiumReleaseMetadata = VerifiedPremiumRelease & {
  repository: string;
  release_ref: string;
  manifest_sha256: string;
};

export async function premiumReleaseManifest(): Promise<PremiumReleaseMetadata> {
  const cfg = premiumDistributionConfig();
  const repository = privatePremiumRepository();
  const token = await vendorInstallationToken(repository, "archive");
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/contents/ANPOS-PREMIUM-MANIFEST.json?ref=${cfg.premiumReleaseRef}`,
    {
      headers: { ...githubHeaders(token), Accept: "application/vnd.github.raw+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Premium release manifest failed: ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) throw new Error("PREMIUM_RELEASE_MANIFEST_TOO_LARGE");
  const raw = Buffer.from(await response.arrayBuffer());
  if (!raw.length || raw.length > 2 * 1024 * 1024) throw new Error("PREMIUM_RELEASE_MANIFEST_TOO_LARGE");
  const manifestSha256 = createHash("sha256").update(raw).digest("hex");
  if (manifestSha256 !== cfg.premiumManifestSha256) throw new Error("PREMIUM_RELEASE_MANIFEST_DIGEST_MISMATCH");

  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); }
  catch { throw new Error("INVALID_PREMIUM_RELEASE_MANIFEST_JSON"); }
  const manifest = parsePremiumReleaseManifest(parsed, sourceProtocolVersion());
  if (manifest.content_set_sha256 !== cfg.premiumContentSetSha256) throw new Error("PREMIUM_RELEASE_CONTENT_SET_DIGEST_MISMATCH");

  return {
    ...manifest,
    repository: repository.full,
    release_ref: cfg.premiumReleaseRef,
    manifest_sha256: manifestSha256,
  };
}

export async function premiumArchiveRedirect(): Promise<{ repository: string; release_ref: string; location: string }> {
  const cfg = premiumDistributionConfig();
  const repository = privatePremiumRepository();
  const token = await vendorInstallationToken(repository, "archive");
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/zipball/${cfg.premiumReleaseRef}`,
    {
      headers: githubHeaders(token),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status !== 302) throw new Error(`Premium archive redirect failed: ${response.status}`);
  const location = response.headers.get("location");
  if (!location) throw new Error("Premium archive redirect missing");
  const destination = new URL(location);
  if (destination.protocol !== "https:" || destination.hostname !== "codeload.github.com") {
    throw new Error("Unexpected premium archive redirect host");
  }
  return { repository: repository.full, release_ref: cfg.premiumReleaseRef, location };
}

export async function inviteTemplateCollaborator(username: string): Promise<{ repository: string; status: number }> {
  const repository = privateTemplateRepository();
  const token = await vendorInstallationToken(repository, "collaborator");
  const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/collaborators/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ permission: "pull" }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (![201, 204].includes(response.status)) throw new Error(`Template collaborator provisioning failed: ${response.status}`);
  return { repository: repository.full, status: response.status };
}

export async function removeTemplateCollaborator(username: string): Promise<{ repository: string; status: number }> {
  const repository = privateTemplateRepository();
  const token = await vendorInstallationToken(repository, "collaborator");
  const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/collaborators/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: githubHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (![204, 404].includes(response.status)) throw new Error(`Template collaborator revocation failed: ${response.status}`);
  return { repository: repository.full, status: response.status };
}

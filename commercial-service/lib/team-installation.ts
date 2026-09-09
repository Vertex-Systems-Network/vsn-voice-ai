const GITHUB_API = "https://api.github.com";
const MAX_INSTALLATION_PAGES = 10;

type InstallationRow = {
  id?: unknown;
  suspended_at?: unknown;
  account?: {
    id?: unknown;
    login?: unknown;
    type?: unknown;
  } | null;
};

export type TeamInstallationAccount = {
  installation_id: number;
  github_account_id: number;
  github_login: string;
  github_account_type: "User" | "Organization";
};

function safePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeLogin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const login = value.trim();
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login) ? login : null;
}

export function parseTeamInstallationAccount(row: InstallationRow, expectedInstallationId: number): TeamInstallationAccount {
  const installationId = safePositiveInteger(row.id);
  if (!installationId || installationId !== expectedInstallationId) throw new Error("MARKETPLACE_INSTALLATION_IDENTITY_MISMATCH");
  if (row.suspended_at) throw new Error("MARKETPLACE_APP_INSTALLATION_SUSPENDED");
  const accountId = safePositiveInteger(row.account?.id);
  const login = safeLogin(row.account?.login);
  const type = row.account?.type;
  if (!accountId || !login || !["User", "Organization"].includes(String(type))) {
    throw new Error("MARKETPLACE_INSTALLATION_ACCOUNT_INVALID");
  }
  return {
    installation_id: installationId,
    github_account_id: accountId,
    github_login: login,
    github_account_type: type as "User" | "Organization",
  };
}

export async function resolveUserInstallationAccount(userToken: string, installationId: number): Promise<TeamInstallationAccount> {
  if (!userToken || userToken.length > 4096) throw new Error("UNAUTHORIZED_GITHUB");
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("INVALID_INSTALLATION_ID");

  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page += 1) {
    const response = await fetch(`${GITHUB_API}/user/installations?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${userToken}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "ANPOS-Commercial-Service/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if ([401, 403].includes(response.status)) throw new Error("UNAUTHORIZED_GITHUB");
    if (!response.ok) throw new Error(`MARKETPLACE_USER_INSTALLATIONS_FAILED_${response.status}`);

    const body = await response.json() as { installations?: InstallationRow[] };
    const rows = Array.isArray(body.installations) ? body.installations : [];
    const matched = rows.find((row) => safePositiveInteger(row.id) === installationId);
    if (matched) return parseTeamInstallationAccount(matched, installationId);
    if (rows.length < 100) break;
  }

  throw new Error("MARKETPLACE_INSTALLATION_USER_ACCESS_REQUIRED");
}

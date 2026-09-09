import { timingSafeEqual } from "node:crypto";
import { serviceConfig } from "./env";
import { githubSessionTokenFromRequest } from "./session";

function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function githubToken(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || githubSessionTokenFromRequest(request) || "";
  if (!token || token.length > 4096) throw new Error("UNAUTHORIZED_GITHUB");
  return token;
}

export function requireOperator(request: Request): void {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !equalSecret(token, serviceConfig().operatorToken)) throw new Error("UNAUTHORIZED_OPERATOR");
}

export type GitHubUser = { id: number; login: string; type: string };
export type GitHubOrganizationMembership = {
  state?: string;
  role?: string;
  user?: GitHubUser;
  organization?: { id?: number; login?: string };
};
export type GitHubAuthContext = { user: GitHubUser; token: string };

async function githubGet(path: string, token: string) {
  return fetch(`https://api.github.com${path}`, {
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

export async function githubUserFromToken(token: string): Promise<GitHubUser> {
  if (!token || token.length > 4096) throw new Error("UNAUTHORIZED_GITHUB");
  const userResponse = await githubGet("/user", token);
  if (!userResponse.ok) throw new Error("UNAUTHORIZED_GITHUB");
  const user = await userResponse.json() as GitHubUser;
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || !user.login) throw new Error("UNAUTHORIZED_GITHUB");
  return user;
}

export async function authenticatedGithubContext(request: Request): Promise<GitHubAuthContext> {
  const token = githubToken(request);
  const user = await githubUserFromToken(token);
  return { user, token };
}

async function selfOrganizationMembership(token: string, organizationLogin: string): Promise<GitHubOrganizationMembership> {
  const membership = await githubGet(`/user/memberships/orgs/${encodeURIComponent(organizationLogin)}`, token);
  if (!membership.ok) throw new Error("FORBIDDEN_GITHUB_ACCOUNT");
  return membership.json() as Promise<GitHubOrganizationMembership>;
}

export async function requireGithubAccountAccess(
  request: Request,
  target: { github_account_id: number; github_login: string; github_account_type: string },
): Promise<GitHubUser> {
  const context = await authenticatedGithubContext(request);
  if (target.github_account_type === "User" && context.user.id === Number(target.github_account_id)) return context.user;

  if (target.github_account_type === "Organization") {
    const membership = await selfOrganizationMembership(context.token, target.github_login);
    if (membership.state === "active") return context.user;
  }
  throw new Error("FORBIDDEN_GITHUB_ACCOUNT");
}

export async function requireGithubOrganizationAdmin(
  request: Request,
  target: { github_account_id: number; github_login: string; github_account_type: string },
): Promise<GitHubAuthContext> {
  if (target.github_account_type !== "Organization") throw new Error("ORGANIZATION_ACCOUNT_REQUIRED");
  const context = await authenticatedGithubContext(request);
  const membership = await selfOrganizationMembership(context.token, target.github_login);
  if (membership.state !== "active" || membership.role !== "admin") throw new Error("ORGANIZATION_ADMIN_REQUIRED");
  return context;
}

export async function resolveActiveOrganizationMember(token: string, organizationLogin: string, username: string): Promise<GitHubUser> {
  const normalized = username.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(normalized)) throw new Error("INVALID_GITHUB_USERNAME");
  const response = await githubGet(
    `/orgs/${encodeURIComponent(organizationLogin)}/memberships/${encodeURIComponent(normalized)}`,
    token,
  );
  if (response.status === 404) throw new Error("ORGANIZATION_MEMBER_NOT_FOUND");
  if (response.status === 403) throw new Error("ORGANIZATION_MEMBERS_PERMISSION_REQUIRED");
  if (!response.ok) throw new Error(`GITHUB_ORGANIZATION_MEMBERSHIP_FAILED_${response.status}`);
  const membership = await response.json() as GitHubOrganizationMembership;
  if (membership.state !== "active" || !membership.user?.id || !membership.user.login) {
    throw new Error("ORGANIZATION_MEMBER_NOT_ACTIVE");
  }
  return membership.user;
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { marketplaceAppConfig } from "./env";

export const SESSION_COOKIE_NAME = "__Host-anpos_session";
export const OAUTH_STATE_COOKIE_NAME = "__Host-anpos_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const MAX_SESSION_TTL_SECONDS = 8 * 60 * 60;
const TOKEN_VERSION = 1;

type OAuthStatePayload = {
  v: 1;
  installation_id: number;
  nonce: string;
  code_verifier: string;
  exp: number;
};

export type GithubBrowserSession = {
  v: 1;
  access_token: string;
  expires_at: number;
  github_user_id: number;
  github_login: string;
  installation_id: number;
  issued_at: number;
};

function encryptionKey(): Buffer {
  return createHash("sha256").update(marketplaceAppConfig().sessionSecret, "utf8").digest();
}

function seal(value: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([TOKEN_VERSION]), iv, tag, encrypted]).toString("base64url");
}

function unseal<T>(token: string): T {
  if (!token || token.length > 16_384) throw new Error("INVALID_SESSION_TOKEN");
  let raw: Buffer;
  try { raw = Buffer.from(token, "base64url"); }
  catch { throw new Error("INVALID_SESSION_TOKEN"); }
  if (raw.length < 1 + 12 + 16 + 2 || raw[0] !== TOKEN_VERSION) throw new Error("INVALID_SESSION_TOKEN");
  const iv = raw.subarray(1, 13);
  const tag = raw.subarray(13, 29);
  const encrypted = raw.subarray(29);
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new Error("INVALID_SESSION_TOKEN");
  }
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

function secureCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeLogin(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value);
}

function equalString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createOAuthFlowState(installationId: number): {
  state: string;
  stateCookie: string;
  codeChallenge: string;
} {
  if (!safeInteger(installationId)) throw new Error("INVALID_INSTALLATION_ID");
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const payload: OAuthStatePayload = {
    v: 1,
    installation_id: installationId,
    nonce: state,
    code_verifier: codeVerifier,
    exp: now + OAUTH_STATE_TTL_SECONDS,
  };
  return {
    state,
    stateCookie: secureCookie(OAUTH_STATE_COOKIE_NAME, seal(payload), OAUTH_STATE_TTL_SECONDS),
    codeChallenge,
  };
}

export function consumeOAuthFlowState(request: Request, suppliedState: string): {
  installationId: number;
  codeVerifier: string;
} {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(suppliedState)) throw new Error("OAUTH_STATE_INVALID");
  const cookie = cookieValue(request, OAUTH_STATE_COOKIE_NAME);
  if (!cookie) throw new Error("OAUTH_STATE_MISSING");
  const payload = unseal<OAuthStatePayload>(cookie);
  const now = Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || !safeInteger(payload.installation_id) || payload.exp < now) {
    throw new Error("OAUTH_STATE_EXPIRED");
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(payload.code_verifier) || !equalString(payload.nonce, suppliedState)) {
    throw new Error("OAUTH_STATE_INVALID");
  }
  return { installationId: payload.installation_id, codeVerifier: payload.code_verifier };
}

export function createGithubSessionCookie(input: {
  accessToken: string;
  expiresInSeconds: number;
  githubUserId: number;
  githubLogin: string;
  installationId: number;
}): string {
  if (!input.accessToken || input.accessToken.length > 4096) throw new Error("INVALID_GITHUB_ACCESS_TOKEN");
  if (!safeInteger(input.githubUserId) || !safeLogin(input.githubLogin) || !safeInteger(input.installationId)) {
    throw new Error("INVALID_GITHUB_SESSION_IDENTITY");
  }
  if (!Number.isSafeInteger(input.expiresInSeconds) || input.expiresInSeconds < 60) {
    throw new Error("INVALID_GITHUB_SESSION_EXPIRY");
  }
  const ttl = Math.min(input.expiresInSeconds, MAX_SESSION_TTL_SECONDS);
  const now = Math.floor(Date.now() / 1000);
  const payload: GithubBrowserSession = {
    v: 1,
    access_token: input.accessToken,
    expires_at: now + ttl,
    github_user_id: input.githubUserId,
    github_login: input.githubLogin,
    installation_id: input.installationId,
    issued_at: now,
  };
  return secureCookie(SESSION_COOKIE_NAME, seal(payload), ttl);
}

export function githubSessionFromRequest(request: Request): GithubBrowserSession | null {
  const cookie = cookieValue(request, SESSION_COOKIE_NAME);
  if (!cookie) return null;
  let payload: GithubBrowserSession;
  try { payload = unseal<GithubBrowserSession>(cookie); }
  catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.v !== 1
    || !payload.access_token
    || payload.access_token.length > 4096
    || !safeInteger(payload.github_user_id)
    || !safeLogin(payload.github_login)
    || !safeInteger(payload.installation_id)
    || !safeInteger(payload.issued_at)
    || !safeInteger(payload.expires_at)
    || payload.expires_at <= now
    || payload.issued_at > now + 60
  ) return null;
  return payload;
}

export function githubSessionTokenFromRequest(request: Request): string | null {
  return githubSessionFromRequest(request)?.access_token ?? null;
}

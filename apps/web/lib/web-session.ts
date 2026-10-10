/// <reference types="node" />
// Server-only OIDC authorization-code + PKCE login with an encrypted,
// httpOnly session cookie. The access token never reaches browser JavaScript;
// the `/v1` proxy reads it server-side and forwards it as a bearer token.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-vsn_session';
export const LOGIN_TRANSACTION_COOKIE = '__Host-vsn_oidc_tx';
export const LOGIN_TRANSACTION_TTL_SECONDS = 600;
export const MAX_SESSION_TTL_SECONDS = 8 * 60 * 60;
// Browsers drop cookies over ~4 KiB; refuse rather than silently lose the session.
export const MAX_COOKIE_VALUE_LENGTH = 3800;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9_.-]+$/;

export interface WebSessionConfig {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly redirectUri: string;
  readonly publicOrigin: string;
  readonly scope: string;
  readonly sessionKey: Buffer;
}

export type WebSessionConfigResult =
  | { readonly status: 'configured'; readonly config: WebSessionConfig }
  | { readonly status: 'not_configured' }
  | { readonly status: 'invalid' };

interface LoginTransaction {
  readonly v: 1;
  readonly state: string;
  readonly verifier: string;
  readonly createdAt: number;
}

interface SessionPayload {
  readonly v: 1;
  readonly accessToken: string;
  readonly expiresAt: number;
}

const REQUIRED_KEYS = [
  'VSN_WEB_OIDC_AUTHORIZATION_ENDPOINT',
  'VSN_WEB_OIDC_TOKEN_ENDPOINT',
  'VSN_WEB_OIDC_CLIENT_ID',
  'VSN_WEB_OIDC_REDIRECT_URI',
  'VSN_WEB_SESSION_SECRET',
] as const;

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function parseEndpoint(value: string, allowQuery: boolean): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  if (!secure || url.username !== '' || url.password !== '' || url.hash !== '' || (!allowQuery && url.search !== '')) {
    return null;
  }
  return url;
}

export function loadWebSessionConfig(
  env: Readonly<Record<string, string | undefined>>,
): WebSessionConfigResult {
  const present = REQUIRED_KEYS.filter((key) => (env[key] ?? '').length > 0);
  if (present.length === 0 && (env.VSN_WEB_OIDC_CLIENT_SECRET ?? '') === '') {
    return { status: 'not_configured' };
  }
  if (present.length !== REQUIRED_KEYS.length) {
    return { status: 'invalid' };
  }

  const authorization = parseEndpoint(env.VSN_WEB_OIDC_AUTHORIZATION_ENDPOINT as string, true);
  const token = parseEndpoint(env.VSN_WEB_OIDC_TOKEN_ENDPOINT as string, false);
  const redirect = parseEndpoint(env.VSN_WEB_OIDC_REDIRECT_URI as string, false);
  if (authorization === null || token === null || redirect === null || redirect.pathname !== '/auth/callback') {
    return { status: 'invalid' };
  }

  const clientId = env.VSN_WEB_OIDC_CLIENT_ID as string;
  if (clientId.length > 256 || clientId.trim() !== clientId) {
    return { status: 'invalid' };
  }
  const rawSecret = env.VSN_WEB_OIDC_CLIENT_SECRET ?? '';
  const scope = env.VSN_WEB_OIDC_SCOPE ?? 'openid';
  if (!/^[\x21\x23-\x5B\x5D-\x7E]+( [\x21\x23-\x5B\x5D-\x7E]+)*$/.test(scope) || !scope.split(' ').includes('openid')) {
    return { status: 'invalid' };
  }

  const sessionSecret = env.VSN_WEB_SESSION_SECRET as string;
  if (!/^[A-Za-z0-9_-]+$/.test(sessionSecret)) {
    return { status: 'invalid' };
  }
  const sessionKey = Buffer.from(sessionSecret, 'base64url');
  if (sessionKey.length !== 32) {
    return { status: 'invalid' };
  }

  return {
    status: 'configured',
    config: {
      authorizationEndpoint: authorization.toString(),
      tokenEndpoint: token.toString(),
      clientId,
      clientSecret: rawSecret.length > 0 ? rawSecret : null,
      redirectUri: redirect.toString(),
      publicOrigin: redirect.origin,
      scope,
      sessionKey,
    },
  };
}

export function sealValue(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function unsealValue(key: Buffer, sealed: string): unknown {
  if (sealed.length === 0 || sealed.length > MAX_COOKIE_VALUE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(sealed)) {
    return undefined;
  }
  const raw = Buffer.from(sealed, 'base64url');
  if (raw.length < 12 + 16 + 1) {
    return undefined;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return undefined;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  if (header === null) {
    return null;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  // __Host- cookies require Secure, Path=/ and no Domain.
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', 0);
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function redirectResponse(location: string, cookies: readonly string[], status = 302): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(null, { status, headers });
}

export function beginLogin(config: WebSessionConfig, now: number = Date.now()): Response {
  const transaction: LoginTransaction = {
    v: 1,
    state: randomToken(32),
    verifier: randomToken(48),
    createdAt: now,
  };
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', transaction.state);
  url.searchParams.set('code_challenge', pkceChallenge(transaction.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return redirectResponse(url.toString(), [
    serializeCookie(LOGIN_TRANSACTION_COOKIE, sealValue(config.sessionKey, transaction), LOGIN_TRANSACTION_TTL_SECONDS),
  ]);
}

function isLoginTransaction(value: unknown): value is LoginTransaction {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.state === 'string' &&
    typeof candidate.verifier === 'string' &&
    typeof candidate.createdAt === 'number'
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function loginFailed(config: WebSessionConfig): Response {
  return redirectResponse(`${config.publicOrigin}/?login=failed`, [clearCookie(LOGIN_TRANSACTION_COOKIE)]);
}

async function readBoundedText(response: Response): Promise<string | null> {
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_TOKEN_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function completeLogin(
  request: Request,
  config: WebSessionConfig,
  fetchImpl: typeof fetch,
  now: number = Date.now(),
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const sealed = readCookie(request.headers.get('cookie'), LOGIN_TRANSACTION_COOKIE);
  const transaction = sealed === null ? undefined : unsealValue(config.sessionKey, sealed);
  if (
    code === null ||
    code.length === 0 ||
    code.length > 2048 ||
    state === null ||
    !isLoginTransaction(transaction) ||
    now - transaction.createdAt > LOGIN_TRANSACTION_TTL_SECONDS * 1000 ||
    now < transaction.createdAt ||
    !safeEqual(state, transaction.state)
  ) {
    return loginFailed(config);
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: transaction.verifier,
  });
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  });
  if (config.clientSecret === null) {
    form.set('client_id', config.clientId);
  } else {
    const credentials = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`;
    headers.set('authorization', `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS);
  let payload: unknown;
  try {
    const response = await fetchImpl(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: form.toString(),
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status !== 200) {
      return loginFailed(config);
    }
    const text = await readBoundedText(response);
    payload = text === null ? undefined : JSON.parse(text);
  } catch {
    return loginFailed(config);
  } finally {
    clearTimeout(timer);
  }

  if (typeof payload !== 'object' || payload === null) {
    return loginFailed(config);
  }
  const tokenResponse = payload as Record<string, unknown>;
  const accessToken = tokenResponse.access_token;
  const expiresIn = tokenResponse.expires_in;
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    accessToken.length > 8192 ||
    !BEARER_TOKEN_PATTERN.test(accessToken) ||
    typeof tokenResponse.token_type !== 'string' ||
    tokenResponse.token_type.toLowerCase() !== 'bearer' ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return loginFailed(config);
  }

  const ttl = Math.min(Math.floor(expiresIn), MAX_SESSION_TTL_SECONDS);
  const session: SessionPayload = { v: 1, accessToken, expiresAt: now + ttl * 1000 };
  const sealedSession = sealValue(config.sessionKey, session);
  if (sealedSession.length > MAX_COOKIE_VALUE_LENGTH) {
    return loginFailed(config);
  }
  return redirectResponse(`${config.publicOrigin}/`, [
    clearCookie(LOGIN_TRANSACTION_COOKIE),
    serializeCookie(SESSION_COOKIE, sealedSession, ttl),
  ]);
}

export function sessionAccessToken(
  request: Request,
  config: WebSessionConfig,
  now: number = Date.now(),
): string | null {
  const sealed = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (sealed === null) {
    return null;
  }
  const session = unsealValue(config.sessionKey, sealed);
  if (typeof session !== 'object' || session === null) {
    return null;
  }
  const candidate = session as Record<string, unknown>;
  if (
    candidate.v !== 1 ||
    typeof candidate.accessToken !== 'string' ||
    !BEARER_TOKEN_PATTERN.test(candidate.accessToken) ||
    typeof candidate.expiresAt !== 'number' ||
    candidate.expiresAt <= now
  ) {
    return null;
  }
  return candidate.accessToken;
}

/**
 * CSRF guard for state-changing requests: the browser must prove the request
 * came from this site via Fetch Metadata or an exact Origin match.
 */
export function isSameOriginMutation(request: Request, publicOrigin: string | null): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null) {
    return fetchSite === 'same-origin';
  }
  const origin = request.headers.get('origin');
  if (origin === null) {
    return false;
  }
  return origin === new URL(request.url).origin || (publicOrigin !== null && origin === publicOrigin);
}

export function logout(request: Request, config: WebSessionConfig): Response {
  if (!isSameOriginMutation(request, config.publicOrigin)) {
    return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  return redirectResponse(`${config.publicOrigin}/`, [clearCookie(SESSION_COOKIE)], 303);
}

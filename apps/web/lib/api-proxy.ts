// Server-only backend-for-frontend proxy: the browser keeps calling same-origin
// `/v1/*` with cookies, and the Next.js server forwards an allowlisted request
// to the control API, attaching a bearer token only from server-side state.

export interface ApiProxyConfig {
  readonly apiOrigin: string;
  readonly timeoutMs: number;
}

export type ApiProxyConfigResult =
  | { readonly status: 'configured'; readonly config: ApiProxyConfig }
  | { readonly status: 'not_configured' }
  | { readonly status: 'invalid' };

/** Resolves the server-held access token for a browser request, or null. */
export type ServerAccessTokenProvider = (request: Request) => Promise<string | null>;

export interface ApiProxyDependencies {
  readonly fetchImpl: typeof fetch;
  readonly accessToken: ServerAccessTokenProvider;
  /** CSRF guard: must confirm a state-changing request came from this site. */
  readonly allowMutation: (request: Request) => boolean;
}

export const API_PROXY_METHODS = ['GET', 'POST', 'PUT'] as const;
export const MAX_PROXY_REQUEST_BODY_BYTES = 64 * 1024;
export const MAX_PROXY_RESPONSE_BODY_BYTES = 1024 * 1024;
const MAX_PATH_SEGMENTS = 8;
const MAX_PATH_SEGMENT_LENGTH = 256;
const MAX_QUERY_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const noServerAccessToken: ServerAccessTokenProvider = async () => null;

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function loadApiProxyConfig(
  env: Readonly<Record<string, string | undefined>>,
): ApiProxyConfigResult {
  const rawOrigin = env.VSN_API_ORIGIN ?? '';
  if (rawOrigin.length === 0) {
    return { status: 'not_configured' };
  }

  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    return { status: 'invalid' };
  }
  const httpsOrLocal =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  if (
    !httpsOrLocal ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return { status: 'invalid' };
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const rawTimeout = env.VSN_API_PROXY_TIMEOUT_MS ?? '';
  if (rawTimeout.length > 0) {
    if (!/^\d+$/.test(rawTimeout)) {
      return { status: 'invalid' };
    }
    timeoutMs = Number(rawTimeout);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      return { status: 'invalid' };
    }
  }

  return { status: 'configured', config: { apiOrigin: url.origin, timeoutMs } };
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function buildUpstreamPath(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > MAX_PATH_SEGMENTS) {
    return null;
  }
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment.length > MAX_PATH_SEGMENT_LENGTH ||
      !PATH_SEGMENT_PATTERN.test(segment)
    ) {
      return null;
    }
  }
  return `/v1/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (body === null) {
    return new Uint8Array(new ArrayBuffer(0));
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && /^application\/json(\s*;\s*charset=utf-8)?$/i.test(value.trim());
}

export async function proxyApiRequest(
  request: Request,
  segments: readonly string[],
  configResult: ApiProxyConfigResult,
  dependencies: ApiProxyDependencies,
): Promise<Response> {
  if (configResult.status !== 'configured') {
    return jsonError(503, 'api_unavailable');
  }
  const { config } = configResult;

  const method = request.method.toUpperCase();
  if (!(API_PROXY_METHODS as readonly string[]).includes(method)) {
    return jsonError(405, 'method_not_allowed');
  }
  if (method !== 'GET' && !dependencies.allowMutation(request)) {
    return jsonError(403, 'forbidden');
  }

  const path = buildUpstreamPath(segments);
  if (path === null) {
    return jsonError(404, 'not_found');
  }
  const incomingUrl = new URL(request.url);
  if (incomingUrl.search.length > MAX_QUERY_LENGTH) {
    return jsonError(414, 'uri_too_long');
  }

  const headers = new Headers({ accept: 'application/json' });
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method !== 'GET') {
    const bytes = await readBoundedBody(request.body, MAX_PROXY_REQUEST_BODY_BYTES);
    if (bytes === null) {
      return jsonError(413, 'payload_too_large');
    }
    if (bytes.byteLength > 0) {
      if (!isJsonContentType(request.headers.get('content-type'))) {
        return jsonError(415, 'unsupported_media_type');
      }
      headers.set('content-type', 'application/json');
      body = bytes;
    }
  }

  let token: string | null;
  try {
    token = await dependencies.accessToken(request);
  } catch {
    return jsonError(503, 'api_unavailable');
  }
  if (token !== null) {
    if (token.length === 0 || token.length > 8192 || !BEARER_TOKEN_PATTERN.test(token)) {
      return jsonError(503, 'api_unavailable');
    }
    headers.set('authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const upstream = await dependencies.fetchImpl(`${config.apiOrigin}${path}${incomingUrl.search}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return jsonError(502, 'bad_gateway');
    }
    const responseBody = await readBoundedBody(upstream.body, MAX_PROXY_RESPONSE_BODY_BYTES);
    if (responseBody === null) {
      return jsonError(502, 'bad_gateway');
    }
    const responseHeaders = new Headers({ 'cache-control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    if (contentType !== null) {
      responseHeaders.set('content-type', contentType);
    }
    const nullBodyStatus = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
    return new Response(nullBodyStatus ? null : responseBody, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError(503, 'api_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

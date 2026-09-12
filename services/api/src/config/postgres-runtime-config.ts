export type PostgresSslMode = 'require' | 'disable';

export interface PostgresRuntimeConfig {
  readonly connectionString: string;
  readonly sslMode: PostgresSslMode;
  readonly maxConnections: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
}

const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

function parseBoundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must contain only decimal digits`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside the allowed range`);
  }
  return parsed;
}

function parseConnectionString(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('VSN_POSTGRES_URL must be a valid PostgreSQL URL');
  }

  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    parsed.hostname.length === 0 ||
    parsed.pathname.length <= 1 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0
  ) {
    throw new Error('VSN_POSTGRES_URL must be a queryless PostgreSQL URL with host and database name');
  }
  return trimmed;
}

function parseSslMode(
  value: string | undefined,
  environment: string | undefined,
): PostgresSslMode {
  const fallback: PostgresSslMode = environment === 'production' ? 'require' : 'disable';
  const mode = value === undefined || value.length === 0 ? fallback : value;
  if (mode !== 'require' && mode !== 'disable') {
    throw new Error('VSN_POSTGRES_SSL_MODE must be require or disable');
  }
  if (environment === 'production' && mode !== 'require') {
    throw new Error('VSN_POSTGRES_SSL_MODE must be require in production');
  }
  return mode;
}

export function loadOptionalPostgresRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): PostgresRuntimeConfig | null {
  const rawConnectionString = env.VSN_POSTGRES_URL;
  if (rawConnectionString === undefined || rawConnectionString.trim().length === 0) {
    return null;
  }

  return Object.freeze({
    connectionString: parseConnectionString(rawConnectionString),
    sslMode: parseSslMode(env.VSN_POSTGRES_SSL_MODE, env.VSN_ENV),
    maxConnections: parseBoundedInteger(
      env.VSN_POSTGRES_MAX_CONNECTIONS,
      'VSN_POSTGRES_MAX_CONNECTIONS',
      DEFAULT_MAX_CONNECTIONS,
      1,
      32,
    ),
    connectionTimeoutMs: parseBoundedInteger(
      env.VSN_POSTGRES_CONNECT_TIMEOUT_MS,
      'VSN_POSTGRES_CONNECT_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
      250,
      15_000,
    ),
    idleTimeoutMs: parseBoundedInteger(
      env.VSN_POSTGRES_IDLE_TIMEOUT_MS,
      'VSN_POSTGRES_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
      1_000,
      120_000,
    ),
  });
}

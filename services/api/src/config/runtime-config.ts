export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly environment: RuntimeEnvironment;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4100;
const DEFAULT_ENVIRONMENT: RuntimeEnvironment = 'development';

function parseEnvironment(value: string | undefined): RuntimeEnvironment {
  if (value === undefined || value.length === 0) {
    return DEFAULT_ENVIRONMENT;
  }
  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }
  throw new Error(`VSN_ENV must be one of development, test, production; received ${value}`);
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error('PORT must contain only decimal digits');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return parsed;
}

function parseHost(value: string | undefined): string {
  const host = value ?? DEFAULT_HOST;
  if (host.length === 0 || host.length > 255 || /\s/.test(host)) {
    throw new Error('VSN_API_HOST must be a non-empty host without whitespace');
  }
  return host;
}

export function loadRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  return Object.freeze({
    host: parseHost(env.VSN_API_HOST),
    port: parsePort(env.PORT),
    environment: parseEnvironment(env.VSN_ENV),
  });
}

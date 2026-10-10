import {
  DEFAULT_CLOCK_SKEW_SECONDS,
  OidcBearerTokenPrincipalResolver,
  OidcBearerTokenVerifier,
  type OidcBearerTokenVerifierConfig,
  OidcConfigurationError,
  parseOidcJwks,
  validateClockSkewSeconds,
} from './oidc-bearer-token-resolver.js';
import {
  RejectingTrustedPrincipalResolver,
  type TrustedPrincipalResolver,
} from './trusted-principal-resolver.js';

const OIDC_ENV_KEYS = [
  'VSN_OIDC_ISSUER',
  'VSN_OIDC_AUDIENCE',
  'VSN_OIDC_JWKS_JSON',
] as const;

function parseIssuer(value: string, environment: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcConfigurationError('VSN_OIDC_ISSUER must be an absolute URL');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new OidcConfigurationError('VSN_OIDC_ISSUER must not contain credentials, query or fragment');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && environment !== 'production')) {
    throw new OidcConfigurationError('VSN_OIDC_ISSUER must use https');
  }
  // Issuer comparison is exact, so keep the configured spelling.
  return value;
}

function parseAudience(value: string): string {
  if (value.length === 0 || value.length > 512 || value.trim() !== value) {
    throw new OidcConfigurationError('VSN_OIDC_AUDIENCE must be a non-empty trimmed string');
  }
  return value;
}

function parseClockSkew(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return DEFAULT_CLOCK_SKEW_SECONDS;
  }
  if (!/^\d+$/.test(value)) {
    throw new OidcConfigurationError('VSN_OIDC_CLOCK_SKEW_SECONDS must contain only digits');
  }
  return validateClockSkewSeconds(Number(value));
}

/**
 * Returns null when no OIDC settings are present so the API keeps failing
 * closed; any partial configuration is a startup error, never a silent bypass.
 */
export function loadOptionalOidcVerifierConfig(
  env: Readonly<Record<string, string | undefined>>,
): OidcBearerTokenVerifierConfig | null {
  const present = OIDC_ENV_KEYS.filter((key) => (env[key] ?? '').length > 0);
  if (present.length === 0) {
    return null;
  }
  if (present.length !== OIDC_ENV_KEYS.length) {
    throw new OidcConfigurationError(
      `OIDC configuration requires all of ${OIDC_ENV_KEYS.join(', ')}`,
    );
  }

  let jwks: unknown;
  try {
    jwks = JSON.parse(env.VSN_OIDC_JWKS_JSON as string);
  } catch {
    throw new OidcConfigurationError('VSN_OIDC_JWKS_JSON must be valid JSON');
  }

  return Object.freeze({
    issuer: parseIssuer(env.VSN_OIDC_ISSUER as string, env.VSN_ENV),
    audience: parseAudience(env.VSN_OIDC_AUDIENCE as string),
    keys: parseOidcJwks(jwks),
    clockSkewSeconds: parseClockSkew(env.VSN_OIDC_CLOCK_SKEW_SECONDS),
  });
}

export function createRuntimeTrustedPrincipalResolver(
  env: Readonly<Record<string, string | undefined>>,
): TrustedPrincipalResolver {
  const config = loadOptionalOidcVerifierConfig(env);
  return config === null
    ? new RejectingTrustedPrincipalResolver()
    : new OidcBearerTokenPrincipalResolver(new OidcBearerTokenVerifier(config));
}

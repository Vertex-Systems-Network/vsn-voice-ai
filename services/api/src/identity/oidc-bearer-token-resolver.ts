import { createPublicKey, type JsonWebKey, type KeyObject, verify } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import {
  type AuthenticatedPrincipal,
  MAX_AUTHENTICATED_PRINCIPAL_IDENTIFIER_LENGTH,
} from './authenticated-principal.js';
import type { TrustedPrincipalResolver } from './trusted-principal-resolver.js';

// Bounds parsing work for hostile headers; real OIDC access tokens are far smaller.
export const MAX_BEARER_TOKEN_LENGTH = 8192;
export const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_JWKS_KEYS = 16;

export type OidcSignatureAlgorithm = 'RS256' | 'ES256';

export interface OidcVerificationKey {
  readonly kid: string | null;
  readonly alg: OidcSignatureAlgorithm;
  readonly key: KeyObject;
}

export interface OidcBearerTokenVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly keys: readonly OidcVerificationKey[];
  readonly clockSkewSeconds: number;
}

export class OidcConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OidcConfigurationError';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function algorithmForJwk(jwk: Readonly<Record<string, unknown>>): OidcSignatureAlgorithm {
  if (jwk.kty === 'RSA') {
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') {
      throw new OidcConfigurationError('RSA verification keys must use RS256');
    }
    return 'RS256';
  }
  if (jwk.kty === 'EC') {
    if (jwk.crv !== 'P-256' || (jwk.alg !== undefined && jwk.alg !== 'ES256')) {
      throw new OidcConfigurationError('EC verification keys must use P-256 / ES256');
    }
    return 'ES256';
  }
  throw new OidcConfigurationError('verification keys must be RSA or EC');
}

/**
 * Converts a public JWKS document into verification keys. Private key
 * material and encryption-only keys are rejected so a misconfigured secret
 * can never be loaded as a trust anchor.
 */
export function parseOidcJwks(document: unknown): readonly OidcVerificationKey[] {
  if (!isRecord(document) || !Array.isArray(document.keys)) {
    throw new OidcConfigurationError('JWKS must be an object with a keys array');
  }
  if (document.keys.length === 0 || document.keys.length > MAX_JWKS_KEYS) {
    throw new OidcConfigurationError(`JWKS must contain 1 to ${MAX_JWKS_KEYS} keys`);
  }

  const kids = new Set<string>();
  const keys = document.keys.map((candidate: unknown): OidcVerificationKey => {
    if (!isRecord(candidate)) {
      throw new OidcConfigurationError('JWKS entries must be objects');
    }
    for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']) {
      if (privateField in candidate) {
        throw new OidcConfigurationError('JWKS must contain public keys only');
      }
    }
    if (candidate.use !== undefined && candidate.use !== 'sig') {
      throw new OidcConfigurationError('JWKS keys must be signature keys');
    }
    if (
      candidate.key_ops !== undefined &&
      (!Array.isArray(candidate.key_ops) || !candidate.key_ops.includes('verify'))
    ) {
      throw new OidcConfigurationError('JWKS key_ops must allow verify');
    }
    const kid = candidate.kid;
    if (kid !== undefined && (typeof kid !== 'string' || kid.length === 0 || kid.length > 256)) {
      throw new OidcConfigurationError('JWKS kid must be a non-empty string');
    }
    if (kid !== undefined) {
      if (kids.has(kid)) {
        throw new OidcConfigurationError('JWKS kid values must be unique');
      }
      kids.add(kid);
    }

    const alg = algorithmForJwk(candidate);
    let key: KeyObject;
    try {
      key = createPublicKey({ key: candidate as JsonWebKey, format: 'jwk' });
    } catch {
      throw new OidcConfigurationError('JWKS contains an invalid public key');
    }
    if (alg === 'RS256' && (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new OidcConfigurationError('RSA verification keys must be at least 2048 bits');
    }
    return Object.freeze({ kid: kid ?? null, alg, key });
  });

  if (keys.length > 1 && keys.some((key) => key.kid === null)) {
    throw new OidcConfigurationError('multi-key JWKS entries must all declare kid');
  }
  return Object.freeze(keys);
}

function decodeSegmentJson(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function isCanonicalIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_AUTHENTICATED_PRINCIPAL_IDENTIFIER_LENGTH &&
    value.trim() === value
  );
}

function isNumericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  if (match === null || match[1] === undefined || match[1].length > MAX_BEARER_TOKEN_LENGTH) {
    return null;
  }
  return match[1];
}

/**
 * Verifies a compact-serialized OIDC JWT access/ID token against a fixed,
 * pre-loaded JWKS. Every rejection collapses to `null` (unauthenticated); no
 * token, claim or key detail is surfaced to callers.
 */
export class OidcBearerTokenVerifier {
  public constructor(
    private readonly config: OidcBearerTokenVerifierConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public verify(token: string): AuthenticatedPrincipal | null {
    if (token.length === 0 || token.length > MAX_BEARER_TOKEN_LENGTH) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

    const header = decodeSegmentJson(encodedHeader);
    if (!isRecord(header) || 'crit' in header) {
      return null;
    }
    const alg = header.alg;
    if (alg !== 'RS256' && alg !== 'ES256') {
      return null;
    }
    if (header.kid !== undefined && typeof header.kid !== 'string') {
      return null;
    }
    const key = this.selectKey(alg, header.kid);
    if (key === null) {
      return null;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
      return null;
    }
    const signature = Buffer.from(encodedSignature, 'base64url');
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
    let valid: boolean;
    try {
      valid =
        alg === 'RS256'
          ? verify('sha256', signingInput, key.key, signature)
          : verify('sha256', signingInput, { key: key.key, dsaEncoding: 'ieee-p1363' }, signature);
    } catch {
      return null;
    }
    if (!valid) {
      return null;
    }

    const claims = decodeSegmentJson(encodedPayload);
    if (!isRecord(claims)) {
      return null;
    }
    return this.principalFromClaims(claims);
  }

  private selectKey(alg: OidcSignatureAlgorithm, kid: string | undefined): OidcVerificationKey | null {
    const candidates = this.config.keys.filter((key) => key.alg === alg);
    if (kid === undefined) {
      // Without a kid only an unambiguous single-key JWKS is acceptable.
      return this.config.keys.length === 1 && candidates.length === 1 ? (candidates[0] ?? null) : null;
    }
    return candidates.find((key) => key.kid === kid) ?? null;
  }

  private principalFromClaims(
    claims: Readonly<Record<string, unknown>>,
  ): AuthenticatedPrincipal | null {
    if (claims.iss !== this.config.issuer) {
      return null;
    }
    const audience = claims.aud;
    const audienceMatches =
      audience === this.config.audience ||
      (Array.isArray(audience) &&
        audience.length > 0 &&
        audience.every((entry) => typeof entry === 'string') &&
        audience.includes(this.config.audience));
    if (!audienceMatches) {
      return null;
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    const skew = this.config.clockSkewSeconds;
    if (!isNumericDate(claims.exp) || claims.exp <= nowSeconds - skew) {
      return null;
    }
    if (claims.nbf !== undefined && (!isNumericDate(claims.nbf) || claims.nbf > nowSeconds + skew)) {
      return null;
    }
    if (claims.iat !== undefined && (!isNumericDate(claims.iat) || claims.iat > nowSeconds + skew)) {
      return null;
    }

    if (!isCanonicalIdentifier(claims.sub)) {
      return null;
    }
    if (claims.sid !== undefined && !isCanonicalIdentifier(claims.sid)) {
      return null;
    }
    return Object.freeze(
      claims.sid === undefined
        ? { subjectId: claims.sub }
        : { subjectId: claims.sub, sessionId: claims.sid },
    );
  }
}

export class OidcBearerTokenPrincipalResolver implements TrustedPrincipalResolver {
  public constructor(private readonly verifier: OidcBearerTokenVerifier) {}

  public async resolve(request: FastifyRequest): Promise<AuthenticatedPrincipal | null> {
    const token = extractBearerToken(request);
    return token === null ? null : this.verifier.verify(token);
  }
}

export function validateClockSkewSeconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CLOCK_SKEW_SECONDS) {
    throw new OidcConfigurationError(
      `clock skew must be an integer between 0 and ${MAX_CLOCK_SKEW_SECONDS} seconds`,
    );
  }
  return value;
}

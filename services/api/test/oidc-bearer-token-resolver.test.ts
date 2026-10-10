import assert from 'node:assert/strict';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import test from 'node:test';

import type { FastifyRequest } from 'fastify';

import {
  extractBearerToken,
  MAX_BEARER_TOKEN_LENGTH,
  OidcBearerTokenPrincipalResolver,
  OidcBearerTokenVerifier,
  OidcConfigurationError,
  parseOidcJwks,
} from '../src/identity/oidc-bearer-token-resolver.js';
import {
  createRuntimeTrustedPrincipalResolver,
  loadOptionalOidcVerifierConfig,
} from '../src/identity/runtime-trusted-principal-resolver.js';
import {
  RejectingTrustedPrincipalResolver,
  resolveTrustedPrincipal,
} from '../src/identity/trusted-principal-resolver.js';

const ISSUER = 'https://issuer.example.test/';
const AUDIENCE = 'vsn-api';
const NOW_MS = Date.UTC(2026, 9, 10, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaOther = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });

function publicJwk(key: KeyObject, kid?: string): Record<string, unknown> {
  const jwk = key.export({ format: 'jwk' }) as Record<string, unknown>;
  return kid === undefined ? { ...jwk, use: 'sig' } : { ...jwk, use: 'sig', kid };
}

const jwks = {
  keys: [publicJwk(rsa.publicKey, 'rsa-1'), publicJwk(ec.publicKey, 'ec-1')],
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function token(
  claims: Record<string, unknown>,
  options: {
    readonly alg?: string;
    readonly kid?: string | undefined;
    readonly key?: KeyObject;
    readonly header?: Record<string, unknown>;
  } = {},
): string {
  const alg = options.alg ?? 'RS256';
  const header: Record<string, unknown> = { alg, typ: 'JWT', ...options.header };
  if (!('kid' in options)) {
    header.kid = alg === 'ES256' ? 'ec-1' : 'rsa-1';
  } else if (options.kid !== undefined) {
    header.kid = options.kid;
  }
  const input = `${encode(header)}.${encode(claims)}`;
  const key = options.key ?? (alg === 'ES256' ? ec.privateKey : rsa.privateKey);
  const signature =
    alg === 'ES256'
      ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
      : sign('sha256', Buffer.from(input), key);
  return `${input}.${signature.toString('base64url')}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'user_123',
    iat: NOW - 10,
    exp: NOW + 300,
    ...overrides,
  };
}

function verifier(keys: unknown = jwks): OidcBearerTokenVerifier {
  return new OidcBearerTokenVerifier(
    { issuer: ISSUER, audience: AUDIENCE, keys: parseOidcJwks(keys), clockSkewSeconds: 60 },
    () => NOW_MS,
  );
}

function requestWith(authorization: string | undefined): FastifyRequest {
  return { headers: authorization === undefined ? {} : { authorization } } as unknown as FastifyRequest;
}

test('valid RS256 and ES256 tokens yield a frozen subject-only principal', () => {
  const v = verifier();
  for (const alg of ['RS256', 'ES256']) {
    const principal = v.verify(token(validClaims({ email: 'ignored@example.test' }), { alg }));
    assert.deepEqual(principal, { subjectId: 'user_123' });
    assert.equal(Object.isFrozen(principal), true);
  }
});

test('sid maps to sessionId and audience arrays are accepted', () => {
  assert.deepEqual(
    verifier().verify(token(validClaims({ sid: 'session_abc', aud: ['other', AUDIENCE] }))),
    { subjectId: 'user_123', sessionId: 'session_abc' },
  );
});

test('signature, algorithm and key-selection attacks are rejected', () => {
  const v = verifier();
  const valid = token(validClaims());
  const [h, p] = valid.split('.') as [string, string, string];
  const cases = [
    `${h}.${encode(validClaims({ sub: 'admin' }))}.${valid.split('.')[2]}`,
    `${encode({ alg: 'none', kid: 'rsa-1' })}.${p}.`,
    `${encode({ alg: 'HS256', kid: 'rsa-1' })}.${p}.c2ln`,
    token(validClaims(), { key: rsaOther.privateKey }),
    token(validClaims(), { kid: 'unknown' }),
    token(validClaims(), { kid: undefined }),
    token(validClaims(), { alg: 'RS256', kid: 'ec-1' }),
    token(validClaims(), { header: { crit: ['exp'] } }),
    'not-a-jwt',
    `${h}.${p}`,
    `${h}.${p}.@@@`,
  ];
  for (const candidate of cases) {
    assert.equal(v.verify(candidate), null, candidate.slice(0, 40));
  }
});

test('single-key JWKS accepts a token without kid', () => {
  const single = verifier({ keys: [publicJwk(rsa.publicKey)] });
  assert.deepEqual(single.verify(token(validClaims(), { kid: undefined })), {
    subjectId: 'user_123',
  });
});

test('issuer, audience, time and subject claims are enforced', () => {
  const v = verifier();
  const rejected = [
    validClaims({ iss: 'https://issuer.example.test' }),
    validClaims({ aud: 'someone-else' }),
    validClaims({ aud: [] }),
    validClaims({ aud: ['other', 7] }),
    validClaims({ exp: undefined }),
    validClaims({ exp: NOW - 61 }),
    validClaims({ exp: String(NOW + 300) }),
    validClaims({ nbf: NOW + 61 }),
    validClaims({ iat: NOW + 61 }),
    validClaims({ sub: undefined }),
    validClaims({ sub: '' }),
    validClaims({ sub: ' user_123' }),
    validClaims({ sub: 'x'.repeat(129) }),
    validClaims({ sid: '' }),
  ];
  for (const claims of rejected) {
    assert.equal(v.verify(token(claims)), null, JSON.stringify(claims).slice(0, 80));
  }
  assert.notEqual(v.verify(token(validClaims({ exp: NOW - 30, nbf: NOW + 30 }))), null);
});

test('bearer extraction is strict and bounded', () => {
  assert.equal(extractBearerToken(requestWith(undefined)), null);
  assert.equal(extractBearerToken(requestWith('Basic abc')), null);
  assert.equal(extractBearerToken(requestWith('bearer abc')), null);
  assert.equal(extractBearerToken(requestWith('Bearer  abc')), null);
  assert.equal(extractBearerToken(requestWith('Bearer a b')), null);
  assert.equal(extractBearerToken(requestWith(`Bearer ${'a'.repeat(MAX_BEARER_TOKEN_LENGTH + 1)}`)), null);
  assert.equal(extractBearerToken(requestWith('Bearer abc.def.ghi')), 'abc.def.ghi');
});

test('resolver maps valid, missing and invalid tokens through the trusted boundary', async () => {
  const resolver = new OidcBearerTokenPrincipalResolver(verifier());
  assert.deepEqual(
    await resolveTrustedPrincipal(resolver, requestWith(`Bearer ${token(validClaims())}`)),
    { status: 'authenticated', principal: { subjectId: 'user_123' } },
  );
  assert.deepEqual(await resolveTrustedPrincipal(resolver, requestWith(undefined)), {
    status: 'unauthenticated',
  });
  assert.deepEqual(
    await resolveTrustedPrincipal(resolver, requestWith('Bearer abc.def.ghi')),
    { status: 'unauthenticated' },
  );
});

test('JWKS parsing rejects private, symmetric, weak, encryption and ambiguous keys', () => {
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const invalid: unknown[] = [
    null,
    { keys: [] },
    { keys: 'nope' },
    { keys: [rsa.privateKey.export({ format: 'jwk' })] },
    { keys: [{ kty: 'oct', k: 'c2VjcmV0' }] },
    { keys: [publicJwk(weak.publicKey)] },
    { keys: [publicJwk(p384.publicKey)] },
    { keys: [{ ...publicJwk(rsa.publicKey), use: 'enc' }] },
    { keys: [{ ...publicJwk(rsa.publicKey), alg: 'RS512' }] },
    { keys: [{ ...publicJwk(rsa.publicKey), key_ops: ['encrypt'] }] },
    { keys: [publicJwk(rsa.publicKey), publicJwk(ec.publicKey, 'ec-1')] },
    { keys: [publicJwk(rsa.publicKey, 'dup'), publicJwk(ec.publicKey, 'dup')] },
  ];
  for (const document of invalid) {
    assert.throws(() => parseOidcJwks(document), OidcConfigurationError);
  }
});

test('runtime config stays fail-closed when unset and rejects partial or unsafe settings', () => {
  assert.equal(loadOptionalOidcVerifierConfig({}), null);
  assert.ok(createRuntimeTrustedPrincipalResolver({}) instanceof RejectingTrustedPrincipalResolver);

  const full = {
    VSN_OIDC_ISSUER: ISSUER,
    VSN_OIDC_AUDIENCE: AUDIENCE,
    VSN_OIDC_JWKS_JSON: JSON.stringify(jwks),
  };
  assert.ok(createRuntimeTrustedPrincipalResolver(full) instanceof OidcBearerTokenPrincipalResolver);
  assert.equal(loadOptionalOidcVerifierConfig(full)?.clockSkewSeconds, 60);
  assert.equal(
    loadOptionalOidcVerifierConfig({
      ...full,
      VSN_ENV: 'development',
      VSN_OIDC_ISSUER: 'http://localhost:8080/realms/dev',
    })?.issuer,
    'http://localhost:8080/realms/dev',
  );

  const invalid: Record<string, string>[] = [
    { VSN_OIDC_ISSUER: ISSUER },
    { ...full, VSN_OIDC_JWKS_JSON: '{' },
    { ...full, VSN_OIDC_ISSUER: 'http://issuer.example.test/' },
    { ...full, VSN_ENV: 'production', VSN_OIDC_ISSUER: 'http://localhost/' },
    { ...full, VSN_OIDC_ISSUER: 'https://user:pass@issuer.example.test/' },
    { ...full, VSN_OIDC_ISSUER: 'not a url' },
    { ...full, VSN_OIDC_AUDIENCE: ' vsn-api' },
    { ...full, VSN_OIDC_CLOCK_SKEW_SECONDS: '-1' },
    { ...full, VSN_OIDC_CLOCK_SKEW_SECONDS: '301' },
  ];
  for (const env of invalid) {
    assert.throws(() => loadOptionalOidcVerifierConfig(env), OidcConfigurationError);
  }
});

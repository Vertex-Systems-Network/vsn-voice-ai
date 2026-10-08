import assert from 'node:assert/strict';
import test from 'node:test';

import type { FastifyRequest } from 'fastify';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import {
  RejectingTrustedPrincipalResolver,
  resolveTrustedPrincipal,
  type TrustedPrincipalResolver,
} from '../src/identity/trusted-principal-resolver.js';

const opaqueRequest = Object.freeze({ marker: 'opaque-request' }) as unknown as FastifyRequest;

class StaticResolver implements TrustedPrincipalResolver {
  public constructor(private readonly value: AuthenticatedPrincipal | null) {}

  public async resolve(_request: FastifyRequest): Promise<AuthenticatedPrincipal | null> {
    return this.value;
  }
}

class ThrowingResolver implements TrustedPrincipalResolver {
  public async resolve(_request: FastifyRequest): Promise<AuthenticatedPrincipal | null> {
    throw new Error('provider details must not escape');
  }
}

test('valid adapter output is detached, frozen and stripped to the trusted principal contract', async () => {
  const adapterOutput = {
    subjectId: 'user_123',
    sessionId: 'session_abc',
    providerSecret: 'must-not-propagate',
  } as AuthenticatedPrincipal & { providerSecret: string };

  const result = await resolveTrustedPrincipal(
    new StaticResolver(adapterOutput),
    opaqueRequest,
  );

  assert.equal(result.status, 'authenticated');
  if (result.status !== 'authenticated') return;
  assert.notEqual(result.principal, adapterOutput);
  assert.deepEqual(result.principal, {
    subjectId: 'user_123',
    sessionId: 'session_abc',
  });
  assert.equal(Object.isFrozen(result.principal), true);
  assert.equal('providerSecret' in result.principal, false);
});

test('null adapter output remains unauthenticated', async () => {
  assert.deepEqual(
    await resolveTrustedPrincipal(
      new RejectingTrustedPrincipalResolver(),
      opaqueRequest,
    ),
    { status: 'unauthenticated' },
  );
});

test('resolver failures collapse to unavailable without exposing provider details', async () => {
  assert.deepEqual(
    await resolveTrustedPrincipal(new ThrowingResolver(), opaqueRequest),
    { status: 'unavailable' },
  );
});

test('malformed adapter outputs collapse to unavailable', async () => {
  const malformed = [
    undefined,
    {},
    { subjectId: '' },
    { subjectId: ' user_123' },
    { subjectId: 'user_123 ' },
    { subjectId: 'x'.repeat(129) },
    { subjectId: 'user_123', sessionId: '' },
    { subjectId: 'user_123', sessionId: ' session_abc' },
    { subjectId: 'user_123', sessionId: 'x'.repeat(129) },
    { subjectId: 123 },
  ];

  for (const candidate of malformed) {
    const resolver = {
      async resolve(): Promise<AuthenticatedPrincipal | null> {
        return candidate as AuthenticatedPrincipal;
      },
    } satisfies TrustedPrincipalResolver;
    assert.deepEqual(
      await resolveTrustedPrincipal(resolver, opaqueRequest),
      { status: 'unavailable' },
    );
  }
});

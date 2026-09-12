import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import type {
  ClosablePostgresQueryClient,
} from '../src/organizations/node-postgres-query-client.js';
import type {
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  createRuntimeOrganizationMembershipResolver,
} from '../src/organizations/runtime-organization-membership-resolver.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
  sessionId: 'session_abc',
};

class FakePostgresClient implements ClosablePostgresQueryClient {
  public closeCalls = 0;
  public readonly queries: Array<{
    text: string;
    values: readonly unknown[];
  }> = [];

  public constructor(private readonly rows: readonly unknown[]) {}

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values: [...values] });
    return { rows: this.rows as readonly Row[] };
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

test('missing database config keeps membership resolution fail-closed without creating a pool', async () => {
  let factoryCalls = 0;
  const resolver = createRuntimeOrganizationMembershipResolver(
    { VSN_ENV: 'production' },
    () => {
      factoryCalls += 1;
      return new FakePostgresClient([]);
    },
  );

  assert.equal(await resolver.resolve(principal, 'org_456'), null);
  assert.equal(factoryCalls, 0);
  await resolver.onApplicationShutdown();
});

test('configured runtime injects bounded PostgreSQL config and delegates trusted membership lookup', async () => {
  const fakeClient = new FakePostgresClient([
    {
      membership_id: 'membership_789',
      subject_id: 'user_123',
      organization_id: 'org_456',
      status: 'active',
      roles: ['member'],
      permissions: ['conversation.read'],
    },
  ]);
  let capturedConfig: unknown;
  const resolver = createRuntimeOrganizationMembershipResolver(
    {
      VSN_ENV: 'production',
      VSN_POSTGRES_URL: 'postgresql://vsn:secret@db.example.com/vsn',
      VSN_POSTGRES_MAX_CONNECTIONS: '4',
      VSN_POSTGRES_CONNECT_TIMEOUT_MS: '1000',
      VSN_POSTGRES_IDLE_TIMEOUT_MS: '5000',
    },
    (config) => {
      capturedConfig = config;
      return fakeClient;
    },
  );

  assert.deepEqual(capturedConfig, {
    connectionString: 'postgresql://vsn:secret@db.example.com/vsn',
    sslMode: 'require',
    maxConnections: 4,
    connectionTimeoutMs: 1_000,
    idleTimeoutMs: 5_000,
  });

  const membership = await resolver.resolve(principal, 'org_456');
  assert.deepEqual(membership, {
    membershipId: 'membership_789',
    subjectId: 'user_123',
    organizationId: 'org_456',
    status: 'active',
    roles: ['member'],
    permissions: ['conversation.read'],
  });
  assert.equal(fakeClient.queries.length, 1);
  assert.deepEqual(fakeClient.queries[0]?.values, ['user_123', 'org_456']);
});

test('runtime shutdown closes a configured pool at most once', async () => {
  const fakeClient = new FakePostgresClient([]);
  const resolver = createRuntimeOrganizationMembershipResolver(
    { VSN_POSTGRES_URL: 'postgresql://vsn@db.example.com/vsn' },
    () => fakeClient,
  );

  await resolver.onApplicationShutdown();
  await resolver.onApplicationShutdown();
  assert.equal(fakeClient.closeCalls, 1);
});

test('invalid database config fails before pool creation', () => {
  let factoryCalls = 0;
  assert.throws(
    () => createRuntimeOrganizationMembershipResolver(
      {
        VSN_ENV: 'production',
        VSN_POSTGRES_URL: 'postgresql://vsn:secret@db.example.com/vsn',
        VSN_POSTGRES_SSL_MODE: 'disable',
      },
      () => {
        factoryCalls += 1;
        return new FakePostgresClient([]);
      },
    ),
  );
  assert.equal(factoryCalls, 0);
});

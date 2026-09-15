import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticatedPrincipal } from '../src/identity/authenticated-principal.js';
import {
  OrganizationMembershipDirectoryUnavailableError,
} from '../src/organizations/organization-membership-directory.js';
import type {
  ClosablePostgresQueryClient,
} from '../src/organizations/node-postgres-query-client.js';
import type {
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  createRuntimeOrganizationMembershipResolver,
} from '../src/organizations/runtime-organization-membership-resolver.js';
import {
  WorkspaceTeamPersistenceUnavailableError,
} from '../src/workspace/workspace-team-repository.js';

const principal: AuthenticatedPrincipal = {
  subjectId: 'user_123',
  sessionId: 'session_internal',
};

const persistedMembership = {
  membership_id: 'membership_001',
  subject_id: 'user_123',
  organization_id: 'org_001',
  status: 'active',
  roles: ['member'],
  permissions: ['conversation.read', 'team.read'],
} as const;

class SharedFakePostgresClient implements ClosablePostgresQueryClient {
  public closeCalls = 0;
  public readonly queries: Array<{
    text: string;
    values: readonly unknown[];
  }> = [];

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values: [...values] });
    return { rows: [persistedMembership as unknown as Row] };
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

test('configured runtime shares one PostgreSQL client across membership, directory and team reads', async () => {
  const client = new SharedFakePostgresClient();
  let factoryCalls = 0;
  const runtime = createRuntimeOrganizationMembershipResolver(
    { VSN_POSTGRES_URL: 'postgresql://vsn@db.example.com/vsn' },
    () => {
      factoryCalls += 1;
      return client;
    },
  );

  const membership = await runtime.resolve(principal, 'org_001');
  const directory = await runtime.listForPrincipal(principal);
  const team = await runtime.listByOrganization('org_001');

  assert.equal(factoryCalls, 1);
  assert.equal(membership?.organizationId, 'org_001');
  assert.equal(directory.memberships.length, 1);
  assert.equal(directory.memberships[0]?.organizationId, 'org_001');
  assert.equal(directory.hasMore, false);
  assert.equal(team.organization_id, 'org_001');
  assert.equal(team.members.length, 1);
  assert.equal(team.members[0]?.subject_id, 'user_123');
  assert.equal(team.has_more, false);
  assert.equal(client.queries.length, 3);
  assert.deepEqual(client.queries[0]?.values, ['user_123', 'org_001']);
  assert.deepEqual(client.queries[1]?.values, ['user_123', 101]);
  assert.deepEqual(client.queries[2]?.values, ['org_001', 201]);

  await Promise.all([
    runtime.onApplicationShutdown(),
    runtime.onApplicationShutdown(),
  ]);
  assert.equal(client.closeCalls, 1);
});

test('missing PostgreSQL configuration fails closed for all membership-backed access modes', async () => {
  let factoryCalls = 0;
  const runtime = createRuntimeOrganizationMembershipResolver({}, () => {
    factoryCalls += 1;
    return new SharedFakePostgresClient();
  });

  assert.equal(await runtime.resolve(principal, 'org_001'), null);
  await assert.rejects(
    () => runtime.listForPrincipal(principal),
    OrganizationMembershipDirectoryUnavailableError,
  );
  await assert.rejects(
    () => runtime.listByOrganization('org_001'),
    WorkspaceTeamPersistenceUnavailableError,
  );
  assert.equal(factoryCalls, 0);
  await runtime.onApplicationShutdown();
});

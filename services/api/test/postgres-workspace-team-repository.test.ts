import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  getWorkspaceTeamLookupSql,
  PostgresWorkspaceTeamRepository,
} from '../src/workspace/postgres-workspace-team-repository.js';
import {
  MAX_WORKSPACE_TEAM_MEMBERS,
  WorkspaceTeamDataIntegrityError,
} from '../src/workspace/workspace-team-repository.js';

class FakePostgresClient implements PostgresQueryClient {
  public readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  public constructor(
    private readonly rows: readonly unknown[],
    private readonly failure?: Error,
  ) {}

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return { rows: this.rows as readonly Row[] };
  }
}

function row(index = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    membership_id: `membership_${index.toString().padStart(3, '0')}`,
    subject_id: `user_${index.toString().padStart(3, '0')}`,
    organization_id: 'org_456',
    status: 'active',
    roles: ['member'],
    ...overrides,
  };
}

test('team listing is parameterized, deterministic and content bounded', async () => {
  const client = new FakePostgresClient([
    row(1),
    row(2, { status: 'invited', roles: ['admin', 'member'] }),
  ]);
  const repository = new PostgresWorkspaceTeamRepository(client);

  const result = await repository.listByOrganization(' org_456 ');

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]?.text, getWorkspaceTeamLookupSql());
  assert.deepEqual(client.calls[0]?.values, [
    'org_456',
    MAX_WORKSPACE_TEAM_MEMBERS + 1,
  ]);
  assert.match(client.calls[0]?.text ?? '', /WHERE organization_id = \$1/);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY membership_id ASC/);
  assert.match(client.calls[0]?.text ?? '', /LIMIT \$2/);
  assert.deepEqual(result, {
    schema_version: 1,
    organization_id: 'org_456',
    members: [
      {
        schema_version: 1,
        membership_id: 'membership_001',
        subject_id: 'user_001',
        status: 'active',
        roles: ['member'],
      },
      {
        schema_version: 1,
        membership_id: 'membership_002',
        subject_id: 'user_002',
        status: 'invited',
        roles: ['admin', 'member'],
      },
    ],
    has_more: false,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.members), true);
  assert.equal(Object.isFrozen(result.members[0]?.roles), true);
});

test('201st row only signals more data and never crosses the bounded surface', async () => {
  const rows = Array.from({ length: MAX_WORKSPACE_TEAM_MEMBERS + 1 }, (_, index) =>
    row(index + 1),
  );
  const result = await new PostgresWorkspaceTeamRepository(
    new FakePostgresClient(rows),
  ).listByOrganization('org_456');

  assert.equal(result.members.length, MAX_WORKSPACE_TEAM_MEMBERS);
  assert.equal(result.has_more, true);
  assert.equal(result.members.at(-1)?.membership_id, 'membership_200');
});

test('cross-tenant, malformed and duplicate rows fail closed', async () => {
  const cases = [
    [row(1, { organization_id: 'org_other' })],
    [row(1, { status: 'deleted' })],
    [row(1, { roles: [] })],
    [row(1, { roles: ['Member'] })],
    [row(1), row(2, { membership_id: 'membership_001' })],
    [row(1), row(2, { subject_id: 'user_001' })],
  ];

  for (const rows of cases) {
    const repository = new PostgresWorkspaceTeamRepository(
      new FakePostgresClient(rows),
    );
    await assert.rejects(
      () => repository.listByOrganization('org_456'),
      WorkspaceTeamDataIntegrityError,
    );
  }
});

test('invalid organization identifiers fail before database access', async () => {
  const client = new FakePostgresClient([row()]);
  const repository = new PostgresWorkspaceTeamRepository(client);

  await assert.rejects(() => repository.listByOrganization('   '), TypeError);
  await assert.rejects(
    () => repository.listByOrganization('x'.repeat(129)),
    TypeError,
  );
  assert.equal(client.calls.length, 0);
});

test('database failure propagates without fabricating an empty team', async () => {
  const failure = new Error('database unavailable');
  const repository = new PostgresWorkspaceTeamRepository(
    new FakePostgresClient([], failure),
  );

  await assert.rejects(
    () => repository.listByOrganization('org_456'),
    failure,
  );
});

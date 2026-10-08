import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  getOrdinaryTeamMemberPermissionAllowlist,
  getWorkspaceTeamMemberStatusUpdateSql,
  PostgresWorkspaceTeamMemberStatusRepository,
} from '../src/workspace/postgres-workspace-team-member-status-repository.js';
import { WorkspaceTeamMemberStatusDataIntegrityError } from '../src/workspace/workspace-team-member-status-repository.js';

class FakeClient implements PostgresQueryClient {
  public readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  public constructor(private readonly rows: readonly unknown[]) {}

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    return { rows: this.rows as readonly Row[] };
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: 'org_456',
    membership_id: 'membership_target',
    status: 'suspended',
    ...overrides,
  };
}

test('status mutation is one tenant-scoped conditional update with privilege fences', async () => {
  const client = new FakeClient([row()]);
  const repository = new PostgresWorkspaceTeamMemberStatusRepository(client);

  const result = await repository.changeOrdinaryMemberStatus(
    'manager_123',
    'org_456',
    'membership_target',
    'suspended',
  );

  assert.deepEqual(result, {
    schema_version: 1,
    organization_id: 'org_456',
    membership_id: 'membership_target',
    status: 'suspended',
  });
  assert.equal(client.calls[0]?.text, getWorkspaceTeamMemberStatusUpdateSql());
  assert.deepEqual(client.calls[0]?.values, [
    'org_456',
    'membership_target',
    'manager_123',
    'suspended',
    getOrdinaryTeamMemberPermissionAllowlist(),
  ]);
  assert.match(client.calls[0]?.text ?? '', /organization_id = \$1/);
  assert.match(client.calls[0]?.text ?? '', /membership_id = \$2/);
  assert.match(client.calls[0]?.text ?? '', /subject_id <> \$3/);
  assert.match(client.calls[0]?.text ?? '', /status IN \('active', 'suspended'\)/);
  assert.match(client.calls[0]?.text ?? '', /status <> \$4/);
  assert.match(client.calls[0]?.text ?? '', /roles = ARRAY\['member'\]::text\[\]/);
  assert.match(client.calls[0]?.text ?? '', /permissions <@ \$5::text\[\]/);
  assert.doesNotMatch(client.calls[0]?.text ?? '', /SET\s+roles|SET\s+permissions/i);
  assert.equal(JSON.stringify(result).includes('manager_123'), false);
});

test('zero rows safely represent self, privileged, invited, no-op or missing targets', async () => {
  const repository = new PostgresWorkspaceTeamMemberStatusRepository(
    new FakeClient([]),
  );

  assert.equal(
    await repository.changeOrdinaryMemberStatus(
      'manager_123',
      'org_456',
      'membership_target',
      'active',
    ),
    null,
  );
});

test('duplicate or cross-scope returned rows fail closed', async () => {
  const cases = [
    [row(), row()],
    [row({ organization_id: 'org_other' })],
    [row({ membership_id: 'membership_other' })],
    [row({ status: 'active' })],
    [row({ status: 'invited' })],
  ];

  for (const rows of cases) {
    const repository = new PostgresWorkspaceTeamMemberStatusRepository(
      new FakeClient(rows),
    );
    await assert.rejects(
      () =>
        repository.changeOrdinaryMemberStatus(
          'manager_123',
          'org_456',
          'membership_target',
          'suspended',
        ),
      WorkspaceTeamMemberStatusDataIntegrityError,
    );
  }
});

test('invalid identifiers fail before database access', async () => {
  for (const args of [
    [' manager_123', 'org_456', 'membership_target'] as const,
    ['manager_123', ' org_456', 'membership_target'] as const,
    ['manager_123', 'org_456', ' membership_target'] as const,
  ]) {
    const client = new FakeClient([row()]);
    const repository = new PostgresWorkspaceTeamMemberStatusRepository(client);
    await assert.rejects(
      () =>
        repository.changeOrdinaryMemberStatus(
          args[0],
          args[1],
          args[2],
          'suspended',
        ),
      TypeError,
    );
    assert.equal(client.calls.length, 0);
  }
});

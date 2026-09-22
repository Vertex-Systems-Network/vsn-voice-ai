import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  getWorkspaceOrganizationProfileSelectSql,
  getWorkspaceOrganizationProfileUpsertSql,
  PostgresWorkspaceOrganizationProfileRepository,
} from '../src/workspace/postgres-workspace-organization-profile-repository.js';
import { WorkspaceOrganizationProfileDataIntegrityError } from '../src/workspace/workspace-organization-profile-repository.js';

class FakePostgresClient implements PostgresQueryClient {
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
    display_name: 'Vertex Systems',
    ...overrides,
  };
}

test('organization profile lookup is exact tenant scoped and parameterized', async () => {
  const client = new FakePostgresClient([row()]);
  const repository = new PostgresWorkspaceOrganizationProfileRepository(client);

  const result = await repository.getOrganizationProfile('org_456');

  assert.equal(client.calls[0]?.text, getWorkspaceOrganizationProfileSelectSql());
  assert.deepEqual(client.calls[0]?.values, ['org_456']);
  assert.match(client.calls[0]?.text ?? '', /WHERE organization_id = \$1/);
  assert.match(client.calls[0]?.text ?? '', /LIMIT 2/);
  assert.deepEqual(result, { display_name: 'Vertex Systems' });
  assert.equal(Object.isFrozen(result), true);
});

test('missing row is valid but duplicate, cross-tenant and malformed data fail closed', async () => {
  const missing = new PostgresWorkspaceOrganizationProfileRepository(
    new FakePostgresClient([]),
  );
  assert.equal(await missing.getOrganizationProfile('org_456'), null);

  for (const rows of [
    [row(), row()],
    [row({ organization_id: 'org_other' })],
    [row({ display_name: ' bad' })],
    [row({ display_name: 'bad\nname' })],
    [row({ display_name: 'x'.repeat(101) })],
  ]) {
    const repository = new PostgresWorkspaceOrganizationProfileRepository(
      new FakePostgresClient(rows),
    );
    await assert.rejects(
      () => repository.getOrganizationProfile('org_456'),
      WorkspaceOrganizationProfileDataIntegrityError,
    );
  }
});

test('upsert changes only organization display profile fields', async () => {
  const client = new FakePostgresClient([
    row({ display_name: 'Vertex Systems Network' }),
  ]);
  const repository = new PostgresWorkspaceOrganizationProfileRepository(client);

  const result = await repository.putOrganizationProfile('org_456', {
    display_name: 'Vertex Systems Network',
  });

  assert.equal(client.calls[0]?.text, getWorkspaceOrganizationProfileUpsertSql());
  assert.deepEqual(client.calls[0]?.values, [
    'org_456',
    'Vertex Systems Network',
  ]);
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT \(organization_id\)/);
  assert.doesNotMatch(
    client.calls[0]?.text ?? '',
    /subject_id|session|roles|permissions/i,
  );
  assert.deepEqual(result, { display_name: 'Vertex Systems Network' });
});

test('invalid identifiers and display names fail before database access', async () => {
  for (const [organizationId, displayName] of [
    [' org_456', 'Valid'],
    ['org_456', ' bad'],
    ['org_456', 'bad\nname'],
    ['org_456', 'x'.repeat(101)],
  ] as const) {
    const client = new FakePostgresClient([row()]);
    const repository = new PostgresWorkspaceOrganizationProfileRepository(
      client,
    );
    await assert.rejects(
      () =>
        repository.putOrganizationProfile(organizationId, {
          display_name: displayName,
        }),
      TypeError,
    );
    assert.equal(client.calls.length, 0);
  }
});

test('migration keeps organization profile subject-free and bounded', async () => {
  const migration = await readFile(
    resolve(process.cwd(), 'migrations/0005_workspace_organizations.sql'),
    'utf8',
  );

  assert.match(migration, /organization_id text PRIMARY KEY/);
  assert.match(migration, /char_length\(display_name\) <= 100/);
  assert.match(migration, /\[\[:cntrl:\]\]/);
  assert.doesNotMatch(
    migration,
    /subject_id|session|password|secret|credential|permissions|roles/i,
  );
});

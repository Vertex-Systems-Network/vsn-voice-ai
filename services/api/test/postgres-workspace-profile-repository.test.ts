import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  getWorkspaceProfileSelectSql,
  getWorkspaceProfileUpsertSql,
  PostgresWorkspaceProfileRepository,
} from '../src/workspace/postgres-workspace-profile-repository.js';
import { WorkspaceProfileDataIntegrityError } from '../src/workspace/workspace-profile-repository.js';

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

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    subject_id: "user'o@example.com",
    organization_id: 'org_456',
    display_name: 'Ada Lovelace',
    job_title: 'Research Engineer',
    ...overrides,
  };
}

test('profile lookup is exact subject+tenant scoped and parameterized', async () => {
  const client = new FakePostgresClient([validRow()]);
  const repository = new PostgresWorkspaceProfileRepository(client);

  const value = await repository.getProfile("user'o@example.com", 'org_456');

  assert.deepEqual(client.calls[0]?.values, [
    'org_456',
    "user'o@example.com",
  ]);
  assert.equal(client.calls[0]?.text, getWorkspaceProfileSelectSql());
  assert.match(client.calls[0]?.text ?? '', /organization_id = \$1/);
  assert.match(client.calls[0]?.text ?? '', /subject_id = \$2/);
  assert.match(client.calls[0]?.text ?? '', /LIMIT 2/);
  assert.equal(client.calls[0]?.text.includes("user'o@example.com"), false);
  assert.deepEqual(value, {
    display_name: 'Ada Lovelace',
    job_title: 'Research Engineer',
  });
  assert.equal(Object.isFrozen(value), true);
});

test('missing row is valid but duplicate, cross-scope and malformed rows fail closed', async () => {
  const missing = new PostgresWorkspaceProfileRepository(
    new FakePostgresClient([]),
  );
  assert.equal(await missing.getProfile('user_123', 'org_456'), null);

  for (const rows of [
    [validRow(), validRow()],
    [validRow({ subject_id: 'user_other' })],
    [validRow({ organization_id: 'org_other' })],
    [validRow({ display_name: ' bad' })],
    [validRow({ job_title: 'bad\nvalue' })],
  ]) {
    const repository = new PostgresWorkspaceProfileRepository(
      new FakePostgresClient(rows),
    );
    await assert.rejects(
      () => repository.getProfile("user'o@example.com", 'org_456'),
      WorkspaceProfileDataIntegrityError,
    );
  }
});

test('upsert binds exact scope and closed profile values', async () => {
  const client = new FakePostgresClient([
    validRow({ display_name: 'Grace Hopper', job_title: 'Engineer' }),
  ]);
  const repository = new PostgresWorkspaceProfileRepository(client);
  const update = {
    display_name: 'Grace Hopper',
    job_title: 'Engineer',
  } as const;

  const value = await repository.putProfile(
    "user'o@example.com",
    'org_456',
    update,
  );

  assert.equal(client.calls[0]?.text, getWorkspaceProfileUpsertSql());
  assert.match(
    client.calls[0]?.text ?? '',
    /ON CONFLICT \(organization_id, subject_id\)/,
  );
  assert.deepEqual(client.calls[0]?.values, [
    'org_456',
    "user'o@example.com",
    'Grace Hopper',
    'Engineer',
  ]);
  assert.deepEqual(value, update);
});

test('invalid identifiers and profile values fail before persistence access', async () => {
  const client = new FakePostgresClient([validRow()]);
  const repository = new PostgresWorkspaceProfileRepository(client);

  await assert.rejects(
    () => repository.getProfile(' user_123', 'org_456'),
    TypeError,
  );
  await assert.rejects(
    () => repository.getProfile('user_123', ' org_456'),
    TypeError,
  );
  await assert.rejects(
    () =>
      repository.putProfile('user_123', 'org_456', {
        display_name: 'x'.repeat(81),
        job_title: '',
      }),
    TypeError,
  );
  assert.equal(client.calls.length, 0);
});

test('migration enforces subject+tenant uniqueness and browser-safe text constraints', async () => {
  const migration = await readFile(
    resolve(process.cwd(), 'migrations/0004_workspace_profiles.sql'),
    'utf8',
  );

  assert.match(migration, /PRIMARY KEY \(organization_id, subject_id\)/);
  assert.match(migration, /char_length\(display_name\) <= 80/);
  assert.match(migration, /char_length\(job_title\) <= 120/);
  assert.match(migration, /\[\[:cntrl:\]\]/);
  assert.doesNotMatch(migration, /password|secret|credential|session_id/i);
});

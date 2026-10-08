import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  getWorkspaceNotificationPreferencesSelectSql,
  getWorkspaceNotificationPreferencesUpsertSql,
  PostgresWorkspaceNotificationPreferencesRepository,
} from '../src/workspace/postgres-workspace-notification-preferences-repository.js';
import { WorkspaceNotificationPreferencesDataIntegrityError } from '../src/workspace/workspace-notification-preferences-repository.js';

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
    meeting_reminders: true,
    transcript_ready: false,
    action_items: true,
    desktop_link_events: false,
    ...overrides,
  };
}

test('preference lookup is exact subject+tenant scoped and parameterized', async () => {
  const client = new FakePostgresClient([validRow()]);
  const repository = new PostgresWorkspaceNotificationPreferencesRepository(
    client,
  );

  const value = await repository.get("user'o@example.com", 'org_456');

  assert.deepEqual(client.calls[0]?.values, [
    'org_456',
    "user'o@example.com",
  ]);
  assert.equal(
    client.calls[0]?.text,
    getWorkspaceNotificationPreferencesSelectSql(),
  );
  assert.match(client.calls[0]?.text ?? '', /organization_id = \$1/);
  assert.match(client.calls[0]?.text ?? '', /subject_id = \$2/);
  assert.match(client.calls[0]?.text ?? '', /LIMIT 2/);
  assert.equal(
    client.calls[0]?.text.includes("user'o@example.com"),
    false,
  );
  assert.deepEqual(value, {
    meeting_reminders: true,
    transcript_ready: false,
    action_items: true,
    desktop_link_events: false,
  });
  assert.equal(Object.isFrozen(value), true);
});

test('missing row is valid but duplicate, cross-scope and malformed rows fail closed', async () => {
  const missing = new PostgresWorkspaceNotificationPreferencesRepository(
    new FakePostgresClient([]),
  );
  assert.equal(await missing.get('user_123', 'org_456'), null);

  for (const rows of [
    [validRow(), validRow()],
    [validRow({ subject_id: 'user_other' })],
    [validRow({ organization_id: 'org_other' })],
    [validRow({ meeting_reminders: 'yes' })],
  ]) {
    const repository = new PostgresWorkspaceNotificationPreferencesRepository(
      new FakePostgresClient(rows),
    );
    await assert.rejects(
      () => repository.get("user'o@example.com", 'org_456'),
      WorkspaceNotificationPreferencesDataIntegrityError,
    );
  }
});

test('upsert binds exact scope and all boolean values', async () => {
  const client = new FakePostgresClient([
    validRow({
      meeting_reminders: false,
      transcript_ready: true,
      action_items: false,
      desktop_link_events: true,
    }),
  ]);
  const repository = new PostgresWorkspaceNotificationPreferencesRepository(
    client,
  );
  const update = {
    meeting_reminders: false,
    transcript_ready: true,
    action_items: false,
    desktop_link_events: true,
  } as const;

  const value = await repository.put(
    "user'o@example.com",
    'org_456',
    update,
  );

  assert.equal(
    client.calls[0]?.text,
    getWorkspaceNotificationPreferencesUpsertSql(),
  );
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT \(organization_id, subject_id\)/);
  assert.deepEqual(client.calls[0]?.values, [
    'org_456',
    "user'o@example.com",
    false,
    true,
    false,
    true,
  ]);
  assert.deepEqual(value, update);
});

test('invalid identifiers fail before persistence access', async () => {
  const client = new FakePostgresClient([validRow()]);
  const repository = new PostgresWorkspaceNotificationPreferencesRepository(
    client,
  );

  await assert.rejects(() => repository.get(' user_123', 'org_456'), TypeError);
  await assert.rejects(() => repository.get('user_123', ' org_456'), TypeError);
  await assert.rejects(
    () => repository.get('x'.repeat(129), 'org_456'),
    TypeError,
  );
  assert.equal(client.calls.length, 0);
});

test('migration enforces subject+tenant uniqueness and contains no secret fields', async () => {
  const migration = await readFile(
    resolve(process.cwd(), 'migrations/0003_workspace_notification_preferences.sql'),
    'utf8',
  );

  assert.match(migration, /PRIMARY KEY \(organization_id, subject_id\)/);
  assert.match(migration, /char_length\(organization_id\) BETWEEN 1 AND 128/);
  assert.match(migration, /char_length\(subject_id\) BETWEEN 1 AND 128/);
  assert.match(migration, /meeting_reminders boolean NOT NULL DEFAULT true/);
  assert.doesNotMatch(migration, /password|secret|credential|session_id/i);
});

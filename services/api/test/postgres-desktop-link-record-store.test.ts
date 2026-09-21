import assert from 'node:assert/strict';
import test from 'node:test';

import type { DesktopLinkRecord } from '../src/device-link/desktop-link-record.js';
import {
  getDesktopLinkPersistenceSql,
  PostgresDesktopLinkRecordStore,
} from '../src/device-link/postgres-desktop-link-record-store.js';
import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from '../src/organizations/postgres-organization-membership-resolver.js';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeQueryClient implements PostgresQueryClient {
  public readonly calls: QueryCall[] = [];
  private readonly responses: readonly (readonly unknown[])[];
  private responseIndex = 0;

  public constructor(responses: readonly (readonly unknown[])[] = []) {
    this.responses = responses;
  }

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    const rows = this.responses[this.responseIndex] ?? [];
    this.responseIndex += 1;
    return { rows: rows as unknown as readonly Row[] };
  }
}

const issuedRecord: DesktopLinkRecord = {
  schema_version: 1,
  record_id: 'record_123',
  token_digest: 'a'.repeat(64),
  subject_id: 'user_123',
  organization_id: 'org_456',
  device_id: 'device_789',
  issued_at: '2026-09-15T00:00:00.000Z',
  expires_at: '2026-09-15T00:05:00.000Z',
  status: 'issued',
};

function postgresRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_id: issuedRecord.record_id,
    token_digest: issuedRecord.token_digest,
    subject_id: issuedRecord.subject_id,
    organization_id: issuedRecord.organization_id,
    device_id: issuedRecord.device_id,
    issued_at: new Date(issuedRecord.issued_at),
    expires_at: new Date(issuedRecord.expires_at),
    status: issuedRecord.status,
    consumed_at: null,
    ...overrides,
  };
}

test('put persists only the digest-bearing issued record contract', async () => {
  const client = new FakeQueryClient();
  const store = new PostgresDesktopLinkRecordStore(client);

  await store.put(issuedRecord);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]?.text, getDesktopLinkPersistenceSql().insert);
  assert.deepEqual(client.calls[0]?.values, [
    'record_123',
    'a'.repeat(64),
    'user_123',
    'org_456',
    'device_789',
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:05:00.000Z',
    'issued',
    null,
  ]);
});

test('put rejects malformed or already-consumed records before querying', async () => {
  const client = new FakeQueryClient();
  const store = new PostgresDesktopLinkRecordStore(client);

  await assert.rejects(
    () => store.put({ ...issuedRecord, token_digest: 'not-a-sha256-digest' }),
    TypeError,
  );
  await assert.rejects(
    () => store.put({
      ...issuedRecord,
      status: 'consumed',
      consumed_at: '2026-09-15T00:01:00.000Z',
    }),
    TypeError,
  );
  assert.equal(client.calls.length, 0);
});

test('get maps PostgreSQL timestamps to the persisted JSON contract', async () => {
  const client = new FakeQueryClient([[postgresRow()]]);
  const store = new PostgresDesktopLinkRecordStore(client);

  const record = await store.get('record_123');

  assert.deepEqual(record, issuedRecord);
  assert.equal(client.calls[0]?.text, getDesktopLinkPersistenceSql().get);
  assert.deepEqual(client.calls[0]?.values, ['record_123']);
});

test('get fails closed on missing, duplicate or malformed rows', async () => {
  const missing = new PostgresDesktopLinkRecordStore(new FakeQueryClient([[]]));
  assert.equal(await missing.get('record_123'), undefined);

  const duplicate = new PostgresDesktopLinkRecordStore(
    new FakeQueryClient([[postgresRow(), postgresRow()]]),
  );
  assert.equal(await duplicate.get('record_123'), undefined);

  const malformed = new PostgresDesktopLinkRecordStore(
    new FakeQueryClient([[postgresRow({ token_digest: 'bad' })]]),
  );
  assert.equal(await malformed.get('record_123'), undefined);
});

test('consume is atomic, issued-only and expiry-aware', async () => {
  const consumedAt = '2026-09-15T00:01:00.000Z';
  const client = new FakeQueryClient([[
    postgresRow({
      status: 'consumed',
      consumed_at: new Date(consumedAt),
    }),
  ]]);
  const store = new PostgresDesktopLinkRecordStore(client);

  const record = await store.consumeIfIssued(
    'record_123',
    'a'.repeat(64),
    consumedAt,
  );

  assert.equal(record?.status, 'consumed');
  assert.equal(record?.consumed_at, consumedAt);
  assert.equal(client.calls[0]?.text, getDesktopLinkPersistenceSql().consume);
  assert.deepEqual(client.calls[0]?.values, [
    'record_123',
    'a'.repeat(64),
    consumedAt,
  ]);
  assert.match(client.calls[0]?.text ?? '', /status = 'issued'/);
  assert.match(client.calls[0]?.text ?? '', /expires_at > \$3/);
});

test('consume rejects malformed inputs without touching PostgreSQL', async () => {
  const client = new FakeQueryClient();
  const store = new PostgresDesktopLinkRecordStore(client);

  assert.equal(
    await store.consumeIfIssued('', 'a'.repeat(64), '2026-09-15T00:01:00.000Z'),
    undefined,
  );
  assert.equal(
    await store.consumeIfIssued('record_123', 'bad', '2026-09-15T00:01:00.000Z'),
    undefined,
  );
  assert.equal(
    await store.consumeIfIssued('record_123', 'a'.repeat(64), 'not-a-time'),
    undefined,
  );
  assert.equal(client.calls.length, 0);
});

test('revoke is atomic, tenant-bound and issued-only', async () => {
  const revokedAt = '2026-09-15T00:01:00.000Z';
  const client = new FakeQueryClient([[
    postgresRow({
      status: 'revoked',
      consumed_at: null,
    }),
  ]]);
  const store = new PostgresDesktopLinkRecordStore(client);

  const record = await store.revokeIfIssued(
    'record_123',
    'user_123',
    'org_456',
    revokedAt,
  );

  assert.equal(record?.status, 'revoked');
  assert.equal(record?.consumed_at, undefined);
  assert.equal(client.calls[0]?.text, getDesktopLinkPersistenceSql().revoke);
  assert.deepEqual(client.calls[0]?.values, [
    'record_123',
    'user_123',
    'org_456',
    revokedAt,
  ]);
  assert.match(client.calls[0]?.text ?? '', /status = 'issued'/);
  assert.match(client.calls[0]?.text ?? '', /subject_id = \$2/);
  assert.match(client.calls[0]?.text ?? '', /organization_id = \$3/);
  assert.match(client.calls[0]?.text ?? '', /expires_at > \$4/);
});

test('revoke rejects malformed inputs without touching PostgreSQL', async () => {
  const client = new FakeQueryClient();
  const store = new PostgresDesktopLinkRecordStore(client);

  assert.equal(
    await store.revokeIfIssued('', 'user_123', 'org_456', '2026-09-15T00:01:00.000Z'),
    undefined,
  );
  assert.equal(
    await store.revokeIfIssued('record_123', '', 'org_456', '2026-09-15T00:01:00.000Z'),
    undefined,
  );
  assert.equal(
    await store.revokeIfIssued('record_123', 'user_123', '', '2026-09-15T00:01:00.000Z'),
    undefined,
  );
  assert.equal(
    await store.revokeIfIssued('record_123', 'user_123', 'org_456', 'not-a-time'),
    undefined,
  );
  assert.equal(client.calls.length, 0);
});

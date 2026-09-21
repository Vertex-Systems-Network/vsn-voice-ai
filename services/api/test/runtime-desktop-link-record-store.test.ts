import assert from 'node:assert/strict';
import test from 'node:test';

import type { DesktopLinkRecord } from '../src/device-link/desktop-link-record.js';
import {
  createRuntimeDesktopLinkRecordStore,
  DesktopLinkPersistenceUnavailableError,
} from '../src/device-link/runtime-desktop-link-record-store.js';
import type { ClosablePostgresQueryClient } from '../src/organizations/node-postgres-query-client.js';
import type { PostgresQueryResult } from '../src/organizations/postgres-organization-membership-resolver.js';

class FakePostgresClient implements ClosablePostgresQueryClient {
  public closeCalls = 0;
  public readonly queries: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  public constructor(private readonly rows: readonly unknown[] = []) {}

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

test('missing database config keeps desktop-link persistence fail-closed without creating a pool', async () => {
  let factoryCalls = 0;
  const store = createRuntimeDesktopLinkRecordStore(
    { VSN_ENV: 'production' },
    () => {
      factoryCalls += 1;
      return new FakePostgresClient();
    },
  );

  await assert.rejects(() => store.put(issuedRecord), DesktopLinkPersistenceUnavailableError);
  await assert.rejects(() => store.get('record_123'), DesktopLinkPersistenceUnavailableError);
  await assert.rejects(
    () => store.consumeIfIssued(
      'record_123',
      issuedRecord.token_digest,
      '2026-09-15T00:01:00.000Z',
    ),
    DesktopLinkPersistenceUnavailableError,
  );
  await assert.rejects(
    () => store.revokeIfIssued(
      'record_123',
      'user_123',
      'org_456',
      '2026-09-15T00:01:00.000Z',
    ),
    DesktopLinkPersistenceUnavailableError,
  );
  assert.equal(factoryCalls, 0);
  await store.onApplicationShutdown();
});

test('configured runtime creates PostgreSQL store with bounded runtime config', async () => {
  const fakeClient = new FakePostgresClient();
  let capturedConfig: unknown;
  const store = createRuntimeDesktopLinkRecordStore(
    {
      VSN_ENV: 'production',
      VSN_POSTGRES_URL: 'postgresql://vsn:secret@db.example.com/vsn',
      VSN_POSTGRES_MAX_CONNECTIONS: '3',
      VSN_POSTGRES_CONNECT_TIMEOUT_MS: '1200',
      VSN_POSTGRES_IDLE_TIMEOUT_MS: '6000',
    },
    (config) => {
      capturedConfig = config;
      return fakeClient;
    },
  );

  assert.deepEqual(capturedConfig, {
    connectionString: 'postgresql://vsn:secret@db.example.com/vsn',
    sslMode: 'require',
    maxConnections: 3,
    connectionTimeoutMs: 1_200,
    idleTimeoutMs: 6_000,
  });

  await store.put(issuedRecord);
  assert.equal(fakeClient.queries.length, 1);
  assert.match(fakeClient.queries[0]?.text ?? '', /INSERT INTO desktop_link_records/);
  assert.equal(fakeClient.queries[0]?.values[1], issuedRecord.token_digest);
});

test('runtime shutdown closes configured desktop-link pool at most once', async () => {
  const fakeClient = new FakePostgresClient();
  const store = createRuntimeDesktopLinkRecordStore(
    { VSN_POSTGRES_URL: 'postgresql://vsn@db.example.com/vsn' },
    () => fakeClient,
  );

  await store.onApplicationShutdown();
  await store.onApplicationShutdown();
  assert.equal(fakeClient.closeCalls, 1);
});

test('invalid database config fails before desktop-link pool creation', () => {
  let factoryCalls = 0;
  assert.throws(() => createRuntimeDesktopLinkRecordStore(
    {
      VSN_ENV: 'production',
      VSN_POSTGRES_URL: 'postgresql://vsn:secret@db.example.com/vsn',
      VSN_POSTGRES_SSL_MODE: 'disable',
    },
    () => {
      factoryCalls += 1;
      return new FakePostgresClient();
    },
  ));
  assert.equal(factoryCalls, 0);
});


test('configured runtime normalizes delegate failures to persistence unavailable', async () => {
  class ThrowingPostgresClient extends FakePostgresClient {
    public override async query<Row>(
      _text: string,
      _values: readonly unknown[],
    ): Promise<PostgresQueryResult<Row>> {
      throw new Error('sensitive database transport detail');
    }
  }

  const store = createRuntimeDesktopLinkRecordStore(
    { VSN_POSTGRES_URL: 'postgresql://vsn@db.example.com/vsn' },
    () => new ThrowingPostgresClient(),
  );

  await assert.rejects(() => store.put(issuedRecord), DesktopLinkPersistenceUnavailableError);
  await assert.rejects(() => store.get('record_123'), DesktopLinkPersistenceUnavailableError);
  await assert.rejects(
    () => store.revokeIfIssued(
      'record_123',
      'user_123',
      'org_456',
      '2026-09-15T00:01:00.000Z',
    ),
    DesktopLinkPersistenceUnavailableError,
  );
});

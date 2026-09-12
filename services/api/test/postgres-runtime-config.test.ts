import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOptionalPostgresRuntimeConfig } from '../src/config/postgres-runtime-config.js';

function expectConfigError(
  env: Readonly<Record<string, string | undefined>>,
  secretFragment?: string,
): void {
  assert.throws(
    () => loadOptionalPostgresRuntimeConfig(env),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      if (!(error instanceof Error)) {
        return false;
      }
      if (secretFragment !== undefined) {
        assert.equal(error.message.includes(secretFragment), false);
      }
      return true;
    },
  );
}

test('missing PostgreSQL URL keeps runtime persistence disabled', () => {
  assert.equal(loadOptionalPostgresRuntimeConfig({ VSN_ENV: 'production' }), null);
  assert.equal(loadOptionalPostgresRuntimeConfig({ VSN_POSTGRES_URL: '   ' }), null);
});

test('production PostgreSQL config defaults to required TLS and bounded pool values', () => {
  const config = loadOptionalPostgresRuntimeConfig({
    VSN_ENV: 'production',
    VSN_POSTGRES_URL: 'postgresql://vsn:super-secret@example.com/vsn',
  });

  assert.deepEqual(config, {
    connectionString: 'postgresql://vsn:super-secret@example.com/vsn',
    sslMode: 'require',
    maxConnections: 10,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
  });
  assert.equal(Object.isFrozen(config), true);
});

test('non-production PostgreSQL config may explicitly disable TLS', () => {
  const config = loadOptionalPostgresRuntimeConfig({
    VSN_ENV: 'test',
    VSN_POSTGRES_URL: 'postgres://vsn@db.example.com/testdb',
    VSN_POSTGRES_SSL_MODE: 'disable',
    VSN_POSTGRES_MAX_CONNECTIONS: '3',
    VSN_POSTGRES_CONNECT_TIMEOUT_MS: '750',
    VSN_POSTGRES_IDLE_TIMEOUT_MS: '5000',
  });

  assert.equal(config?.sslMode, 'disable');
  assert.equal(config?.maxConnections, 3);
  assert.equal(config?.connectionTimeoutMs, 750);
  assert.equal(config?.idleTimeoutMs, 5_000);
});

test('production cannot disable PostgreSQL TLS', () => {
  expectConfigError({
    VSN_ENV: 'production',
    VSN_POSTGRES_URL: 'postgresql://vsn:secret@example.com/vsn',
    VSN_POSTGRES_SSL_MODE: 'disable',
  });
});

test('PostgreSQL URL validation rejects unsafe or ambiguous connection strings without echoing secrets', () => {
  const cases = [
    'https://vsn:do-not-echo@example.com/vsn',
    'postgresql://vsn:do-not-echo@example.com',
    'postgresql://vsn:do-not-echo@example.com/vsn?sslmode=disable',
    'postgresql://vsn:do-not-echo@example.com/vsn#fragment',
    'not-a-url-do-not-echo',
  ];

  for (const connectionString of cases) {
    expectConfigError(
      { VSN_POSTGRES_URL: connectionString },
      'do-not-echo',
    );
  }
});

test('PostgreSQL pool and timeout bounds fail closed', () => {
  const base = { VSN_POSTGRES_URL: 'postgresql://vsn@example.com/vsn' };
  for (const env of [
    { ...base, VSN_POSTGRES_MAX_CONNECTIONS: '0' },
    { ...base, VSN_POSTGRES_MAX_CONNECTIONS: '33' },
    { ...base, VSN_POSTGRES_CONNECT_TIMEOUT_MS: '249' },
    { ...base, VSN_POSTGRES_CONNECT_TIMEOUT_MS: '15001' },
    { ...base, VSN_POSTGRES_IDLE_TIMEOUT_MS: '999' },
    { ...base, VSN_POSTGRES_IDLE_TIMEOUT_MS: '120001' },
    { ...base, VSN_POSTGRES_MAX_CONNECTIONS: '1.5' },
  ]) {
    expectConfigError(env);
  }
});

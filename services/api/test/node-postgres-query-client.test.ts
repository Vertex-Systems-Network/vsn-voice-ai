import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostgresRuntimeConfig } from '../src/config/postgres-runtime-config.js';
import { createNodePostgresPoolOptions } from '../src/organizations/node-postgres-query-client.js';

function baseConfig(): PostgresRuntimeConfig {
  return {
    connectionString: 'postgresql://vsn:secret@db.example.com/vsn',
    sslMode: 'require',
    maxConnections: 6,
    connectionTimeoutMs: 1_500,
    idleTimeoutMs: 20_000,
  };
}

test('node-postgres pool options preserve bounded runtime settings and require certificate verification', () => {
  const options = createNodePostgresPoolOptions(baseConfig());

  assert.equal(options.connectionString, 'postgresql://vsn:secret@db.example.com/vsn');
  assert.equal(options.max, 6);
  assert.equal(options.connectionTimeoutMillis, 1_500);
  assert.equal(options.idleTimeoutMillis, 20_000);
  assert.equal(options.allowExitOnIdle, false);
  assert.equal(options.application_name, 'vsn-api-membership');
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
});

test('node-postgres TLS can be disabled only when the already-validated runtime config allows it', () => {
  const options = createNodePostgresPoolOptions({
    ...baseConfig(),
    sslMode: 'disable',
  });

  assert.equal(options.ssl, false);
});

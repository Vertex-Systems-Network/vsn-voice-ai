import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostgresRuntimeConfig } from '../src/config/postgres-runtime-config.js';
import type { ClosablePostgresQueryClient } from '../src/organizations/node-postgres-query-client.js';
import type { PostgresQueryResult } from '../src/organizations/postgres-organization-membership-resolver.js';
import {
  createRuntimeWorkspaceTeamRepository,
  type WorkspaceTeamPostgresClientFactory,
} from '../src/workspace/runtime-workspace-team-repository.js';
import { WorkspaceTeamPersistenceUnavailableError } from '../src/workspace/workspace-team-repository.js';

class FakeClosableClient implements ClosablePostgresQueryClient {
  public closeCalls = 0;
  public readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  public constructor(private readonly rows: readonly unknown[]) {}

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    return { rows: this.rows as readonly Row[] };
  }

  public async close(): Promise<void> {
    this.closeCalls++;
  }
}

function configuredEnv(): Record<string, string> {
  return {
    VSN_POSTGRES_HOST: 'db.internal',
    VSN_POSTGRES_PORT: '5432',
    VSN_POSTGRES_DATABASE: 'vsn',
    VSN_POSTGRES_USER: 'vsn_api',
    VSN_POSTGRES_PASSWORD: 'test-only-password',
    VSN_POSTGRES_SSL_MODE: 'require',
  };
}

function teamRow(): Record<string, unknown> {
  return {
    membership_id: 'membership_123',
    subject_id: 'user_123',
    organization_id: 'org_456',
    status: 'active',
    roles: ['member'],
  };
}

test('runtime team repository remains fail-closed without PostgreSQL configuration', async () => {
  const repository = createRuntimeWorkspaceTeamRepository({});

  await assert.rejects(
    () => repository.listByOrganization('org_456'),
    WorkspaceTeamPersistenceUnavailableError,
  );
  await repository.onApplicationShutdown();
});

test('configured runtime repository delegates to PostgreSQL and owns client lifecycle', async () => {
  const client = new FakeClosableClient([teamRow()]);
  const capturedConfigs: PostgresRuntimeConfig[] = [];
  const factory: WorkspaceTeamPostgresClientFactory = (config) => {
    capturedConfigs.push(config);
    return client;
  };
  const repository = createRuntimeWorkspaceTeamRepository(
    configuredEnv(),
    factory,
  );

  const result = await repository.listByOrganization('org_456');

  assert.equal(capturedConfigs.length, 1);
  assert.equal(capturedConfigs[0]?.host, 'db.internal');
  assert.equal(capturedConfigs[0]?.database, 'vsn');
  assert.equal(result.organization_id, 'org_456');
  assert.equal(result.members.length, 1);
  assert.equal(client.calls.length, 1);

  await Promise.all([
    repository.onApplicationShutdown(),
    repository.onApplicationShutdown(),
  ]);
  assert.equal(client.closeCalls, 1);
});

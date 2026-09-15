import type { OnApplicationShutdown } from '@nestjs/common';

import type { PostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import { loadOptionalPostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import type { ClosablePostgresQueryClient } from '../organizations/node-postgres-query-client.js';
import { NodePostgresQueryClient } from '../organizations/node-postgres-query-client.js';
import { PostgresWorkspaceTeamRepository } from './postgres-workspace-team-repository.js';
import {
  RejectingWorkspaceTeamRepository,
  type WorkspaceTeamRepository,
  type WorkspaceTeamSnapshot,
} from './workspace-team-repository.js';

export type WorkspaceTeamPostgresClientFactory = (
  config: PostgresRuntimeConfig,
) => ClosablePostgresQueryClient;

function defaultWorkspaceTeamPostgresClientFactory(
  config: PostgresRuntimeConfig,
): ClosablePostgresQueryClient {
  return new NodePostgresQueryClient(config);
}

export class RuntimeWorkspaceTeamRepository
  implements WorkspaceTeamRepository, OnApplicationShutdown
{
  private closePromise: Promise<void> | null = null;

  public constructor(
    private readonly delegate: WorkspaceTeamRepository,
    private readonly closeClient: (() => Promise<void>) | null,
  ) {}

  public listByOrganization(organizationId: string): Promise<WorkspaceTeamSnapshot> {
    return this.delegate.listByOrganization(organizationId);
  }

  public onApplicationShutdown(): Promise<void> {
    if (this.closeClient === null) {
      return Promise.resolve();
    }
    if (this.closePromise === null) {
      this.closePromise = this.closeClient();
    }
    return this.closePromise;
  }
}

/**
 * Keeps the team route fail-closed when PostgreSQL is not configured. A
 * configured repository owns its pool lifecycle and never falls back to an
 * empty/fabricated team on database failure.
 */
export function createRuntimeWorkspaceTeamRepository(
  env: Readonly<Record<string, string | undefined>>,
  createClient: WorkspaceTeamPostgresClientFactory =
    defaultWorkspaceTeamPostgresClientFactory,
): RuntimeWorkspaceTeamRepository {
  const config = loadOptionalPostgresRuntimeConfig(env);
  if (config === null) {
    return new RuntimeWorkspaceTeamRepository(
      new RejectingWorkspaceTeamRepository(),
      null,
    );
  }

  const client = createClient(config);
  return new RuntimeWorkspaceTeamRepository(
    new PostgresWorkspaceTeamRepository(client),
    () => client.close(),
  );
}

import type { OnApplicationShutdown } from '@nestjs/common';

import type { PostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import { loadOptionalPostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import { PostgresWorkspaceTeamRepository } from '../workspace/postgres-workspace-team-repository.js';
import {
  RejectingWorkspaceTeamRepository,
  type WorkspaceTeamRepository,
  type WorkspaceTeamSnapshot,
} from '../workspace/workspace-team-repository.js';
import {
  type OrganizationMembershipDirectory,
  type OrganizationMembershipDirectorySnapshot,
  RejectingOrganizationMembershipDirectory,
} from './organization-membership-directory.js';
import type { OrganizationMembership } from './organization-membership.js';
import type { OrganizationMembershipResolver } from './organization-membership-resolver.js';
import { RejectingOrganizationMembershipResolver } from './organization-membership-resolver.js';
import type { ClosablePostgresQueryClient } from './node-postgres-query-client.js';
import { NodePostgresQueryClient } from './node-postgres-query-client.js';
import { PostgresOrganizationMembershipResolver } from './postgres-organization-membership-resolver.js';

export type PostgresQueryClientFactory = (
  config: PostgresRuntimeConfig,
) => ClosablePostgresQueryClient;

function defaultPostgresQueryClientFactory(
  config: PostgresRuntimeConfig,
): ClosablePostgresQueryClient {
  return new NodePostgresQueryClient(config);
}

/**
 * Runtime membership service that stays fail-closed when no database is
 * configured, shares one PostgreSQL pool across exact membership resolution,
 * subject-bound directory reads and tenant team reads, and owns that pool
 * lifecycle.
 */
export class RuntimeOrganizationMembershipResolver
  implements
    OrganizationMembershipResolver,
    OrganizationMembershipDirectory,
    WorkspaceTeamRepository,
    OnApplicationShutdown
{
  private closePromise: Promise<void> | null = null;

  public constructor(
    private readonly resolverDelegate: OrganizationMembershipResolver,
    private readonly directoryDelegate: OrganizationMembershipDirectory,
    private readonly teamDelegate: WorkspaceTeamRepository,
    private readonly closeClient: (() => Promise<void>) | null,
  ) {}

  public resolve(
    principal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    return this.resolverDelegate.resolve(principal, organizationId);
  }

  public listForPrincipal(
    principal: AuthenticatedPrincipal,
  ): Promise<OrganizationMembershipDirectorySnapshot> {
    return this.directoryDelegate.listForPrincipal(principal);
  }

  public listByOrganization(
    organizationId: string,
  ): Promise<WorkspaceTeamSnapshot> {
    return this.teamDelegate.listByOrganization(organizationId);
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

export function createRuntimeOrganizationMembershipResolver(
  env: Readonly<Record<string, string | undefined>>,
  createClient: PostgresQueryClientFactory = defaultPostgresQueryClientFactory,
): RuntimeOrganizationMembershipResolver {
  const config = loadOptionalPostgresRuntimeConfig(env);
  if (config === null) {
    return new RuntimeOrganizationMembershipResolver(
      new RejectingOrganizationMembershipResolver(),
      new RejectingOrganizationMembershipDirectory(),
      new RejectingWorkspaceTeamRepository(),
      null,
    );
  }

  const client = createClient(config);
  const postgresMemberships = new PostgresOrganizationMembershipResolver(client);
  return new RuntimeOrganizationMembershipResolver(
    postgresMemberships,
    postgresMemberships,
    new PostgresWorkspaceTeamRepository(client),
    () => client.close(),
  );
}

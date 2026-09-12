import type { OnApplicationShutdown } from '@nestjs/common';

import type { PostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import { loadOptionalPostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
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
 * Runtime resolver that stays fail-closed when no database is configured and
 * owns the lifecycle of a configured PostgreSQL pool.
 */
export class RuntimeOrganizationMembershipResolver
  implements OrganizationMembershipResolver, OnApplicationShutdown
{
  private closePromise: Promise<void> | null = null;

  public constructor(
    private readonly delegate: OrganizationMembershipResolver,
    private readonly closeClient: (() => Promise<void>) | null,
  ) {}

  public resolve(
    principal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    return this.delegate.resolve(principal, organizationId);
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
      null,
    );
  }

  const client = createClient(config);
  return new RuntimeOrganizationMembershipResolver(
    new PostgresOrganizationMembershipResolver(client),
    () => client.close(),
  );
}

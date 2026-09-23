import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { OrganizationMembership } from './organization-membership.js';

export const ORGANIZATION_MEMBERSHIP_DIRECTORY = Symbol(
  'ORGANIZATION_MEMBERSHIP_DIRECTORY',
);
export const MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY = 100;

export interface OrganizationMembershipDirectoryEntry
  extends OrganizationMembership {
  readonly organizationDisplayName: string | null;
}

export interface OrganizationMembershipDirectorySnapshot {
  readonly memberships: readonly OrganizationMembershipDirectoryEntry[];
  readonly hasMore: boolean;
}

export interface OrganizationMembershipDirectory {
  listForPrincipal(
    principal: AuthenticatedPrincipal,
  ): Promise<OrganizationMembershipDirectorySnapshot>;
}

export class OrganizationMembershipDirectoryDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OrganizationMembershipDirectoryDataIntegrityError';
  }
}

export class OrganizationMembershipDirectoryUnavailableError extends Error {
  public constructor() {
    super('organization membership directory is unavailable');
    this.name = 'OrganizationMembershipDirectoryUnavailableError';
  }
}

export class RejectingOrganizationMembershipDirectory
  implements OrganizationMembershipDirectory
{
  public async listForPrincipal(
    _principal: AuthenticatedPrincipal,
  ): Promise<OrganizationMembershipDirectorySnapshot> {
    throw new OrganizationMembershipDirectoryUnavailableError();
  }
}

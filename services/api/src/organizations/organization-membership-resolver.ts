import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { OrganizationMembership } from './organization-membership.js';

export const ORGANIZATION_MEMBERSHIP_RESOLVER = Symbol(
  'ORGANIZATION_MEMBERSHIP_RESOLVER',
);

/**
 * Persistence boundary for resolving the authenticated subject's membership in
 * the requested organization. Implementations must return only memberships
 * whose subject/organization identifiers come from trusted storage.
 */
export interface OrganizationMembershipResolver {
  resolve(
    principal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<OrganizationMembership | null>;
}

/**
 * Safe default until a verified tenant-membership repository is attached.
 */
export class RejectingOrganizationMembershipResolver
  implements OrganizationMembershipResolver
{
  public async resolve(
    _principal: AuthenticatedPrincipal,
    _organizationId: string,
  ): Promise<null> {
    return null;
  }
}

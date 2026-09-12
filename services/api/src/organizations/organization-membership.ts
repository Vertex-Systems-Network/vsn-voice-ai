export type MembershipStatus = 'active' | 'invited' | 'suspended';

export interface OrganizationMembership {
  readonly membershipId: string;
  readonly subjectId: string;
  readonly organizationId: string;
  readonly status: MembershipStatus;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface TenantResource {
  readonly organizationId: string;
}

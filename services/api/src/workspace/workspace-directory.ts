import {
  MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY,
  type OrganizationMembershipDirectorySnapshot,
} from '../organizations/organization-membership-directory.js';
import type { MembershipStatus } from '../organizations/organization-membership.js';

export interface WorkspaceDirectoryEntry {
  readonly schema_version: 1;
  readonly membership_id: string;
  readonly organization_id: string;
  readonly display_name: string | null;
  readonly status: MembershipStatus;
  readonly roles: readonly string[];
}

export interface WorkspaceDirectoryResponse {
  readonly schema_version: 1;
  readonly workspaces: readonly WorkspaceDirectoryEntry[];
  readonly has_more: boolean;
}

export function buildWorkspaceDirectoryResponse(
  snapshot: OrganizationMembershipDirectorySnapshot,
): WorkspaceDirectoryResponse {
  if (
    snapshot.memberships.length >
    MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY
  ) {
    throw new WorkspaceDirectoryDataIntegrityError(
      'membership directory exceeded workspace response bound',
    );
  }

  const workspaces = snapshot.memberships.map((membership) =>
    Object.freeze({
      schema_version: 1 as const,
      membership_id: membership.membershipId,
      organization_id: membership.organizationId,
      display_name: membership.organizationDisplayName,
      status: membership.status,
      roles: Object.freeze([...membership.roles]),
    }),
  );

  return Object.freeze({
    schema_version: 1 as const,
    workspaces: Object.freeze(workspaces),
    has_more: snapshot.hasMore,
  });
}

export class WorkspaceDirectoryDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkspaceDirectoryDataIntegrityError';
  }
}

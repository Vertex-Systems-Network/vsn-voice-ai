import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { OrganizationMembership } from '../organizations/organization-membership.js';
import { authorizeTenantAccess } from '../organizations/tenant-authorization.js';

export const WORKSPACE_TEAM_MEMBER_STATUS_REPOSITORY = Symbol(
  'WORKSPACE_TEAM_MEMBER_STATUS_REPOSITORY',
);
export const WORKSPACE_TEAM_MANAGE_PERMISSION = 'team.manage';

export type ManagedWorkspaceTeamMemberStatus = 'active' | 'suspended';

export interface WorkspaceTeamMemberStatusResponse {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly membership_id: string;
  readonly status: ManagedWorkspaceTeamMemberStatus;
}

export interface WorkspaceTeamMemberStatusRepository {
  changeOrdinaryMemberStatus(
    actorSubjectId: string,
    organizationId: string,
    membershipId: string,
    status: ManagedWorkspaceTeamMemberStatus,
  ): Promise<WorkspaceTeamMemberStatusResponse | null>;
}

export interface WorkspaceTeamMemberStatusRequest {
  readonly principal: AuthenticatedPrincipal | null | undefined;
  readonly membership: OrganizationMembership | null | undefined;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly status: ManagedWorkspaceTeamMemberStatus;
}

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    normalized !== value
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

export async function changeWorkspaceTeamMemberStatus(
  request: WorkspaceTeamMemberStatusRequest,
  repository: WorkspaceTeamMemberStatusRepository,
): Promise<WorkspaceTeamMemberStatusResponse> {
  const organizationId = requireIdentifier(
    request.organizationId,
    'organizationId',
  );
  const membershipId = requireIdentifier(request.membershipId, 'membershipId');
  if (request.status !== 'active' && request.status !== 'suspended') {
    throw new TypeError('status is invalid');
  }

  const authorization = authorizeTenantAccess({
    principal: request.principal,
    membership: request.membership,
    resource: { organizationId },
    requiredPermission: WORKSPACE_TEAM_MANAGE_PERMISSION,
  });

  const updated = await repository.changeOrdinaryMemberStatus(
    authorization.subject_id,
    organizationId,
    membershipId,
    request.status,
  );
  if (updated === null) {
    throw new WorkspaceTeamMemberStatusMutationDeniedError();
  }
  if (
    updated.schema_version !== 1 ||
    updated.organization_id !== organizationId ||
    updated.membership_id !== membershipId ||
    updated.status !== request.status
  ) {
    throw new WorkspaceTeamMemberStatusDataIntegrityError(
      'workspace team member status persistence returned invalid data',
    );
  }

  return Object.freeze({
    schema_version: 1 as const,
    organization_id: updated.organization_id,
    membership_id: updated.membership_id,
    status: updated.status,
  });
}

export class WorkspaceTeamMemberStatusMutationDeniedError extends Error {
  public constructor() {
    super('workspace team member status update is not allowed');
    this.name = 'WorkspaceTeamMemberStatusMutationDeniedError';
  }
}

export class WorkspaceTeamMemberStatusDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkspaceTeamMemberStatusDataIntegrityError';
  }
}

export class WorkspaceTeamMemberStatusPersistenceUnavailableError extends Error {
  public constructor() {
    super('workspace team member status persistence is unavailable');
    this.name = 'WorkspaceTeamMemberStatusPersistenceUnavailableError';
  }
}

export class RejectingWorkspaceTeamMemberStatusRepository
  implements WorkspaceTeamMemberStatusRepository
{
  public async changeOrdinaryMemberStatus(
    _actorSubjectId: string,
    _organizationId: string,
    _membershipId: string,
    _status: ManagedWorkspaceTeamMemberStatus,
  ): Promise<WorkspaceTeamMemberStatusResponse | null> {
    throw new WorkspaceTeamMemberStatusPersistenceUnavailableError();
  }
}

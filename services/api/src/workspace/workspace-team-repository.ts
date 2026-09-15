import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type {
  MembershipStatus,
  OrganizationMembership,
} from '../organizations/organization-membership.js';
import { authorizeTenantAccess } from '../organizations/tenant-authorization.js';

export const WORKSPACE_TEAM_REPOSITORY = Symbol('WORKSPACE_TEAM_REPOSITORY');
export const WORKSPACE_TEAM_READ_PERMISSION = 'team.read';
export const MAX_WORKSPACE_TEAM_MEMBERS = 200;

export interface WorkspaceTeamMember {
  readonly schema_version: 1;
  readonly membership_id: string;
  readonly subject_id: string;
  readonly status: MembershipStatus;
  readonly roles: readonly string[];
}

export interface WorkspaceTeamSnapshot {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly members: readonly WorkspaceTeamMember[];
  readonly has_more: boolean;
}

export interface WorkspaceTeamRepository {
  listByOrganization(organizationId: string): Promise<WorkspaceTeamSnapshot>;
}

export interface WorkspaceTeamRequest {
  readonly principal: AuthenticatedPrincipal | null | undefined;
  readonly membership: OrganizationMembership | null | undefined;
  readonly organizationId: string;
}

/**
 * Tenant-authorized workspace team read boundary. The repository is invoked
 * only after an active membership carrying the explicit team.read permission
 * has been verified against the requested organization.
 */
export async function loadWorkspaceTeam(
  request: WorkspaceTeamRequest,
  repository: WorkspaceTeamRepository,
): Promise<WorkspaceTeamSnapshot> {
  const organizationId = request.organizationId.trim();
  if (organizationId.length === 0) {
    throw new TypeError('organizationId is required');
  }

  authorizeTenantAccess({
    principal: request.principal,
    membership: request.membership,
    resource: { organizationId },
    requiredPermission: WORKSPACE_TEAM_READ_PERMISSION,
  });

  const snapshot = await repository.listByOrganization(organizationId);
  if (snapshot.organization_id !== organizationId) {
    throw new WorkspaceTeamDataIntegrityError(
      'workspace team repository returned another organization',
    );
  }
  if (snapshot.members.length > MAX_WORKSPACE_TEAM_MEMBERS) {
    throw new WorkspaceTeamDataIntegrityError(
      'workspace team repository exceeded bounded member count',
    );
  }

  return Object.freeze({
    schema_version: 1 as const,
    organization_id: snapshot.organization_id,
    members: Object.freeze(
      snapshot.members.map((member) =>
        Object.freeze({
          schema_version: 1 as const,
          membership_id: member.membership_id,
          subject_id: member.subject_id,
          status: member.status,
          roles: Object.freeze([...member.roles]),
        }),
      ),
    ),
    has_more: snapshot.has_more,
  });
}

export class WorkspaceTeamDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkspaceTeamDataIntegrityError';
  }
}

/**
 * Safe runtime default for environments where PostgreSQL is not configured.
 * Team state must never be fabricated from an unavailable persistence layer.
 */
export class RejectingWorkspaceTeamRepository implements WorkspaceTeamRepository {
  public async listByOrganization(
    _organizationId: string,
  ): Promise<WorkspaceTeamSnapshot> {
    throw new WorkspaceTeamPersistenceUnavailableError();
  }
}

export class WorkspaceTeamPersistenceUnavailableError extends Error {
  public constructor() {
    super('workspace team persistence is unavailable');
    this.name = 'WorkspaceTeamPersistenceUnavailableError';
  }
}

import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { OrganizationMembership } from '../organizations/organization-membership.js';
import { authorizeTenantAccess } from '../organizations/tenant-authorization.js';

export const WORKSPACE_PROFILE_REPOSITORY = Symbol('WORKSPACE_PROFILE_REPOSITORY');
export const WORKSPACE_PROFILE_PERMISSION = 'conversation.read';

export interface WorkspaceProfileValues {
  readonly display_name: string;
  readonly job_title: string;
}

export interface WorkspaceProfileResponse extends WorkspaceProfileValues {
  readonly schema_version: 1;
  readonly organization_id: string;
}

export interface WorkspaceProfileRepository {
  getProfile(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceProfileValues | null>;
  putProfile(
    subjectId: string,
    organizationId: string,
    profile: WorkspaceProfileValues,
  ): Promise<WorkspaceProfileValues>;
}

export interface WorkspaceProfileRequest {
  readonly principal: AuthenticatedPrincipal | null | undefined;
  readonly membership: OrganizationMembership | null | undefined;
  readonly organizationId: string;
}

export const DEFAULT_WORKSPACE_PROFILE = Object.freeze<WorkspaceProfileValues>({
  display_name: '',
  job_title: '',
});

function authorizeProfile(
  request: WorkspaceProfileRequest,
): { readonly subjectId: string; readonly organizationId: string } {
  const organizationId = request.organizationId.trim();
  if (
    organizationId.length === 0 ||
    organizationId.length > 128 ||
    organizationId !== request.organizationId
  ) {
    throw new TypeError('organizationId is invalid');
  }

  const authorization = authorizeTenantAccess({
    principal: request.principal,
    membership: request.membership,
    resource: { organizationId },
    requiredPermission: WORKSPACE_PROFILE_PERMISSION,
  });

  return Object.freeze({
    subjectId: authorization.subject_id,
    organizationId,
  });
}

function toResponse(
  organizationId: string,
  values: WorkspaceProfileValues,
): WorkspaceProfileResponse {
  return Object.freeze({
    schema_version: 1 as const,
    organization_id: organizationId,
    display_name: values.display_name,
    job_title: values.job_title,
  });
}

export async function loadWorkspaceProfile(
  request: WorkspaceProfileRequest,
  repository: WorkspaceProfileRepository,
): Promise<WorkspaceProfileResponse> {
  const scope = authorizeProfile(request);
  const stored = await repository.getProfile(scope.subjectId, scope.organizationId);
  return toResponse(scope.organizationId, stored ?? DEFAULT_WORKSPACE_PROFILE);
}

export async function saveWorkspaceProfile(
  request: WorkspaceProfileRequest,
  profile: WorkspaceProfileValues,
  repository: WorkspaceProfileRepository,
): Promise<WorkspaceProfileResponse> {
  const scope = authorizeProfile(request);
  const stored = await repository.putProfile(
    scope.subjectId,
    scope.organizationId,
    Object.freeze({ ...profile }),
  );
  return toResponse(scope.organizationId, stored);
}

export class WorkspaceProfileDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkspaceProfileDataIntegrityError';
  }
}

export class WorkspaceProfilePersistenceUnavailableError extends Error {
  public constructor() {
    super('workspace profile persistence is unavailable');
    this.name = 'WorkspaceProfilePersistenceUnavailableError';
  }
}

export class RejectingWorkspaceProfileRepository
  implements WorkspaceProfileRepository
{
  public async getProfile(
    _subjectId: string,
    _organizationId: string,
  ): Promise<WorkspaceProfileValues | null> {
    throw new WorkspaceProfilePersistenceUnavailableError();
  }

  public async putProfile(
    _subjectId: string,
    _organizationId: string,
    _profile: WorkspaceProfileValues,
  ): Promise<WorkspaceProfileValues> {
    throw new WorkspaceProfilePersistenceUnavailableError();
  }
}

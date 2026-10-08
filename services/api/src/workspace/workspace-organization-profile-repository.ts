import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { OrganizationMembership } from '../organizations/organization-membership.js';
import { authorizeTenantAccess } from '../organizations/tenant-authorization.js';

export const WORKSPACE_ORGANIZATION_PROFILE_REPOSITORY = Symbol(
  'WORKSPACE_ORGANIZATION_PROFILE_REPOSITORY',
);
export const WORKSPACE_ORGANIZATION_PROFILE_READ_PERMISSION = 'conversation.read';
export const WORKSPACE_ORGANIZATION_PROFILE_WRITE_PERMISSION = 'team.manage';

export interface WorkspaceOrganizationProfileValues {
  readonly display_name: string;
}

export interface WorkspaceOrganizationProfileResponse
  extends WorkspaceOrganizationProfileValues {
  readonly schema_version: 1;
  readonly organization_id: string;
}

export interface WorkspaceOrganizationProfileRepository {
  getOrganizationProfile(
    organizationId: string,
  ): Promise<WorkspaceOrganizationProfileValues | null>;
  putOrganizationProfile(
    organizationId: string,
    profile: WorkspaceOrganizationProfileValues,
  ): Promise<WorkspaceOrganizationProfileValues>;
}

export interface WorkspaceOrganizationProfileRequest {
  readonly principal: AuthenticatedPrincipal | null | undefined;
  readonly membership: OrganizationMembership | null | undefined;
  readonly organizationId: string;
}

export const DEFAULT_WORKSPACE_ORGANIZATION_PROFILE =
  Object.freeze<WorkspaceOrganizationProfileValues>({
    display_name: '',
  });

function requireOrganizationId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    normalized !== value
  ) {
    throw new TypeError('organizationId is invalid');
  }
  return normalized;
}

function authorizeOrganizationProfile(
  request: WorkspaceOrganizationProfileRequest,
  permission: string,
): string {
  const organizationId = requireOrganizationId(request.organizationId);
  authorizeTenantAccess({
    principal: request.principal,
    membership: request.membership,
    resource: { organizationId },
    requiredPermission: permission,
  });
  return organizationId;
}

function toResponse(
  organizationId: string,
  values: WorkspaceOrganizationProfileValues,
): WorkspaceOrganizationProfileResponse {
  return Object.freeze({
    schema_version: 1 as const,
    organization_id: organizationId,
    display_name: values.display_name,
  });
}

export async function loadWorkspaceOrganizationProfile(
  request: WorkspaceOrganizationProfileRequest,
  repository: WorkspaceOrganizationProfileRepository,
): Promise<WorkspaceOrganizationProfileResponse> {
  const organizationId = authorizeOrganizationProfile(
    request,
    WORKSPACE_ORGANIZATION_PROFILE_READ_PERMISSION,
  );
  const stored = await repository.getOrganizationProfile(organizationId);
  return toResponse(
    organizationId,
    stored ?? DEFAULT_WORKSPACE_ORGANIZATION_PROFILE,
  );
}

export async function saveWorkspaceOrganizationProfile(
  request: WorkspaceOrganizationProfileRequest,
  profile: WorkspaceOrganizationProfileValues,
  repository: WorkspaceOrganizationProfileRepository,
): Promise<WorkspaceOrganizationProfileResponse> {
  const organizationId = authorizeOrganizationProfile(
    request,
    WORKSPACE_ORGANIZATION_PROFILE_WRITE_PERMISSION,
  );
  const stored = await repository.putOrganizationProfile(
    organizationId,
    Object.freeze({ ...profile }),
  );
  return toResponse(organizationId, stored);
}

export class WorkspaceOrganizationProfileDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkspaceOrganizationProfileDataIntegrityError';
  }
}

export class WorkspaceOrganizationProfilePersistenceUnavailableError extends Error {
  public constructor() {
    super('workspace organization profile persistence is unavailable');
    this.name = 'WorkspaceOrganizationProfilePersistenceUnavailableError';
  }
}

export class RejectingWorkspaceOrganizationProfileRepository
  implements WorkspaceOrganizationProfileRepository
{
  public async getOrganizationProfile(
    _organizationId: string,
  ): Promise<WorkspaceOrganizationProfileValues | null> {
    throw new WorkspaceOrganizationProfilePersistenceUnavailableError();
  }

  public async putOrganizationProfile(
    _organizationId: string,
    _profile: WorkspaceOrganizationProfileValues,
  ): Promise<WorkspaceOrganizationProfileValues> {
    throw new WorkspaceOrganizationProfilePersistenceUnavailableError();
  }
}

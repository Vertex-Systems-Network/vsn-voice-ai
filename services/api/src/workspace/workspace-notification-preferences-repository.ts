import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { OrganizationMembership } from '../organizations/organization-membership.js';
import { authorizeTenantAccess } from '../organizations/tenant-authorization.js';

export const WORKSPACE_NOTIFICATION_PREFERENCES_REPOSITORY = Symbol(
  'WORKSPACE_NOTIFICATION_PREFERENCES_REPOSITORY',
);
export const WORKSPACE_NOTIFICATION_PREFERENCES_PERMISSION = 'conversation.read';

export interface WorkspaceNotificationPreferenceValues {
  readonly meeting_reminders: boolean;
  readonly transcript_ready: boolean;
  readonly action_items: boolean;
  readonly desktop_link_events: boolean;
}

export interface WorkspaceNotificationPreferencesResponse
  extends WorkspaceNotificationPreferenceValues {
  readonly schema_version: 1;
  readonly organization_id: string;
}

export interface WorkspaceNotificationPreferencesRepository {
  get(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceNotificationPreferenceValues | null>;
  put(
    subjectId: string,
    organizationId: string,
    preferences: WorkspaceNotificationPreferenceValues,
  ): Promise<WorkspaceNotificationPreferenceValues>;
}

export interface WorkspaceNotificationPreferencesRequest {
  readonly principal: AuthenticatedPrincipal | null | undefined;
  readonly membership: OrganizationMembership | null | undefined;
  readonly organizationId: string;
}

export const DEFAULT_WORKSPACE_NOTIFICATION_PREFERENCES =
  Object.freeze<WorkspaceNotificationPreferenceValues>({
    meeting_reminders: true,
    transcript_ready: true,
    action_items: true,
    desktop_link_events: true,
  });

function authorizePreferences(
  request: WorkspaceNotificationPreferencesRequest,
): { readonly subjectId: string; readonly organizationId: string } {
  const organizationId = request.organizationId.trim();
  if (organizationId.length === 0 || organizationId.length > 128) {
    throw new TypeError('organizationId is invalid');
  }

  const authorization = authorizeTenantAccess({
    principal: request.principal,
    membership: request.membership,
    resource: { organizationId },
    requiredPermission: WORKSPACE_NOTIFICATION_PREFERENCES_PERMISSION,
  });

  return Object.freeze({
    subjectId: authorization.subject_id,
    organizationId,
  });
}

function toResponse(
  organizationId: string,
  values: WorkspaceNotificationPreferenceValues,
): WorkspaceNotificationPreferencesResponse {
  return Object.freeze({
    schema_version: 1 as const,
    organization_id: organizationId,
    meeting_reminders: values.meeting_reminders,
    transcript_ready: values.transcript_ready,
    action_items: values.action_items,
    desktop_link_events: values.desktop_link_events,
  });
}

export async function loadWorkspaceNotificationPreferences(
  request: WorkspaceNotificationPreferencesRequest,
  repository: WorkspaceNotificationPreferencesRepository,
): Promise<WorkspaceNotificationPreferencesResponse> {
  const scope = authorizePreferences(request);
  const stored = await repository.get(scope.subjectId, scope.organizationId);
  return toResponse(
    scope.organizationId,
    stored ?? DEFAULT_WORKSPACE_NOTIFICATION_PREFERENCES,
  );
}

export async function saveWorkspaceNotificationPreferences(
  request: WorkspaceNotificationPreferencesRequest,
  preferences: WorkspaceNotificationPreferenceValues,
  repository: WorkspaceNotificationPreferencesRepository,
): Promise<WorkspaceNotificationPreferencesResponse> {
  const scope = authorizePreferences(request);
  const stored = await repository.put(
    scope.subjectId,
    scope.organizationId,
    Object.freeze({ ...preferences }),
  );
  return toResponse(scope.organizationId, stored);
}

export class WorkspaceNotificationPreferencesDataIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkspaceNotificationPreferencesDataIntegrityError';
  }
}

export class WorkspaceNotificationPreferencesPersistenceUnavailableError extends Error {
  public constructor() {
    super('workspace notification preferences persistence is unavailable');
    this.name = 'WorkspaceNotificationPreferencesPersistenceUnavailableError';
  }
}

export class RejectingWorkspaceNotificationPreferencesRepository
  implements WorkspaceNotificationPreferencesRepository
{
  public async get(
    _subjectId: string,
    _organizationId: string,
  ): Promise<WorkspaceNotificationPreferenceValues | null> {
    throw new WorkspaceNotificationPreferencesPersistenceUnavailableError();
  }

  public async put(
    _subjectId: string,
    _organizationId: string,
    _preferences: WorkspaceNotificationPreferenceValues,
  ): Promise<WorkspaceNotificationPreferenceValues> {
    throw new WorkspaceNotificationPreferencesPersistenceUnavailableError();
  }
}

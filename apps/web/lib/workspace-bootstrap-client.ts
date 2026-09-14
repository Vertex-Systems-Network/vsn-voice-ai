export interface WorkspaceAuthorizationSummary {
  readonly schema_version: 1;
  readonly subject_id: string;
  readonly organization_id: string;
  readonly membership_id: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface UnloadedWorkspaceArea {
  readonly status: 'unloaded';
  readonly items: readonly [];
}

export interface WorkspaceBootstrapResponse {
  readonly schema_version: 1;
  readonly authorization: WorkspaceAuthorizationSummary;
  readonly meetings: UnloadedWorkspaceArea;
  readonly devices: UnloadedWorkspaceArea;
  readonly team: UnloadedWorkspaceArea;
  readonly settings: UnloadedWorkspaceArea;
}

export type WorkspaceBootstrapLoadResult =
  | { readonly status: 'ready'; readonly data: WorkspaceBootstrapResponse }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const authorizationRequiredKeys = [
  'schema_version',
  'subject_id',
  'organization_id',
  'membership_id',
  'roles',
  'permissions',
] as const;

const bootstrapKeys = [
  'schema_version',
  'authorization',
  'meetings',
  'devices',
  'team',
  'settings',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isWorkspaceAuthorizationSummary(
  value: unknown,
): value is WorkspaceAuthorizationSummary {
  if (!isRecord(value) || !hasExactKeys(value, authorizationRequiredKeys)) {
    return false;
  }

  return value.schema_version === 1 &&
    isNonEmptyString(value.subject_id) &&
    isNonEmptyString(value.organization_id) &&
    isNonEmptyString(value.membership_id) &&
    isStringArray(value.roles) &&
    isStringArray(value.permissions);
}

function isUnloadedArea(value: unknown): value is UnloadedWorkspaceArea {
  return isRecord(value) &&
    hasExactKeys(value, ['status', 'items']) &&
    value.status === 'unloaded' &&
    Array.isArray(value.items) &&
    value.items.length === 0;
}

export function isWorkspaceBootstrapResponse(
  value: unknown,
): value is WorkspaceBootstrapResponse {
  if (!isRecord(value) || !hasExactKeys(value, bootstrapKeys)) {
    return false;
  }

  if (
    value.schema_version !== 1 ||
    !isWorkspaceAuthorizationSummary(value.authorization)
  ) {
    return false;
  }

  return isUnloadedArea(value.meetings) &&
    isUnloadedArea(value.devices) &&
    isUnloadedArea(value.team) &&
    isUnloadedArea(value.settings);
}

export async function requestWorkspaceBootstrap(
  fetchImpl: WorkspaceFetch,
  organizationId: string,
): Promise<WorkspaceBootstrapLoadResult> {
  const normalizedOrganizationId = organizationId.trim();
  if (normalizedOrganizationId.length === 0) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/bootstrap`,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
        },
      },
    );
  } catch {
    return { status: 'unavailable' };
  }

  if (response.status === 401) {
    return { status: 'authentication_required' };
  }
  if (response.status === 403) {
    return { status: 'forbidden' };
  }
  if (!response.ok) {
    return { status: 'unavailable' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'invalid_response' };
  }

  if (!isWorkspaceBootstrapResponse(body)) {
    return { status: 'invalid_response' };
  }

  if (body.authorization.organization_id !== normalizedOrganizationId) {
    return { status: 'invalid_response' };
  }

  return {
    status: 'ready',
    data: body,
  };
}

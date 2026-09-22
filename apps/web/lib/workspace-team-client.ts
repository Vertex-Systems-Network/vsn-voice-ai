export type WorkspaceMembershipStatus = 'active' | 'invited' | 'suspended';

export interface WorkspaceTeamMember {
  readonly schema_version: 1;
  readonly membership_id: string;
  readonly display_name: string | null;
  readonly status: WorkspaceMembershipStatus;
  readonly roles: readonly string[];
}

export interface WorkspaceTeamResponse {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly members: readonly WorkspaceTeamMember[];
  readonly has_more: boolean;
}

export type WorkspaceTeamLoadResult =
  | { readonly status: 'ready'; readonly data: WorkspaceTeamResponse }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceTeamFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = [
  'schema_version',
  'organization_id',
  'members',
  'has_more',
] as const;
const memberKeys = [
  'schema_version',
  'membership_id',
  'display_name',
  'status',
  'roles',
] as const;
const authorityTokenPattern = /^[a-z][a-z0-9._:-]*$/;
const membershipStatuses = new Set<WorkspaceMembershipStatus>([
  'active',
  'invited',
  'suspended',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const allowed = new Set(required);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key));
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value;
}

function isDisplayName(value: unknown): value is string | null {
  return (
    value === null ||
    (
      typeof value === 'string' &&
      value.length >= 1 &&
      value.length <= 80 &&
      value.trim() === value &&
      !/[\u0000-\u001F\u007F]/u.test(value)
    )
  );
}

function isRoles(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return false;
  }

  const seen = new Set<string>();
  for (const role of value) {
    if (
      typeof role !== 'string' ||
      role.length < 1 ||
      role.length > 128 ||
      !authorityTokenPattern.test(role) ||
      seen.has(role)
    ) {
      return false;
    }
    seen.add(role);
  }
  return true;
}

function isWorkspaceTeamMember(value: unknown): value is WorkspaceTeamMember {
  if (!isRecord(value) || !hasExactKeys(value, memberKeys)) {
    return false;
  }

  return value.schema_version === 1 &&
    isBoundedIdentifier(value.membership_id) &&
    isDisplayName(value.display_name) &&
    typeof value.status === 'string' &&
    membershipStatuses.has(value.status as WorkspaceMembershipStatus) &&
    isRoles(value.roles);
}

export function isWorkspaceTeamResponse(
  value: unknown,
): value is WorkspaceTeamResponse {
  if (!isRecord(value) || !hasExactKeys(value, responseKeys)) {
    return false;
  }
  if (
    value.schema_version !== 1 ||
    !isBoundedIdentifier(value.organization_id) ||
    typeof value.has_more !== 'boolean' ||
    !Array.isArray(value.members) ||
    value.members.length > 200
  ) {
    return false;
  }

  return value.members.every(isWorkspaceTeamMember);
}

export async function requestWorkspaceTeam(
  fetchImpl: WorkspaceTeamFetch,
  organizationId: string,
): Promise<WorkspaceTeamLoadResult> {
  const normalizedOrganizationId = organizationId.trim();
  if (!isBoundedIdentifier(normalizedOrganizationId)) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/team`,
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

  if (
    !isWorkspaceTeamResponse(body) ||
    body.organization_id !== normalizedOrganizationId
  ) {
    return { status: 'invalid_response' };
  }

  return { status: 'ready', data: body };
}

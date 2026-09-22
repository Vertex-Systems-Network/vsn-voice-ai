export type WorkspaceDirectoryMembershipStatus =
  | 'active'
  | 'invited'
  | 'suspended';

export interface WorkspaceDirectoryEntry {
  readonly schema_version: 1;
  readonly membership_id: string;
  readonly organization_id: string;
  readonly display_name: string | null;
  readonly status: WorkspaceDirectoryMembershipStatus;
  readonly roles: readonly string[];
}

export interface WorkspaceDirectoryResponse {
  readonly schema_version: 1;
  readonly workspaces: readonly WorkspaceDirectoryEntry[];
  readonly has_more: boolean;
}

export type WorkspaceDirectoryLoadResult =
  | { readonly status: 'ready'; readonly data: WorkspaceDirectoryResponse }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceDirectoryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = ['schema_version', 'workspaces', 'has_more'] as const;
const workspaceKeys = [
  'schema_version',
  'membership_id',
  'organization_id',
  'display_name',
  'status',
  'roles',
] as const;
const authorityTokenPattern = /^[a-z][a-z0-9._:-]*$/;
const membershipStatuses = new Set<WorkspaceDirectoryMembershipStatus>([
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
      value.length <= 100 &&
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

function isWorkspaceDirectoryEntry(
  value: unknown,
): value is WorkspaceDirectoryEntry {
  if (!isRecord(value) || !hasExactKeys(value, workspaceKeys)) {
    return false;
  }

  return value.schema_version === 1 &&
    isBoundedIdentifier(value.membership_id) &&
    isBoundedIdentifier(value.organization_id) &&
    isDisplayName(value.display_name) &&
    typeof value.status === 'string' &&
    membershipStatuses.has(value.status as WorkspaceDirectoryMembershipStatus) &&
    isRoles(value.roles);
}

export function isWorkspaceDirectoryResponse(
  value: unknown,
): value is WorkspaceDirectoryResponse {
  if (!isRecord(value) || !hasExactKeys(value, responseKeys)) {
    return false;
  }
  if (
    value.schema_version !== 1 ||
    typeof value.has_more !== 'boolean' ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length > 100
  ) {
    return false;
  }

  const membershipIds = new Set<string>();
  const organizationIds = new Set<string>();
  for (const workspace of value.workspaces) {
    if (!isWorkspaceDirectoryEntry(workspace)) {
      return false;
    }
    if (
      membershipIds.has(workspace.membership_id) ||
      organizationIds.has(workspace.organization_id)
    ) {
      return false;
    }
    membershipIds.add(workspace.membership_id);
    organizationIds.add(workspace.organization_id);
  }
  return true;
}

export async function requestWorkspaceDirectory(
  fetchImpl: WorkspaceDirectoryFetch,
): Promise<WorkspaceDirectoryLoadResult> {
  let response: Response;
  try {
    response = await fetchImpl('/v1/workspaces', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
    });
  } catch {
    return { status: 'unavailable' };
  }

  if (response.status === 401) {
    return { status: 'authentication_required' };
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

  if (!isWorkspaceDirectoryResponse(body)) {
    return { status: 'invalid_response' };
  }

  return { status: 'ready', data: body };
}

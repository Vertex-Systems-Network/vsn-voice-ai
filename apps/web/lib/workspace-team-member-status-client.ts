export type WorkspaceTeamManagedStatus = 'active' | 'suspended';

export interface WorkspaceTeamMemberStatusResponse {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly membership_id: string;
  readonly status: WorkspaceTeamManagedStatus;
}

export type WorkspaceTeamMemberStatusResult =
  | { readonly status: 'ready'; readonly data: WorkspaceTeamMemberStatusResponse }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceTeamMemberStatusFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = [
  'schema_version',
  'organization_id',
  'membership_id',
  'status',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const allowed = new Set(required);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function isManagedStatus(value: unknown): value is WorkspaceTeamManagedStatus {
  return value === 'active' || value === 'suspended';
}

function isStatusResponse(
  value: unknown,
): value is WorkspaceTeamMemberStatusResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, responseKeys) &&
    value.schema_version === 1 &&
    isIdentifier(value.organization_id) &&
    isIdentifier(value.membership_id) &&
    isManagedStatus(value.status)
  );
}

export async function updateWorkspaceTeamMemberStatus(
  fetchImpl: WorkspaceTeamMemberStatusFetch,
  organizationId: string,
  membershipId: string,
  status: WorkspaceTeamManagedStatus,
): Promise<WorkspaceTeamMemberStatusResult> {
  if (
    !isIdentifier(organizationId) ||
    !isIdentifier(membershipId) ||
    !isManagedStatus(status)
  ) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(organizationId)}/team/${encodeURIComponent(membershipId)}/status`,
      {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status }),
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
    !isStatusResponse(body) ||
    body.organization_id !== organizationId ||
    body.membership_id !== membershipId ||
    body.status !== status
  ) {
    return { status: 'invalid_response' };
  }

  return { status: 'ready', data: body };
}

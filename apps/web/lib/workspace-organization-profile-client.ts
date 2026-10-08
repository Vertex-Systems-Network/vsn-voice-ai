export interface WorkspaceOrganizationProfile {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly display_name: string;
}

export interface WorkspaceOrganizationProfileValues {
  readonly display_name: string;
}

export type WorkspaceOrganizationProfileResult =
  | { readonly status: 'ready'; readonly data: WorkspaceOrganizationProfile }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceOrganizationProfileFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = [
  'schema_version',
  'organization_id',
  'display_name',
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

function isDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 100 &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function isProfile(value: unknown): value is WorkspaceOrganizationProfile {
  return (
    isRecord(value) &&
    hasExactKeys(value, responseKeys) &&
    value.schema_version === 1 &&
    isIdentifier(value.organization_id) &&
    isDisplayName(value.display_name)
  );
}

function normalizeOrganizationId(organizationId: string): string | null {
  const normalized = organizationId.trim();
  return isIdentifier(normalized) ? normalized : null;
}

async function parseResponse(
  response: Response,
  organizationId: string,
): Promise<WorkspaceOrganizationProfileResult> {
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
  if (!isProfile(body) || body.organization_id !== organizationId) {
    return { status: 'invalid_response' };
  }
  return { status: 'ready', data: body };
}

export async function requestWorkspaceOrganizationProfile(
  fetchImpl: WorkspaceOrganizationProfileFetch,
  organizationId: string,
): Promise<WorkspaceOrganizationProfileResult> {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (normalizedOrganizationId === null) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/organization-profile`,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      },
    );
  } catch {
    return { status: 'unavailable' };
  }
  return parseResponse(response, normalizedOrganizationId);
}

export async function updateWorkspaceOrganizationProfile(
  fetchImpl: WorkspaceOrganizationProfileFetch,
  organizationId: string,
  profile: WorkspaceOrganizationProfileValues,
): Promise<WorkspaceOrganizationProfileResult> {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (
    normalizedOrganizationId === null ||
    !isDisplayName(profile.display_name)
  ) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/organization-profile`,
      {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ display_name: profile.display_name }),
      },
    );
  } catch {
    return { status: 'unavailable' };
  }
  return parseResponse(response, normalizedOrganizationId);
}

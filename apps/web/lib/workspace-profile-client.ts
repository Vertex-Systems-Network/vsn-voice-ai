export interface WorkspaceProfile {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly display_name: string;
  readonly job_title: string;
}

export interface WorkspaceProfileValues {
  readonly display_name: string;
  readonly job_title: string;
}

export type WorkspaceProfileResult =
  | { readonly status: 'ready'; readonly data: WorkspaceProfile }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceProfileFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = [
  'schema_version',
  'organization_id',
  'display_name',
  'job_title',
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

function isOrganizationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function isProfileText(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

export function isWorkspaceProfile(value: unknown): value is WorkspaceProfile {
  return (
    isRecord(value) &&
    hasExactKeys(value, responseKeys) &&
    value.schema_version === 1 &&
    isOrganizationId(value.organization_id) &&
    isProfileText(value.display_name, 80) &&
    isProfileText(value.job_title, 120)
  );
}

function normalizeOrganizationId(organizationId: string): string | null {
  const normalized = organizationId.trim();
  return isOrganizationId(normalized) ? normalized : null;
}

function validateProfile(
  profile: WorkspaceProfileValues,
): WorkspaceProfileValues | null {
  if (
    !isProfileText(profile.display_name, 80) ||
    !isProfileText(profile.job_title, 120)
  ) {
    return null;
  }
  return Object.freeze({
    display_name: profile.display_name,
    job_title: profile.job_title,
  });
}

async function parseResponse(
  response: Response,
  organizationId: string,
): Promise<WorkspaceProfileResult> {
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
  if (!isWorkspaceProfile(body) || body.organization_id !== organizationId) {
    return { status: 'invalid_response' };
  }
  return { status: 'ready', data: body };
}

export async function requestWorkspaceProfile(
  fetchImpl: WorkspaceProfileFetch,
  organizationId: string,
): Promise<WorkspaceProfileResult> {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (normalizedOrganizationId === null) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/profile`,
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

export async function updateWorkspaceProfile(
  fetchImpl: WorkspaceProfileFetch,
  organizationId: string,
  profile: WorkspaceProfileValues,
): Promise<WorkspaceProfileResult> {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const validatedProfile = validateProfile(profile);
  if (normalizedOrganizationId === null || validatedProfile === null) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/profile`,
      {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          display_name: validatedProfile.display_name,
          job_title: validatedProfile.job_title,
        }),
      },
    );
  } catch {
    return { status: 'unavailable' };
  }
  return parseResponse(response, normalizedOrganizationId);
}

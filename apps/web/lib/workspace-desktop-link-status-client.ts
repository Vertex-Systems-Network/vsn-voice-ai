export type WorkspaceDesktopLinkStatus =
  | 'issued'
  | 'consumed'
  | 'revoked'
  | 'expired';

export interface WorkspaceDesktopLinkStatusResponse {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly organization_id: string;
  readonly device_id: string;
  readonly status: WorkspaceDesktopLinkStatus;
  readonly expires_at: string;
  readonly consumed_at: string | null;
}

export type WorkspaceDesktopLinkStatusResult =
  | { readonly status: 'ready'; readonly data: WorkspaceDesktopLinkStatusResponse }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceDesktopLinkStatusFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = [
  'schema_version',
  'record_id',
  'organization_id',
  'device_id',
  'status',
  'expires_at',
  'consumed_at',
] as const;
const recordIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set<WorkspaceDesktopLinkStatus>([
  'issued',
  'consumed',
  'revoked',
  'expired',
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
    value.length <= 256 &&
    value.trim() === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value));
}

export function isWorkspaceDesktopLinkStatusResponse(
  value: unknown,
): value is WorkspaceDesktopLinkStatusResponse {
  if (!isRecord(value) || !hasExactKeys(value, responseKeys)) {
    return false;
  }
  if (
    value.schema_version !== 1 ||
    typeof value.record_id !== 'string' ||
    !recordIdPattern.test(value.record_id) ||
    !isBoundedIdentifier(value.organization_id) ||
    !isBoundedIdentifier(value.device_id) ||
    typeof value.status !== 'string' ||
    !statuses.has(value.status as WorkspaceDesktopLinkStatus) ||
    !isTimestamp(value.expires_at)
  ) {
    return false;
  }

  if (value.consumed_at !== null && !isTimestamp(value.consumed_at)) {
    return false;
  }
  if (value.status === 'consumed' && value.consumed_at === null) {
    return false;
  }
  if (value.status !== 'consumed' && value.consumed_at !== null) {
    return false;
  }
  return true;
}

export async function requestWorkspaceDesktopLinkStatus(
  fetchImpl: WorkspaceDesktopLinkStatusFetch,
  organizationId: string,
  recordId: string,
): Promise<WorkspaceDesktopLinkStatusResult> {
  const normalizedOrganizationId = organizationId.trim();
  const normalizedRecordId = recordId.trim();

  if (
    !isBoundedIdentifier(normalizedOrganizationId) ||
    !recordIdPattern.test(normalizedRecordId)
  ) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/organizations/${encodeURIComponent(normalizedOrganizationId)}/desktop-links/${encodeURIComponent(normalizedRecordId)}/status`,
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
  if (response.status === 404) {
    return { status: 'not_found' };
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
    !isWorkspaceDesktopLinkStatusResponse(body) ||
    body.organization_id !== normalizedOrganizationId ||
    body.record_id !== normalizedRecordId
  ) {
    return { status: 'invalid_response' };
  }

  return { status: 'ready', data: body };
}

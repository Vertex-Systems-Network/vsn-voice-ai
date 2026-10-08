export interface WorkspaceDesktopLinkIssue {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly exchange_token: string;
  readonly expires_at: string;
}

export type WorkspaceDesktopLinkIssueResult =
  | { readonly status: 'ready'; readonly data: WorkspaceDesktopLinkIssue }
  | { readonly status: 'invalid_input' }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceDesktopLinkFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = [
  'schema_version',
  'record_id',
  'exchange_token',
  'expires_at',
] as const;
const recordIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exchangeTokenPattern = /^[A-Za-z0-9_-]{43}$/;

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

function isBoundedIdentifier(
  value: string,
  maximumLength: number,
): boolean {
  return value.length >= 1 &&
    value.length <= maximumLength &&
    value.trim() === value;
}

export function isWorkspaceDesktopLinkIssue(
  value: unknown,
): value is WorkspaceDesktopLinkIssue {
  if (!isRecord(value) || !hasExactKeys(value, responseKeys)) {
    return false;
  }

  return value.schema_version === 1 &&
    typeof value.record_id === 'string' &&
    recordIdPattern.test(value.record_id) &&
    typeof value.exchange_token === 'string' &&
    exchangeTokenPattern.test(value.exchange_token) &&
    typeof value.expires_at === 'string' &&
    value.expires_at.length >= 20 &&
    value.expires_at.length <= 40 &&
    Number.isFinite(Date.parse(value.expires_at));
}

export async function issueWorkspaceDesktopLink(
  fetchImpl: WorkspaceDesktopLinkFetch,
  organizationId: string,
  deviceId: string,
): Promise<WorkspaceDesktopLinkIssueResult> {
  const normalizedOrganizationId = organizationId.trim();
  const normalizedDeviceId = deviceId.trim();

  if (
    !isBoundedIdentifier(normalizedOrganizationId, 128) ||
    !isBoundedIdentifier(normalizedDeviceId, 256)
  ) {
    return { status: 'invalid_input' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/organizations/${encodeURIComponent(normalizedOrganizationId)}/desktop-links`,
      {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ device_id: normalizedDeviceId }),
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
  if (response.status === 400) {
    return { status: 'invalid_input' };
  }
  if (response.status !== 201) {
    return { status: 'unavailable' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'invalid_response' };
  }

  if (!isWorkspaceDesktopLinkIssue(body)) {
    return { status: 'invalid_response' };
  }

  return {
    status: 'ready',
    data: body,
  };
}

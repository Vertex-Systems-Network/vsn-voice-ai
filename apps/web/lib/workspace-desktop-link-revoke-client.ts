import {
  isWorkspaceDesktopLinkStatusResponse,
  type WorkspaceDesktopLinkStatusResponse,
} from './workspace-desktop-link-status-client';

export type WorkspaceDesktopLinkRevokeResult =
  | { readonly status: 'ready'; readonly data: WorkspaceDesktopLinkStatusResponse }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceDesktopLinkRevokeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const recordIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isBoundedIdentifier(value: string): boolean {
  return value.length >= 1 &&
    value.length <= 256 &&
    value.trim() === value;
}

export async function revokeWorkspaceDesktopLink(
  fetchImpl: WorkspaceDesktopLinkRevokeFetch,
  organizationId: string,
  recordId: string,
): Promise<WorkspaceDesktopLinkRevokeResult> {
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
      `/v1/organizations/${encodeURIComponent(normalizedOrganizationId)}/desktop-links/${encodeURIComponent(normalizedRecordId)}/revoke`,
      {
        method: 'POST',
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
    body.record_id !== normalizedRecordId ||
    body.status !== 'revoked' ||
    body.consumed_at !== null
  ) {
    return { status: 'invalid_response' };
  }

  return { status: 'ready', data: body };
}

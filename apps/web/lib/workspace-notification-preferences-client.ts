export interface WorkspaceNotificationPreferences {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly meeting_reminders: boolean;
  readonly transcript_ready: boolean;
  readonly action_items: boolean;
  readonly desktop_link_events: boolean;
}

export interface WorkspaceNotificationPreferenceValues {
  readonly meeting_reminders: boolean;
  readonly transcript_ready: boolean;
  readonly action_items: boolean;
  readonly desktop_link_events: boolean;
}

export type WorkspaceNotificationPreferencesResult =
  | { readonly status: 'ready'; readonly data: WorkspaceNotificationPreferences }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceNotificationPreferencesFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseKeys = [
  'schema_version',
  'organization_id',
  'meeting_reminders',
  'transcript_ready',
  'action_items',
  'desktop_link_events',
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

export function isWorkspaceNotificationPreferences(
  value: unknown,
): value is WorkspaceNotificationPreferences {
  return (
    isRecord(value) &&
    hasExactKeys(value, responseKeys) &&
    value.schema_version === 1 &&
    isOrganizationId(value.organization_id) &&
    typeof value.meeting_reminders === 'boolean' &&
    typeof value.transcript_ready === 'boolean' &&
    typeof value.action_items === 'boolean' &&
    typeof value.desktop_link_events === 'boolean'
  );
}

function normalizeOrganizationId(organizationId: string): string | null {
  const normalized = organizationId.trim();
  return isOrganizationId(normalized) ? normalized : null;
}

async function parseResponse(
  response: Response,
  organizationId: string,
): Promise<WorkspaceNotificationPreferencesResult> {
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
    !isWorkspaceNotificationPreferences(body) ||
    body.organization_id !== organizationId
  ) {
    return { status: 'invalid_response' };
  }
  return { status: 'ready', data: body };
}

export async function requestWorkspaceNotificationPreferences(
  fetchImpl: WorkspaceNotificationPreferencesFetch,
  organizationId: string,
): Promise<WorkspaceNotificationPreferencesResult> {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (normalizedOrganizationId === null) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/notification-preferences`,
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

export async function updateWorkspaceNotificationPreferences(
  fetchImpl: WorkspaceNotificationPreferencesFetch,
  organizationId: string,
  preferences: WorkspaceNotificationPreferenceValues,
): Promise<WorkspaceNotificationPreferencesResult> {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (normalizedOrganizationId === null) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/workspaces/${encodeURIComponent(normalizedOrganizationId)}/notification-preferences`,
      {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          meeting_reminders: preferences.meeting_reminders,
          transcript_ready: preferences.transcript_ready,
          action_items: preferences.action_items,
          desktop_link_events: preferences.desktop_link_events,
        }),
      },
    );
  } catch {
    return { status: 'unavailable' };
  }
  return parseResponse(response, normalizedOrganizationId);
}

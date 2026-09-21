export interface WorkspaceLinkedDesktop {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly device_id: string;
  readonly linked_at: string;
}

export interface WorkspaceLinkedDesktopInventory {
  readonly schema_version: 1;
  readonly organization_id: string;
  readonly devices: readonly WorkspaceLinkedDesktop[];
  readonly has_more: boolean;
}

export type WorkspaceLinkedDesktopInventoryResult =
  | { readonly status: 'ready'; readonly data: WorkspaceLinkedDesktopInventory }
  | { readonly status: 'authentication_required' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_response' }
  | { readonly status: 'unavailable' };

export type WorkspaceLinkedDesktopFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const inventoryKeys = [
  'schema_version',
  'organization_id',
  'devices',
  'has_more',
] as const;
const deviceKeys = [
  'schema_version',
  'record_id',
  'device_id',
  'linked_at',
] as const;
const recordIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isLinkedDesktop(value: unknown): value is WorkspaceLinkedDesktop {
  return isRecord(value) &&
    hasExactKeys(value, deviceKeys) &&
    value.schema_version === 1 &&
    typeof value.record_id === 'string' &&
    recordIdPattern.test(value.record_id) &&
    isBoundedIdentifier(value.device_id) &&
    isTimestamp(value.linked_at);
}

export function isWorkspaceLinkedDesktopInventory(
  value: unknown,
): value is WorkspaceLinkedDesktopInventory {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, inventoryKeys) ||
    value.schema_version !== 1 ||
    !isBoundedIdentifier(value.organization_id) ||
    !Array.isArray(value.devices) ||
    value.devices.length > 50 ||
    typeof value.has_more !== 'boolean'
  ) {
    return false;
  }

  const seenDevices = new Set<string>();
  for (const device of value.devices) {
    if (!isLinkedDesktop(device) || seenDevices.has(device.device_id)) {
      return false;
    }
    seenDevices.add(device.device_id);
  }
  return true;
}

export async function requestWorkspaceLinkedDesktops(
  fetchImpl: WorkspaceLinkedDesktopFetch,
  organizationId: string,
): Promise<WorkspaceLinkedDesktopInventoryResult> {
  const normalizedOrganizationId = organizationId.trim();
  if (!isBoundedIdentifier(normalizedOrganizationId)) {
    return { status: 'invalid_response' };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `/v1/organizations/${encodeURIComponent(normalizedOrganizationId)}/desktop-links/linked`,
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
    !isWorkspaceLinkedDesktopInventory(body) ||
    body.organization_id !== normalizedOrganizationId
  ) {
    return { status: 'invalid_response' };
  }

  return { status: 'ready', data: body };
}

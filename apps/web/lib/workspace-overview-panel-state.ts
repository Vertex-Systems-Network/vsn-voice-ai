import type {
  WorkspaceBootstrapLoadResult,
  WorkspaceBootstrapResponse,
} from './workspace-bootstrap-client';

export type WorkspaceOverviewTone = 'neutral' | 'ready' | 'warning';

export interface WorkspaceOverviewView {
  readonly heading: string;
  readonly description: string;
  readonly badge: string;
  readonly tone: WorkspaceOverviewTone;
  readonly organizationId: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly unloadedAreas: readonly string[];
}

function view(
  heading: string,
  description: string,
  badge: string,
  tone: WorkspaceOverviewTone,
  organizationId: string | null = null,
  roles: readonly string[] = [],
  permissions: readonly string[] = [],
  unloadedAreas: readonly string[] = [],
): WorkspaceOverviewView {
  return Object.freeze({
    heading,
    description,
    badge,
    tone,
    organizationId,
    roles: Object.freeze([...roles]),
    permissions: Object.freeze([...permissions]),
    unloadedAreas: Object.freeze([...unloadedAreas]),
  });
}

export function workspaceOverviewSelectionRequiredView(): WorkspaceOverviewView {
  return view(
    'Select a workspace for access details',
    'Tenant authorization stays unloaded until you explicitly choose an active organization membership.',
    'No workspace selected',
    'neutral',
  );
}

export function loadingWorkspaceOverviewView(): WorkspaceOverviewView {
  return view(
    'Verifying workspace access',
    'Loading the tenant-authorized bootstrap contract for the selected workspace.',
    'Loading',
    'neutral',
  );
}

function unloadedAreas(data: WorkspaceBootstrapResponse): readonly string[] {
  const areas: string[] = [];
  if (data.meetings.status === 'unloaded') areas.push('Meetings');
  if (data.devices.status === 'unloaded') areas.push('Devices bootstrap');
  if (data.team.status === 'unloaded') areas.push('Team bootstrap');
  if (data.settings.status === 'unloaded') areas.push('Settings');
  return areas;
}

export function workspaceOverviewView(
  result: WorkspaceBootstrapLoadResult,
): WorkspaceOverviewView {
  switch (result.status) {
    case 'ready':
      return view(
        'Workspace access verified',
        'This summary comes from the tenant-authorized workspace bootstrap. Internal subject and membership identifiers are intentionally not displayed.',
        'Authorized',
        'ready',
        result.data.authorization.organization_id,
        result.data.authorization.roles,
        result.data.authorization.permissions,
        unloadedAreas(result.data),
      );
    case 'authentication_required':
      return view(
        'Authentication required',
        'The selected workspace cannot be verified without the approved authenticated session flow.',
        'Signed out',
        'warning',
      );
    case 'forbidden':
      return view(
        'Workspace access denied',
        'The authenticated account is not authorized for this workspace bootstrap.',
        'Forbidden',
        'warning',
      );
    case 'invalid_response':
    case 'unavailable':
      return view(
        'Workspace access unavailable',
        'The selected workspace authorization summary could not be loaded safely.',
        'Unavailable',
        'warning',
      );
  }
}

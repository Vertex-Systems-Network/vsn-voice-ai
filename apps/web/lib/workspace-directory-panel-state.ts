import type {
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryLoadResult,
} from './workspace-directory-client';

export type WorkspaceDirectoryPanelTone = 'neutral' | 'ready' | 'warning';

export interface WorkspaceDirectoryPanelView {
  readonly heading: string;
  readonly description: string;
  readonly badge: string;
  readonly tone: WorkspaceDirectoryPanelTone;
  readonly workspaces: readonly WorkspaceDirectoryEntry[];
  readonly hasMore: boolean;
}

export function loadingWorkspaceDirectoryPanelView(): WorkspaceDirectoryPanelView {
  return Object.freeze({
    heading: 'Loading workspaces',
    description: 'Checking authenticated organization memberships.',
    badge: 'Loading',
    tone: 'neutral' as const,
    workspaces: Object.freeze([]),
    hasMore: false,
  });
}

export function workspaceDirectoryPanelView(
  result: WorkspaceDirectoryLoadResult,
): WorkspaceDirectoryPanelView {
  switch (result.status) {
    case 'ready': {
      const workspaceCount = result.data.workspaces.length;
      return Object.freeze({
        heading:
          workspaceCount === 0
            ? 'No workspaces available'
            : `${workspaceCount} ${workspaceCount === 1 ? 'workspace' : 'workspaces'} available`,
        description: result.data.has_more
          ? 'Showing the first 100 persisted organization memberships. Additional workspaces are available.'
          : workspaceCount === 0
            ? 'No persisted organization membership is available for this authenticated account.'
            : 'Choose a persisted organization membership before tenant-bound workspace data is loaded.',
        badge: 'Authenticated directory',
        tone: 'ready' as const,
        workspaces: Object.freeze([...result.data.workspaces]),
        hasMore: result.data.has_more,
      });
    }
    case 'authentication_required':
      return Object.freeze({
        heading: 'Authentication required',
        description: 'Sign in through the approved workspace identity flow to choose an organization.',
        badge: 'Signed out',
        tone: 'warning' as const,
        workspaces: Object.freeze([]),
        hasMore: false,
      });
    case 'invalid_response':
    case 'unavailable':
      return Object.freeze({
        heading: 'Workspace directory unavailable',
        description: 'Workspace memberships could not be loaded safely. No organization is selected.',
        badge: 'Unavailable',
        tone: 'warning' as const,
        workspaces: Object.freeze([]),
        hasMore: false,
      });
  }
}

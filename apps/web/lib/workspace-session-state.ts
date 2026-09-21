import type { WorkspaceDirectoryLoadResult } from './workspace-directory-client';

export type WorkspaceSessionState =
  | 'checking'
  | 'authenticated'
  | 'signed_out'
  | 'unavailable';

export type WorkspaceSessionTone = 'neutral' | 'ready' | 'warning';

export interface WorkspaceSessionView {
  readonly label: string;
  readonly tone: WorkspaceSessionTone;
}

export function workspaceSessionState(
  result: WorkspaceDirectoryLoadResult,
): WorkspaceSessionState {
  switch (result.status) {
    case 'ready':
      return 'authenticated';
    case 'authentication_required':
      return 'signed_out';
    case 'invalid_response':
    case 'unavailable':
      return 'unavailable';
  }
}

export function workspaceSessionView(
  state: WorkspaceSessionState,
): WorkspaceSessionView {
  switch (state) {
    case 'checking':
      return Object.freeze({
        label: 'Checking authentication',
        tone: 'neutral' as const,
      });
    case 'authenticated':
      return Object.freeze({
        label: 'Authenticated workspace session',
        tone: 'ready' as const,
      });
    case 'signed_out':
      return Object.freeze({
        label: 'Signed out',
        tone: 'warning' as const,
      });
    case 'unavailable':
      return Object.freeze({
        label: 'Authentication state unavailable',
        tone: 'warning' as const,
      });
  }
}

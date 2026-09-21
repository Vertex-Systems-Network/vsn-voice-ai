import type { WorkspaceDirectoryEntry } from './workspace-directory-client';

export interface WorkspaceSelectionState {
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly actionLabel: string;
  readonly statusLabel: string;
}

export function workspaceSelectionState(
  workspace: WorkspaceDirectoryEntry,
  selectedOrganizationId: string | null,
): WorkspaceSelectionState {
  const selected =
    workspace.status === 'active' &&
    selectedOrganizationId === workspace.organization_id;

  if (workspace.status !== 'active') {
    return Object.freeze({
      selectable: false,
      selected: false,
      actionLabel:
        workspace.status === 'invited'
          ? 'Invitation pending'
          : 'Access suspended',
      statusLabel:
        workspace.status === 'invited'
          ? 'Invited membership'
          : 'Suspended membership',
    });
  }

  return Object.freeze({
    selectable: !selected,
    selected,
    actionLabel: selected ? 'Selected' : 'Select',
    statusLabel: selected ? 'Active · selected' : 'Active membership',
  });
}


export function workspaceSelectionRemainsAuthorized(
  workspaces: readonly WorkspaceDirectoryEntry[],
  selectedOrganizationId: string | null,
): boolean {
  if (selectedOrganizationId === null) {
    return true;
  }

  return workspaces.some(
    (workspace) =>
      workspace.organization_id === selectedOrganizationId &&
      workspace.status === 'active',
  );
}

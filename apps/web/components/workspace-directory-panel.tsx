'use client';

import { useEffect, useState } from 'react';

import { requestWorkspaceDirectory } from '../lib/workspace-directory-client';
import {
  workspaceSelectionRemainsAuthorized,
  workspaceSelectionState,
} from '../lib/workspace-directory-selection';
import {
  workspaceSessionState,
  type WorkspaceSessionState,
} from '../lib/workspace-session-state';
import {
  loadingWorkspaceDirectoryPanelView,
  workspaceDirectoryPanelView,
  type WorkspaceDirectoryPanelView,
} from '../lib/workspace-directory-panel-state';

export interface WorkspaceDirectoryPanelProps {
  readonly selectedOrganizationId: string | null;
  readonly onSelectWorkspace: (organizationId: string) => void;
  readonly onInvalidateWorkspaceSelection: () => void;
  readonly onSessionStateChange: (state: WorkspaceSessionState) => void;
}

export function WorkspaceDirectoryPanel({
  selectedOrganizationId,
  onSelectWorkspace,
  onInvalidateWorkspaceSelection,
  onSessionStateChange,
}: WorkspaceDirectoryPanelProps) {
  const [view, setView] = useState<WorkspaceDirectoryPanelView>(() =>
    loadingWorkspaceDirectoryPanelView(),
  );
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setView(loadingWorkspaceDirectoryPanelView());
    onSessionStateChange('checking');

    void requestWorkspaceDirectory(globalThis.fetch.bind(globalThis)).then(
      (result) => {
        if (!cancelled) {
          setView(workspaceDirectoryPanelView(result));
          onSessionStateChange(workspaceSessionState(result));
          if (
            result.status === 'ready' &&
            !workspaceSelectionRemainsAuthorized(
              result.data.workspaces,
              selectedOrganizationId,
            )
          ) {
            onInvalidateWorkspaceSelection();
          }
        }
      },
      () => {
        if (!cancelled) {
          const result = { status: 'unavailable' } as const;
          setView(workspaceDirectoryPanelView(result));
          onSessionStateChange(workspaceSessionState(result));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [
    onInvalidateWorkspaceSelection,
    onSessionStateChange,
    refreshRevision,
    selectedOrganizationId,
  ]);

  return (
    <section
      className="area-card workspace-directory-panel"
      aria-labelledby="workspace-directory-title"
      aria-busy={view.badge === 'Loading'}
    >
      <p className="eyebrow">Organizations</p>
      <h3 id="workspace-directory-title">{view.heading}</h3>
      <p>{view.description}</p>
      <div className="workspace-directory-actions">
        <span
          className="empty-state-badge"
          data-tone={view.tone}
          role="status"
          aria-live="polite"
        >
          {view.badge}
        </span>
        <button
          type="button"
          disabled={view.badge === 'Loading'}
          onClick={() => setRefreshRevision((current) => current + 1)}
        >
          Refresh workspaces
        </button>
      </div>

      {view.workspaces.length > 0 ? (
        <ul className="workspace-directory-list" aria-label="Available workspaces">
          {view.workspaces.map((workspace) => {
            const selection = workspaceSelectionState(
              workspace,
              selectedOrganizationId,
            );

            return (
              <li
                className="workspace-directory-row"
                data-selected={selection.selected ? 'true' : 'false'}
                key={workspace.membership_id}
              >
                <div>
                  <strong>{workspace.organization_id}</strong>
                  <span>{selection.statusLabel}</span>
                  <span>{workspace.roles.join(', ')}</span>
                </div>
                <button
                  type="button"
                  disabled={!selection.selectable}
                  onClick={() => {
                    if (selection.selectable) {
                      onSelectWorkspace(workspace.organization_id);
                    }
                  }}
                  aria-label={
                    selection.selectable
                      ? `Select workspace ${workspace.organization_id}`
                      : `${selection.actionLabel}: ${workspace.organization_id}`
                  }
                >
                  {selection.actionLabel}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {view.hasMore ? (
        <p className="workspace-directory-limit-note" role="note">
          This selector is intentionally bounded to the first 100 workspaces.
        </p>
      ) : null}
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';

import { requestWorkspaceDirectory } from '../lib/workspace-directory-client';
import {
  loadingWorkspaceDirectoryPanelView,
  workspaceDirectoryPanelView,
  type WorkspaceDirectoryPanelView,
} from '../lib/workspace-directory-panel-state';

export interface WorkspaceDirectoryPanelProps {
  readonly onSelectWorkspace: (organizationId: string) => void;
}

export function WorkspaceDirectoryPanel({
  onSelectWorkspace,
}: WorkspaceDirectoryPanelProps) {
  const [view, setView] = useState<WorkspaceDirectoryPanelView>(() =>
    loadingWorkspaceDirectoryPanelView(),
  );

  useEffect(() => {
    let cancelled = false;
    setView(loadingWorkspaceDirectoryPanelView());

    void requestWorkspaceDirectory(globalThis.fetch.bind(globalThis)).then(
      (result) => {
        if (!cancelled) {
          setView(workspaceDirectoryPanelView(result));
        }
      },
      () => {
        if (!cancelled) {
          setView(workspaceDirectoryPanelView({ status: 'unavailable' }));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className="area-card workspace-directory-panel"
      aria-labelledby="workspace-directory-title"
      aria-busy={view.badge === 'Loading'}
    >
      <p className="eyebrow">Organizations</p>
      <h3 id="workspace-directory-title">{view.heading}</h3>
      <p>{view.description}</p>
      <span
        className="empty-state-badge"
        data-tone={view.tone}
        role="status"
        aria-live="polite"
      >
        {view.badge}
      </span>

      {view.workspaces.length > 0 ? (
        <ul className="workspace-directory-list" aria-label="Available workspaces">
          {view.workspaces.map((workspace) => (
            <li
              className="workspace-directory-row"
              key={workspace.membership_id}
            >
              <div>
                <strong>{workspace.organization_id}</strong>
                <span>{workspace.status}</span>
                <span>{workspace.roles.join(', ')}</span>
              </div>
              <button
                type="button"
                onClick={() => onSelectWorkspace(workspace.organization_id)}
                aria-label={`Select workspace ${workspace.organization_id}`}
              >
                Select
              </button>
            </li>
          ))}
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

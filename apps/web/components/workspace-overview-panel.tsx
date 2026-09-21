'use client';

import { useEffect, useState } from 'react';

import { requestWorkspaceBootstrap } from '../lib/workspace-bootstrap-client';
import {
  loadingWorkspaceOverviewView,
  workspaceOverviewSelectionRequiredView,
  workspaceOverviewView,
  type WorkspaceOverviewView,
} from '../lib/workspace-overview-panel-state';

export interface WorkspaceOverviewPanelProps {
  readonly organizationId: string | null;
}

export function WorkspaceOverviewPanel({
  organizationId,
}: WorkspaceOverviewPanelProps) {
  const [view, setView] = useState<WorkspaceOverviewView>(() =>
    organizationId === null
      ? workspaceOverviewSelectionRequiredView()
      : loadingWorkspaceOverviewView(),
  );

  useEffect(() => {
    if (organizationId === null) {
      setView(workspaceOverviewSelectionRequiredView());
      return;
    }

    let cancelled = false;
    setView(loadingWorkspaceOverviewView());

    void requestWorkspaceBootstrap(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then(
      (result) => {
        if (!cancelled) {
          setView(workspaceOverviewView(result));
        }
      },
      () => {
        if (!cancelled) {
          setView(workspaceOverviewView({ status: 'unavailable' }));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return (
    <section
      className="area-card workspace-overview-panel"
      aria-labelledby="workspace-access-title"
      aria-busy={view.badge === 'Loading'}
    >
      <p className="eyebrow">Workspace access</p>
      <h3 id="workspace-access-title">{view.heading}</h3>
      <p>{view.description}</p>
      <span
        className="empty-state-badge"
        data-tone={view.tone}
        role="status"
        aria-live="polite"
      >
        {view.badge}
      </span>

      {view.organizationId !== null ? (
        <dl className="workspace-access-summary">
          <div>
            <dt>Organization</dt>
            <dd>{view.organizationId}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>{view.roles.join(', ')}</dd>
          </div>
          <div>
            <dt>Permissions</dt>
            <dd>{view.permissions.join(', ')}</dd>
          </div>
        </dl>
      ) : null}

      {view.unloadedAreas.length > 0 ? (
        <div className="workspace-unloaded-areas">
          <strong>Still unloaded by bootstrap contract</strong>
          <ul>
            {view.unloadedAreas.map((area) => (
              <li key={area}>{area}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

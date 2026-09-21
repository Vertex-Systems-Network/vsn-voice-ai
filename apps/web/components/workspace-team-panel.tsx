'use client';

import { useEffect, useState } from 'react';

import { requestWorkspaceTeam } from '../lib/workspace-team-client';
import {
  loadingWorkspaceTeamPanelView,
  workspaceTeamPanelView,
  type WorkspaceTeamPanelView,
} from '../lib/workspace-team-panel-state';

export interface WorkspaceTeamPanelProps {
  readonly organizationId: string;
}

export function WorkspaceTeamPanel({
  organizationId,
}: WorkspaceTeamPanelProps) {
  const [view, setView] = useState<WorkspaceTeamPanelView>(() =>
    loadingWorkspaceTeamPanelView(),
  );

  useEffect(() => {
    let cancelled = false;
    setView(loadingWorkspaceTeamPanelView());

    void requestWorkspaceTeam(globalThis.fetch.bind(globalThis), organizationId).then(
      (result) => {
        if (!cancelled) {
          setView(workspaceTeamPanelView(result));
        }
      },
      () => {
        if (!cancelled) {
          setView(
            workspaceTeamPanelView({ status: 'unavailable' }),
          );
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return (
    <section
      className="area-card workspace-team-panel"
      id="team"
      aria-labelledby="team-title"
      aria-busy={view.badge === 'Loading'}
    >
      <p className="eyebrow">Organization</p>
      <h3 id="team-title">{view.heading}</h3>
      <p>{view.description}</p>
      <span
        className="empty-state-badge"
        data-tone={view.tone}
        role="status"
        aria-live="polite"
      >
        {view.badge}
      </span>

      {view.members.length > 0 ? (
        <ul className="team-member-list" aria-label="Workspace team memberships">
          {view.members.map((member, index) => (
            <li className="team-member-row" key={`${member.status}-${index}`}>
              <div>
                <strong>Team membership</strong>
                <span>{member.status}</span>
              </div>
              <span>{member.roles.join(', ')}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {view.hasMore ? (
        <p className="team-member-limit-note" role="note">
          This panel is intentionally bounded to the first 200 memberships.
        </p>
      ) : null}
    </section>
  );
}

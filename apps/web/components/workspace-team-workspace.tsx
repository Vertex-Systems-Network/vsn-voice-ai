'use client';

import { useState } from 'react';

import { WorkspaceDirectoryPanel } from './workspace-directory-panel';
import { WorkspaceTeamPanel } from './workspace-team-panel';

export function WorkspaceTeamWorkspace() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  return (
    <>
      <WorkspaceDirectoryPanel onSelectWorkspace={setOrganizationId} />
      {organizationId === null ? (
        <section
          className="area-card workspace-team-panel"
          id="team"
          aria-labelledby="team-title"
        >
          <p className="eyebrow">Organization team</p>
          <h3 id="team-title">Select a workspace first</h3>
          <p>
            Team data stays unloaded until you explicitly choose one of your
            authenticated organization memberships.
          </p>
          <span className="empty-state-badge" role="status" aria-live="polite">
            No workspace selected
          </span>
        </section>
      ) : (
        <WorkspaceTeamPanel organizationId={organizationId} />
      )}
    </>
  );
}

'use client';

import { useCallback, useState } from 'react';

import type { WorkspaceSessionState } from '../lib/workspace-session-state';

import { WorkspaceDesktopLinkPanel } from './workspace-desktop-link-panel';
import { WorkspaceDirectoryPanel } from './workspace-directory-panel';
import { WorkspaceNotificationPreferencesPanel } from './workspace-notification-preferences-panel';
import { WorkspaceOverviewPanel } from './workspace-overview-panel';
import { WorkspaceProfilePanel } from './workspace-profile-panel';
import { WorkspaceTeamPanel } from './workspace-team-panel';

export interface WorkspaceTeamWorkspaceProps {
  readonly onSessionStateChange: (state: WorkspaceSessionState) => void;
}

export function WorkspaceTeamWorkspace({
  onSessionStateChange,
}: WorkspaceTeamWorkspaceProps) {
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const handleWorkspaceSelectionInvalidated = useCallback(() => {
    setOrganizationId(null);
  }, []);

  const handleSessionStateChange = useCallback(
    (state: WorkspaceSessionState) => {
      if (state === 'signed_out' || state === 'unavailable') {
        setOrganizationId(null);
      }
      onSessionStateChange(state);
    },
    [onSessionStateChange],
  );

  return (
    <>
      <WorkspaceDirectoryPanel
        selectedOrganizationId={organizationId}
        onSelectWorkspace={setOrganizationId}
        onInvalidateWorkspaceSelection={handleWorkspaceSelectionInvalidated}
        onSessionStateChange={handleSessionStateChange}
      />
      <WorkspaceOverviewPanel organizationId={organizationId} />
      <WorkspaceDesktopLinkPanel organizationId={organizationId} />
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
      <WorkspaceProfilePanel organizationId={organizationId} />
      <WorkspaceNotificationPreferencesPanel organizationId={organizationId} />
    </>
  );
}

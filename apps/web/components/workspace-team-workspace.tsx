'use client';

import { useCallback, useState } from 'react';

import {
  workspaceAuthorizedOrganizationId,
  type WorkspaceSessionState,
} from '../lib/workspace-session-state';

import { WorkspaceDesktopLinkPanel } from './workspace-desktop-link-panel';
import { WorkspaceDirectoryPanel } from './workspace-directory-panel';
import { WorkspaceNotificationPreferencesPanel } from './workspace-notification-preferences-panel';
import { WorkspaceOrganizationProfilePanel } from './workspace-organization-profile-panel';
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
  const [directorySessionState, setDirectorySessionState] =
    useState<WorkspaceSessionState>('checking');
  const authorizedOrganizationId = workspaceAuthorizedOrganizationId(
    directorySessionState,
    organizationId,
  );

  const handleWorkspaceSelectionInvalidated = useCallback(() => {
    setOrganizationId(null);
  }, []);

  const handleSessionStateChange = useCallback(
    (state: WorkspaceSessionState) => {
      setDirectorySessionState(state);
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
      <WorkspaceOverviewPanel
        key={`overview-${authorizedOrganizationId ?? 'unselected'}`}
        organizationId={authorizedOrganizationId}
      />
      <WorkspaceDesktopLinkPanel
        key={`desktop-${authorizedOrganizationId ?? 'unselected'}`}
        organizationId={authorizedOrganizationId}
      />
      {authorizedOrganizationId === null ? (
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
        <WorkspaceTeamPanel
          key={authorizedOrganizationId}
          organizationId={authorizedOrganizationId}
        />
      )}
      <WorkspaceOrganizationProfilePanel
        key={`organization-${authorizedOrganizationId ?? 'unselected'}`}
        organizationId={authorizedOrganizationId}
      />
      <WorkspaceProfilePanel
        key={`profile-${authorizedOrganizationId ?? 'unselected'}`}
        organizationId={authorizedOrganizationId}
      />
      <WorkspaceNotificationPreferencesPanel
        key={`preferences-${authorizedOrganizationId ?? 'unselected'}`}
        organizationId={authorizedOrganizationId}
      />
    </>
  );
}

import type {
  WorkspaceMembershipStatus,
  WorkspaceTeamLoadResult,
} from './workspace-team-client';

export type WorkspaceTeamPanelTone = 'neutral' | 'ready' | 'warning';

export interface WorkspaceTeamMemberView {
  readonly status: WorkspaceMembershipStatus;
  readonly roles: readonly string[];
}

export interface WorkspaceTeamPanelView {
  readonly heading: string;
  readonly description: string;
  readonly badge: string;
  readonly tone: WorkspaceTeamPanelTone;
  readonly members: readonly WorkspaceTeamMemberView[];
  readonly hasMore: boolean;
}

export function loadingWorkspaceTeamPanelView(): WorkspaceTeamPanelView {
  return Object.freeze({
    heading: 'Loading team',
    description: 'Checking tenant-authorized membership data.',
    badge: 'Loading',
    tone: 'neutral' as const,
    members: Object.freeze([]),
    hasMore: false,
  });
}

export function workspaceTeamPanelView(
  result: WorkspaceTeamLoadResult,
): WorkspaceTeamPanelView {
  switch (result.status) {
    case 'ready': {
      const memberCount = result.data.members.length;
      return Object.freeze({
        heading:
          memberCount === 0
            ? 'No team members to show'
            : `${memberCount} team ${memberCount === 1 ? 'member' : 'members'}`,
        description: result.data.has_more
          ? 'Showing the first 200 authorized memberships. Additional members are available.'
          : 'Tenant-authorized membership and role data is loaded.',
        badge: 'Tenant data',
        tone: 'ready' as const,
        members: Object.freeze(
          result.data.members.map((member) =>
            Object.freeze({
              status: member.status,
              roles: Object.freeze([...member.roles]),
            }),
          ),
        ),
        hasMore: result.data.has_more,
      });
    }
    case 'authentication_required':
      return Object.freeze({
        heading: 'Authentication required',
        description: 'Sign in through the approved workspace identity flow to view team data.',
        badge: 'Signed out',
        tone: 'warning' as const,
        members: Object.freeze([]),
        hasMore: false,
      });
    case 'forbidden':
      return Object.freeze({
        heading: 'Team access unavailable',
        description: 'Your current workspace membership does not permit team access.',
        badge: 'Restricted',
        tone: 'warning' as const,
        members: Object.freeze([]),
        hasMore: false,
      });
    case 'invalid_response':
    case 'unavailable':
      return Object.freeze({
        heading: 'Team data unavailable',
        description: 'Team data could not be loaded safely. No unverified membership data is shown.',
        badge: 'Unavailable',
        tone: 'warning' as const,
        members: Object.freeze([]),
        hasMore: false,
      });
  }
}

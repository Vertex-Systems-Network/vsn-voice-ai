'use client';

import { useEffect, useRef, useState } from 'react';

import { requestWorkspaceBootstrap } from '../lib/workspace-bootstrap-client';
import {
  updateWorkspaceTeamMemberStatus,
  type WorkspaceTeamManagedStatus,
} from '../lib/workspace-team-member-status-client';
import { requestWorkspaceTeam } from '../lib/workspace-team-client';
import {
  loadingWorkspaceTeamPanelView,
  workspaceTeamPanelView,
  type WorkspaceTeamPanelView,
} from '../lib/workspace-team-panel-state';

export interface WorkspaceTeamPanelProps {
  readonly organizationId: string;
}

interface TeamActionTarget {
  readonly membershipId: string;
  readonly manageable: boolean;
}

function isOrdinaryManageableMember(
  status: string,
  roles: readonly string[],
): boolean {
  return (
    (status === 'active' || status === 'suspended') &&
    roles.length === 1 &&
    roles[0] === 'member'
  );
}

export function WorkspaceTeamPanel({
  organizationId,
}: WorkspaceTeamPanelProps) {
  const [view, setView] = useState<WorkspaceTeamPanelView>(() =>
    loadingWorkspaceTeamPanelView(),
  );
  const [canManage, setCanManage] = useState(false);
  const [actionTargets, setActionTargets] = useState<
    readonly TeamActionTarget[]
  >(Object.freeze([]));
  const [busyMembershipId, setBusyMembershipId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const activeOrganizationId = useRef(organizationId);
  activeOrganizationId.current = organizationId;

  useEffect(() => {
    let cancelled = false;
    setView(loadingWorkspaceTeamPanelView());
    setCanManage(false);
    setActionTargets(Object.freeze([]));
    setBusyMembershipId(null);
    setActionMessage('');

    void requestWorkspaceTeam(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then(
      (result) => {
        if (cancelled) return;
        setView(workspaceTeamPanelView(result));
        if (result.status === 'ready') {
          setActionTargets(
            Object.freeze(
              result.data.members.map((member) =>
                Object.freeze({
                  membershipId: member.membership_id,
                  manageable: isOrdinaryManageableMember(
                    member.status,
                    member.roles,
                  ),
                }),
              ),
            ),
          );
        }
      },
      () => {
        if (!cancelled) {
          setView(workspaceTeamPanelView({ status: 'unavailable' }));
          setActionTargets(Object.freeze([]));
        }
      },
    );

    void requestWorkspaceBootstrap(
      globalThis.fetch.bind(globalThis),
      organizationId,
    ).then((result) => {
      if (cancelled) return;
      setCanManage(
        result.status === 'ready' &&
          result.data.authorization.permissions.includes('team.manage'),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function handleStatusChange(
    index: number,
    nextStatus: WorkspaceTeamManagedStatus,
  ): Promise<void> {
    const target = actionTargets[index];
    if (
      !canManage ||
      target === undefined ||
      !target.manageable ||
      busyMembershipId !== null
    ) {
      return;
    }

    const requestOrganizationId = organizationId;
    setBusyMembershipId(target.membershipId);
    setActionMessage('');

    const result = await updateWorkspaceTeamMemberStatus(
      globalThis.fetch.bind(globalThis),
      requestOrganizationId,
      target.membershipId,
      nextStatus,
    );
    if (activeOrganizationId.current !== requestOrganizationId) {
      return;
    }

    setBusyMembershipId(null);
    if (result.status !== 'ready') {
      setActionMessage('Team member status was not changed.');
      return;
    }

    setView((current) =>
      Object.freeze({
        ...current,
        members: Object.freeze(
          current.members.map((member, memberIndex) =>
            memberIndex === index
              ? Object.freeze({ ...member, status: result.data.status })
              : member,
          ),
        ),
      }),
    );
    setActionMessage(
      result.data.status === 'suspended'
        ? 'Team member suspended.'
        : 'Team member reactivated.',
    );
  }

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
          {view.members.map((member, index) => {
            const target = actionTargets[index];
            const showControl =
              canManage && target?.manageable === true;
            const label = member.displayName ?? 'team member';
            const nextStatus: WorkspaceTeamManagedStatus =
              member.status === 'active' ? 'suspended' : 'active';
            return (
              <li
                className="team-member-row"
                key={target?.membershipId ?? `${member.status}-${index}`}
              >
                <div>
                  <strong>{member.displayName ?? 'Team member'}</strong>
                  <span>{member.status}</span>
                </div>
                <span>{member.roles.join(', ')}</span>
                {showControl ? (
                  <button
                    type="button"
                    className="team-member-status-action"
                    disabled={busyMembershipId !== null}
                    onClick={() => void handleStatusChange(index, nextStatus)}
                  >
                    {busyMembershipId === target.membershipId
                      ? 'Saving…'
                      : member.status === 'active'
                        ? `Suspend ${label}`
                        : `Reactivate ${label}`}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <span
        className="team-member-action-status"
        role="status"
        aria-live="polite"
      >
        {actionMessage}
      </span>

      {view.hasMore ? (
        <p className="team-member-limit-note" role="note">
          This panel is intentionally bounded to the first 200 memberships.
        </p>
      ) : null}
    </section>
  );
}

import type { PostgresQueryClient } from '../organizations/postgres-organization-membership-resolver.js';
import {
  type ManagedWorkspaceTeamMemberStatus,
  type WorkspaceTeamMemberStatusRepository,
  type WorkspaceTeamMemberStatusResponse,
  WorkspaceTeamMemberStatusDataIntegrityError,
} from './workspace-team-member-status-repository.js';

interface WorkspaceTeamMemberStatusRow {
  readonly organization_id: unknown;
  readonly membership_id: unknown;
  readonly status: unknown;
}

const allowedOrdinaryPermissions = [
  'conversation.read',
  'team.read',
  'device.link',
] as const;

const updateSql = `
UPDATE organization_memberships
SET
  status = $4,
  updated_at = now()
WHERE organization_id = $1
  AND membership_id = $2
  AND subject_id <> $3
  AND status IN ('active', 'suspended')
  AND status <> $4
  AND roles = ARRAY['member']::text[]
  AND permissions <@ $5::text[]
RETURNING
  organization_id,
  membership_id,
  status
`.trim();

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function isManagedStatus(
  value: unknown,
): value is ManagedWorkspaceTeamMemberStatus {
  return value === 'active' || value === 'suspended';
}

function requireIdentifier(value: string, field: string): void {
  if (!isIdentifier(value)) {
    throw new TypeError(`${field} is invalid`);
  }
}

export class PostgresWorkspaceTeamMemberStatusRepository
  implements WorkspaceTeamMemberStatusRepository
{
  public constructor(private readonly client: PostgresQueryClient) {}

  public async changeOrdinaryMemberStatus(
    actorSubjectId: string,
    organizationId: string,
    membershipId: string,
    status: ManagedWorkspaceTeamMemberStatus,
  ): Promise<WorkspaceTeamMemberStatusResponse | null> {
    requireIdentifier(actorSubjectId, 'actorSubjectId');
    requireIdentifier(organizationId, 'organizationId');
    requireIdentifier(membershipId, 'membershipId');
    if (!isManagedStatus(status)) {
      throw new TypeError('status is invalid');
    }

    const result = await this.client.query<WorkspaceTeamMemberStatusRow>(
      updateSql,
      [
        organizationId,
        membershipId,
        actorSubjectId,
        status,
        allowedOrdinaryPermissions,
      ],
    );
    if (result.rows.length === 0) {
      return null;
    }
    if (result.rows.length !== 1 || result.rows[0] === undefined) {
      throw new WorkspaceTeamMemberStatusDataIntegrityError(
        'workspace team member status persistence returned ambiguous data',
      );
    }

    const row = result.rows[0];
    if (
      !isIdentifier(row.organization_id) ||
      !isIdentifier(row.membership_id) ||
      !isManagedStatus(row.status) ||
      row.organization_id !== organizationId ||
      row.membership_id !== membershipId ||
      row.status !== status
    ) {
      throw new WorkspaceTeamMemberStatusDataIntegrityError(
        'workspace team member status persistence returned invalid data',
      );
    }

    return Object.freeze({
      schema_version: 1 as const,
      organization_id: row.organization_id,
      membership_id: row.membership_id,
      status: row.status,
    });
  }
}

export function getWorkspaceTeamMemberStatusUpdateSql(): string {
  return updateSql;
}

export function getOrdinaryTeamMemberPermissionAllowlist(): readonly string[] {
  return allowedOrdinaryPermissions;
}

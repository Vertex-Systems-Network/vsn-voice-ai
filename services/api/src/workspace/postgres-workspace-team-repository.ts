import type { MembershipStatus } from '../organizations/organization-membership.js';
import type { PostgresQueryClient } from '../organizations/postgres-organization-membership-resolver.js';
import {
  MAX_WORKSPACE_TEAM_MEMBERS,
  type WorkspaceTeamMember,
  type WorkspaceTeamRepository,
  type WorkspaceTeamSnapshot,
  WorkspaceTeamDataIntegrityError,
} from './workspace-team-repository.js';

interface WorkspaceTeamRow {
  readonly membership_id: unknown;
  readonly subject_id: unknown;
  readonly organization_id: unknown;
  readonly status: unknown;
  readonly roles: unknown;
}

const authorityTokenPattern = /^[a-z][a-z0-9._:-]*$/;
const membershipStatuses = new Set<MembershipStatus>([
  'active',
  'invited',
  'suspended',
]);

const workspaceTeamLookupSql = `
SELECT
  membership_id,
  subject_id,
  organization_id,
  status,
  roles
FROM organization_memberships
WHERE organization_id = $1
ORDER BY membership_id ASC
LIMIT $2
`.trim();

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value;
}

function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && membershipStatuses.has(value as MembershipStatus);
}

function isRoles(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return false;
  }

  const seen = new Set<string>();
  for (const role of value) {
    if (
      typeof role !== 'string' ||
      role.length < 1 ||
      role.length > 128 ||
      !authorityTokenPattern.test(role) ||
      seen.has(role)
    ) {
      return false;
    }
    seen.add(role);
  }
  return true;
}

function toTeamMember(
  row: WorkspaceTeamRow,
  expectedOrganizationId: string,
): WorkspaceTeamMember {
  if (
    !isBoundedIdentifier(row.membership_id) ||
    !isBoundedIdentifier(row.subject_id) ||
    !isBoundedIdentifier(row.organization_id) ||
    row.organization_id !== expectedOrganizationId ||
    !isMembershipStatus(row.status) ||
    !isRoles(row.roles)
  ) {
    throw new WorkspaceTeamDataIntegrityError(
      'workspace team persistence returned an invalid row',
    );
  }

  return Object.freeze({
    schema_version: 1 as const,
    membership_id: row.membership_id,
    subject_id: row.subject_id,
    status: row.status,
    roles: Object.freeze([...row.roles]),
  });
}

export class PostgresWorkspaceTeamRepository implements WorkspaceTeamRepository {
  public constructor(private readonly client: PostgresQueryClient) {}

  public async listByOrganization(
    organizationId: string,
  ): Promise<WorkspaceTeamSnapshot> {
    const normalizedOrganizationId = organizationId.trim();
    if (!isBoundedIdentifier(normalizedOrganizationId)) {
      throw new TypeError('organizationId is invalid');
    }

    const result = await this.client.query<WorkspaceTeamRow>(
      workspaceTeamLookupSql,
      [normalizedOrganizationId, MAX_WORKSPACE_TEAM_MEMBERS + 1],
    );

    const hasMore = result.rows.length > MAX_WORKSPACE_TEAM_MEMBERS;
    const boundedRows = result.rows.slice(0, MAX_WORKSPACE_TEAM_MEMBERS);
    const seenMembershipIds = new Set<string>();
    const seenSubjectIds = new Set<string>();
    const members = boundedRows.map((row) => {
      const member = toTeamMember(row, normalizedOrganizationId);
      if (
        seenMembershipIds.has(member.membership_id) ||
        seenSubjectIds.has(member.subject_id)
      ) {
        throw new WorkspaceTeamDataIntegrityError(
          'workspace team persistence returned duplicate membership data',
        );
      }
      seenMembershipIds.add(member.membership_id);
      seenSubjectIds.add(member.subject_id);
      return member;
    });

    return Object.freeze({
      schema_version: 1 as const,
      organization_id: normalizedOrganizationId,
      members: Object.freeze(members),
      has_more: hasMore,
    });
  }
}

export function getWorkspaceTeamLookupSql(): string {
  return workspaceTeamLookupSql;
}

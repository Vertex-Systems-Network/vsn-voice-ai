import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import {
  MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY,
  type OrganizationMembershipDirectory,
  OrganizationMembershipDirectoryDataIntegrityError,
  type OrganizationMembershipDirectorySnapshot,
} from './organization-membership-directory.js';
import type {
  MembershipStatus,
  OrganizationMembership,
} from './organization-membership.js';
import type { OrganizationMembershipResolver } from './organization-membership-resolver.js';

export interface PostgresQueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostgresQueryClient {
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
}

interface PostgresMembershipRow {
  readonly membership_id: unknown;
  readonly subject_id: unknown;
  readonly organization_id: unknown;
  readonly status: unknown;
  readonly roles: unknown;
  readonly permissions: unknown;
}

interface PostgresDirectoryMembershipRow extends PostgresMembershipRow {
  readonly display_name: unknown;
}

const membershipLookupSql = `
SELECT
  membership_id,
  subject_id,
  organization_id,
  status,
  roles,
  permissions
FROM organization_memberships
WHERE subject_id = $1
  AND organization_id = $2
LIMIT 2
`.trim();

const membershipDirectorySql = `
SELECT
  m.membership_id,
  m.subject_id,
  m.organization_id,
  m.status,
  m.roles,
  m.permissions,
  o.display_name
FROM organization_memberships AS m
LEFT JOIN workspace_organizations AS o
  ON o.organization_id = m.organization_id
WHERE m.subject_id = $1
ORDER BY m.organization_id ASC
LIMIT $2
`.trim();

const authorityTokenPattern = /^[a-z][a-z0-9._:-]*$/;
const membershipStatuses = new Set<MembershipStatus>([
  'active',
  'invited',
  'suspended',
]);

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value;
}

function isOrganizationDisplayName(
  value: unknown,
): value is string | null {
  return (
    value === null ||
    (
      typeof value === 'string' &&
      value.length <= 100 &&
      value.trim() === value &&
      !/[\u0000-\u001F\u007F]/u.test(value)
    )
  );
}

function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && membershipStatuses.has(value as MembershipStatus);
}

function isAuthorityTokens(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumLength: number,
): value is string[] {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) {
    return false;
  }

  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== 'string' ||
      entry.length < 1 ||
      entry.length > maximumLength ||
      !authorityTokenPattern.test(entry) ||
      seen.has(entry)
    ) {
      return false;
    }
    seen.add(entry);
  }
  return true;
}

function toMembership(
  row: PostgresMembershipRow,
  expectedSubjectId: string,
  expectedOrganizationId?: string,
): OrganizationMembership | null {
  if (
    !isBoundedIdentifier(row.membership_id) ||
    !isBoundedIdentifier(row.subject_id) ||
    !isBoundedIdentifier(row.organization_id) ||
    row.subject_id !== expectedSubjectId ||
    (expectedOrganizationId !== undefined &&
      row.organization_id !== expectedOrganizationId) ||
    !isMembershipStatus(row.status) ||
    !isAuthorityTokens(row.roles, 1, 32, 128) ||
    !isAuthorityTokens(row.permissions, 0, 256, 160)
  ) {
    return null;
  }

  return Object.freeze({
    membershipId: row.membership_id,
    subjectId: row.subject_id,
    organizationId: row.organization_id,
    status: row.status,
    roles: Object.freeze([...row.roles]),
    permissions: Object.freeze([...row.permissions]),
  });
}

/**
 * PostgreSQL-backed membership resolver and subject-bound membership directory
 * for the owner-approved data stack. The connection/pool is injected so
 * credentials and deployment-specific pool configuration remain outside the
 * tenant authorization domain layer.
 */
export class PostgresOrganizationMembershipResolver
  implements OrganizationMembershipResolver, OrganizationMembershipDirectory
{
  public constructor(private readonly client: PostgresQueryClient) {}

  public async resolve(
    principal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    const subjectId = principal.subjectId.trim();
    const normalizedOrganizationId = organizationId.trim();
    if (
      !isBoundedIdentifier(subjectId) ||
      !isBoundedIdentifier(normalizedOrganizationId)
    ) {
      return null;
    }

    const result = await this.client.query<PostgresMembershipRow>(
      membershipLookupSql,
      [subjectId, normalizedOrganizationId],
    );

    if (result.rows.length !== 1) {
      return null;
    }

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    return toMembership(row, subjectId, normalizedOrganizationId);
  }

  public async listForPrincipal(
    principal: AuthenticatedPrincipal,
  ): Promise<OrganizationMembershipDirectorySnapshot> {
    const subjectId = principal.subjectId.trim();
    if (!isBoundedIdentifier(subjectId)) {
      throw new OrganizationMembershipDirectoryDataIntegrityError(
        'authenticated subject identifier is invalid',
      );
    }

    const result = await this.client.query<PostgresDirectoryMembershipRow>(
      membershipDirectorySql,
      [subjectId, MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY + 1],
    );
    const hasMore =
      result.rows.length > MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY;
    const boundedRows = result.rows.slice(
      0,
      MAX_ORGANIZATION_MEMBERSHIPS_PER_DIRECTORY,
    );
    const seenMembershipIds = new Set<string>();
    const seenOrganizationIds = new Set<string>();
    const memberships = boundedRows.map((row) => {
      const membership = toMembership(row, subjectId);
      if (
        membership === null ||
        !isOrganizationDisplayName(row.display_name)
      ) {
        throw new OrganizationMembershipDirectoryDataIntegrityError(
          'membership directory persistence returned an invalid row',
        );
      }
      const organizationDisplayName =
        row.display_name === null || row.display_name === ''
          ? null
          : row.display_name;
      if (
        seenMembershipIds.has(membership.membershipId) ||
        seenOrganizationIds.has(membership.organizationId)
      ) {
        throw new OrganizationMembershipDirectoryDataIntegrityError(
          'membership directory persistence returned duplicate membership data',
        );
      }
      seenMembershipIds.add(membership.membershipId);
      seenOrganizationIds.add(membership.organizationId);
      return Object.freeze({
        ...membership,
        organizationDisplayName,
      });
    });

    return Object.freeze({
      memberships: Object.freeze(memberships),
      hasMore,
    });
  }
}

export function getOrganizationMembershipLookupSql(): string {
  return membershipLookupSql;
}

export function getOrganizationMembershipDirectorySql(): string {
  return membershipDirectorySql;
}

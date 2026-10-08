import type { PostgresQueryClient } from '../organizations/postgres-organization-membership-resolver.js';
import {
  type WorkspaceProfileRepository,
  type WorkspaceProfileValues,
  WorkspaceProfileDataIntegrityError,
} from './workspace-profile-repository.js';

interface WorkspaceProfileRow {
  readonly subject_id: unknown;
  readonly organization_id: unknown;
  readonly display_name: unknown;
  readonly job_title: unknown;
}

const selectSql = `
SELECT
  subject_id,
  organization_id,
  display_name,
  job_title
FROM workspace_profiles
WHERE organization_id = $1
  AND subject_id = $2
LIMIT 2
`.trim();

const upsertSql = `
INSERT INTO workspace_profiles (
  organization_id,
  subject_id,
  display_name,
  job_title
)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, subject_id)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  job_title = EXCLUDED.job_title,
  updated_at = now()
RETURNING
  subject_id,
  organization_id,
  display_name,
  job_title
`.trim();

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function isProfileText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function requireScope(subjectId: string, organizationId: string): void {
  if (!isBoundedIdentifier(subjectId) || !isBoundedIdentifier(organizationId)) {
    throw new TypeError('workspace profile scope is invalid');
  }
}

function requireProfile(profile: WorkspaceProfileValues): void {
  if (
    !isProfileText(profile.display_name, 80) ||
    !isProfileText(profile.job_title, 120)
  ) {
    throw new TypeError('workspace profile values are invalid');
  }
}

function toProfile(
  row: WorkspaceProfileRow,
  expectedSubjectId: string,
  expectedOrganizationId: string,
): WorkspaceProfileValues {
  if (
    !isBoundedIdentifier(row.subject_id) ||
    !isBoundedIdentifier(row.organization_id) ||
    row.subject_id !== expectedSubjectId ||
    row.organization_id !== expectedOrganizationId ||
    !isProfileText(row.display_name, 80) ||
    !isProfileText(row.job_title, 120)
  ) {
    throw new WorkspaceProfileDataIntegrityError(
      'workspace profile persistence returned invalid data',
    );
  }

  return Object.freeze({
    display_name: row.display_name,
    job_title: row.job_title,
  });
}

export class PostgresWorkspaceProfileRepository
  implements WorkspaceProfileRepository
{
  public constructor(private readonly client: PostgresQueryClient) {}

  public async getProfile(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceProfileValues | null> {
    requireScope(subjectId, organizationId);
    const result = await this.client.query<WorkspaceProfileRow>(selectSql, [
      organizationId,
      subjectId,
    ]);
    if (result.rows.length === 0) {
      return null;
    }
    if (result.rows.length !== 1 || result.rows[0] === undefined) {
      throw new WorkspaceProfileDataIntegrityError(
        'workspace profile persistence returned duplicate or invalid rows',
      );
    }
    return toProfile(result.rows[0], subjectId, organizationId);
  }

  public async putProfile(
    subjectId: string,
    organizationId: string,
    profile: WorkspaceProfileValues,
  ): Promise<WorkspaceProfileValues> {
    requireScope(subjectId, organizationId);
    requireProfile(profile);
    const result = await this.client.query<WorkspaceProfileRow>(upsertSql, [
      organizationId,
      subjectId,
      profile.display_name,
      profile.job_title,
    ]);
    if (result.rows.length !== 1 || result.rows[0] === undefined) {
      throw new WorkspaceProfileDataIntegrityError(
        'workspace profile persistence did not return one row',
      );
    }
    return toProfile(result.rows[0], subjectId, organizationId);
  }
}

export function getWorkspaceProfileSelectSql(): string {
  return selectSql;
}

export function getWorkspaceProfileUpsertSql(): string {
  return upsertSql;
}

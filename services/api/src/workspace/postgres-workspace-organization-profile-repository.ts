import type { PostgresQueryClient } from '../organizations/postgres-organization-membership-resolver.js';
import {
  type WorkspaceOrganizationProfileRepository,
  type WorkspaceOrganizationProfileValues,
  WorkspaceOrganizationProfileDataIntegrityError,
} from './workspace-organization-profile-repository.js';

interface WorkspaceOrganizationProfileRow {
  readonly organization_id: unknown;
  readonly display_name: unknown;
}

const selectSql = `
SELECT
  organization_id,
  display_name
FROM workspace_organizations
WHERE organization_id = $1
LIMIT 2
`.trim();

const upsertSql = `
INSERT INTO workspace_organizations (
  organization_id,
  display_name
)
VALUES ($1, $2)
ON CONFLICT (organization_id)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  updated_at = now()
RETURNING
  organization_id,
  display_name
`.trim();

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function isDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 100 &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function requireOrganizationId(value: string): void {
  if (!isIdentifier(value)) {
    throw new TypeError('organizationId is invalid');
  }
}

function requireProfile(profile: WorkspaceOrganizationProfileValues): void {
  if (!isDisplayName(profile.display_name)) {
    throw new TypeError('workspace organization profile is invalid');
  }
}

function toProfile(
  row: WorkspaceOrganizationProfileRow,
  expectedOrganizationId: string,
): WorkspaceOrganizationProfileValues {
  if (
    !isIdentifier(row.organization_id) ||
    row.organization_id !== expectedOrganizationId ||
    !isDisplayName(row.display_name)
  ) {
    throw new WorkspaceOrganizationProfileDataIntegrityError(
      'workspace organization profile persistence returned invalid data',
    );
  }

  return Object.freeze({ display_name: row.display_name });
}

export class PostgresWorkspaceOrganizationProfileRepository
  implements WorkspaceOrganizationProfileRepository
{
  public constructor(private readonly client: PostgresQueryClient) {}

  public async getOrganizationProfile(
    organizationId: string,
  ): Promise<WorkspaceOrganizationProfileValues | null> {
    requireOrganizationId(organizationId);
    const result = await this.client.query<WorkspaceOrganizationProfileRow>(
      selectSql,
      [organizationId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    if (result.rows.length !== 1 || result.rows[0] === undefined) {
      throw new WorkspaceOrganizationProfileDataIntegrityError(
        'workspace organization profile persistence returned duplicate data',
      );
    }
    return toProfile(result.rows[0], organizationId);
  }

  public async putOrganizationProfile(
    organizationId: string,
    profile: WorkspaceOrganizationProfileValues,
  ): Promise<WorkspaceOrganizationProfileValues> {
    requireOrganizationId(organizationId);
    requireProfile(profile);
    const result = await this.client.query<WorkspaceOrganizationProfileRow>(
      upsertSql,
      [organizationId, profile.display_name],
    );
    if (result.rows.length !== 1 || result.rows[0] === undefined) {
      throw new WorkspaceOrganizationProfileDataIntegrityError(
        'workspace organization profile persistence did not return one row',
      );
    }
    return toProfile(result.rows[0], organizationId);
  }
}

export function getWorkspaceOrganizationProfileSelectSql(): string {
  return selectSql;
}

export function getWorkspaceOrganizationProfileUpsertSql(): string {
  return upsertSql;
}

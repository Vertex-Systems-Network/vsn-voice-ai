import type { PostgresQueryClient } from '../organizations/postgres-organization-membership-resolver.js';
import {
  type WorkspaceNotificationPreferenceValues,
  type WorkspaceNotificationPreferencesRepository,
  WorkspaceNotificationPreferencesDataIntegrityError,
} from './workspace-notification-preferences-repository.js';

interface WorkspaceNotificationPreferencesRow {
  readonly subject_id: unknown;
  readonly organization_id: unknown;
  readonly meeting_reminders: unknown;
  readonly transcript_ready: unknown;
  readonly action_items: unknown;
  readonly desktop_link_events: unknown;
}

const selectSql = `
SELECT
  subject_id,
  organization_id,
  meeting_reminders,
  transcript_ready,
  action_items,
  desktop_link_events
FROM workspace_notification_preferences
WHERE organization_id = $1
  AND subject_id = $2
LIMIT 2
`.trim();

const upsertSql = `
INSERT INTO workspace_notification_preferences (
  organization_id,
  subject_id,
  meeting_reminders,
  transcript_ready,
  action_items,
  desktop_link_events
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (organization_id, subject_id)
DO UPDATE SET
  meeting_reminders = EXCLUDED.meeting_reminders,
  transcript_ready = EXCLUDED.transcript_ready,
  action_items = EXCLUDED.action_items,
  desktop_link_events = EXCLUDED.desktop_link_events,
  updated_at = now()
RETURNING
  subject_id,
  organization_id,
  meeting_reminders,
  transcript_ready,
  action_items,
  desktop_link_events
`.trim();

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function toPreferences(
  row: WorkspaceNotificationPreferencesRow,
  expectedSubjectId: string,
  expectedOrganizationId: string,
): WorkspaceNotificationPreferenceValues {
  if (
    !isBoundedIdentifier(row.subject_id) ||
    !isBoundedIdentifier(row.organization_id) ||
    row.subject_id !== expectedSubjectId ||
    row.organization_id !== expectedOrganizationId ||
    typeof row.meeting_reminders !== 'boolean' ||
    typeof row.transcript_ready !== 'boolean' ||
    typeof row.action_items !== 'boolean' ||
    typeof row.desktop_link_events !== 'boolean'
  ) {
    throw new WorkspaceNotificationPreferencesDataIntegrityError(
      'workspace notification preferences persistence returned invalid data',
    );
  }

  return Object.freeze({
    meeting_reminders: row.meeting_reminders,
    transcript_ready: row.transcript_ready,
    action_items: row.action_items,
    desktop_link_events: row.desktop_link_events,
  });
}

function requireScope(subjectId: string, organizationId: string): void {
  if (!isBoundedIdentifier(subjectId) || !isBoundedIdentifier(organizationId)) {
    throw new TypeError('workspace notification preference scope is invalid');
  }
}

export class PostgresWorkspaceNotificationPreferencesRepository
  implements WorkspaceNotificationPreferencesRepository
{
  public constructor(private readonly client: PostgresQueryClient) {}

  public async get(
    subjectId: string,
    organizationId: string,
  ): Promise<WorkspaceNotificationPreferenceValues | null> {
    requireScope(subjectId, organizationId);
    const result = await this.client.query<WorkspaceNotificationPreferencesRow>(
      selectSql,
      [organizationId, subjectId],
    );

    if (result.rows.length === 0) {
      return null;
    }
    if (result.rows.length !== 1) {
      throw new WorkspaceNotificationPreferencesDataIntegrityError(
        'workspace notification preferences persistence returned duplicate rows',
      );
    }
    const row = result.rows[0];
    if (row === undefined) {
      throw new WorkspaceNotificationPreferencesDataIntegrityError(
        'workspace notification preferences persistence returned invalid data',
      );
    }
    return toPreferences(row, subjectId, organizationId);
  }

  public async put(
    subjectId: string,
    organizationId: string,
    preferences: WorkspaceNotificationPreferenceValues,
  ): Promise<WorkspaceNotificationPreferenceValues> {
    requireScope(subjectId, organizationId);
    const result = await this.client.query<WorkspaceNotificationPreferencesRow>(
      upsertSql,
      [
        organizationId,
        subjectId,
        preferences.meeting_reminders,
        preferences.transcript_ready,
        preferences.action_items,
        preferences.desktop_link_events,
      ],
    );
    if (result.rows.length !== 1 || result.rows[0] === undefined) {
      throw new WorkspaceNotificationPreferencesDataIntegrityError(
        'workspace notification preferences persistence did not return one row',
      );
    }
    return toPreferences(result.rows[0], subjectId, organizationId);
  }
}

export function getWorkspaceNotificationPreferencesSelectSql(): string {
  return selectSql;
}

export function getWorkspaceNotificationPreferencesUpsertSql(): string {
  return upsertSql;
}

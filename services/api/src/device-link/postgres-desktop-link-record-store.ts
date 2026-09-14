import type { PostgresQueryClient } from '../organizations/postgres-organization-membership-resolver.js';
import type {
  DesktopLinkRecord,
  DesktopLinkRecordStore,
  DesktopLinkStatus,
} from './desktop-link-record.js';

interface PostgresDesktopLinkRow {
  readonly record_id: unknown;
  readonly token_digest: unknown;
  readonly subject_id: unknown;
  readonly organization_id: unknown;
  readonly device_id: unknown;
  readonly issued_at: unknown;
  readonly expires_at: unknown;
  readonly status: unknown;
  readonly consumed_at: unknown;
}

const insertDesktopLinkSql = `
INSERT INTO desktop_link_records (
  record_id,
  token_digest,
  subject_id,
  organization_id,
  device_id,
  issued_at,
  expires_at,
  status,
  consumed_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`.trim();

const getDesktopLinkSql = `
SELECT
  record_id,
  token_digest,
  subject_id,
  organization_id,
  device_id,
  issued_at,
  expires_at,
  status,
  consumed_at
FROM desktop_link_records
WHERE record_id = $1
LIMIT 2
`.trim();

const consumeDesktopLinkSql = `
UPDATE desktop_link_records
SET
  status = 'consumed',
  consumed_at = $3,
  updated_at = $3
WHERE record_id = $1
  AND token_digest = $2
  AND status = 'issued'
  AND issued_at <= $3
  AND expires_at > $3
RETURNING
  record_id,
  token_digest,
  subject_id,
  organization_id,
  device_id,
  issued_at,
  expires_at,
  status,
  consumed_at
`.trim();

const statuses = new Set<DesktopLinkStatus>([
  'issued',
  'consumed',
  'revoked',
  'expired',
]);
const sha256HexPattern = /^[0-9a-f]{64}$/;

function isBoundedIdentifier(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value.trim() === value;
}

function isStatus(value: unknown): value is DesktopLinkStatus {
  return typeof value === 'string' && statuses.has(value as DesktopLinkStatus);
}

function toIsoTimestamp(value: unknown): string | null {
  const parsed = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : null;
  if (parsed === null || !Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function toDesktopLinkRecord(
  row: PostgresDesktopLinkRow,
): DesktopLinkRecord | undefined {
  if (
    !isBoundedIdentifier(row.record_id, 128) ||
    typeof row.token_digest !== 'string' ||
    !sha256HexPattern.test(row.token_digest) ||
    !isBoundedIdentifier(row.subject_id, 128) ||
    !isBoundedIdentifier(row.organization_id, 128) ||
    !isBoundedIdentifier(row.device_id, 256) ||
    !isStatus(row.status)
  ) {
    return undefined;
  }

  const issuedAt = toIsoTimestamp(row.issued_at);
  const expiresAt = toIsoTimestamp(row.expires_at);
  const consumedAt = row.consumed_at === null
    ? null
    : toIsoTimestamp(row.consumed_at);
  if (
    issuedAt === null ||
    expiresAt === null ||
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    (row.status === 'consumed' && consumedAt === null) ||
    (row.status !== 'consumed' && consumedAt !== null)
  ) {
    return undefined;
  }

  return Object.freeze({
    schema_version: 1 as const,
    record_id: row.record_id,
    token_digest: row.token_digest,
    subject_id: row.subject_id,
    organization_id: row.organization_id,
    device_id: row.device_id,
    issued_at: issuedAt,
    expires_at: expiresAt,
    status: row.status,
    consumed_at: consumedAt,
  });
}

function validateIssuedRecord(record: DesktopLinkRecord): void {
  const row: PostgresDesktopLinkRow = {
    record_id: record.record_id,
    token_digest: record.token_digest,
    subject_id: record.subject_id,
    organization_id: record.organization_id,
    device_id: record.device_id,
    issued_at: record.issued_at,
    expires_at: record.expires_at,
    status: record.status,
    consumed_at: record.consumed_at ?? null,
  };
  if (record.status !== 'issued' || toDesktopLinkRecord(row) === undefined) {
    throw new TypeError('invalid issued desktop link record');
  }
}

/**
 * PostgreSQL persistence boundary for short-lived desktop-link exchanges.
 * Raw exchange tokens never enter this store: only the fixed SHA-256 digest is
 * persisted, and single-use consumption is an expiry-aware atomic UPDATE.
 */
export class PostgresDesktopLinkRecordStore implements DesktopLinkRecordStore {
  public constructor(private readonly client: PostgresQueryClient) {}

  public async put(record: DesktopLinkRecord): Promise<void> {
    validateIssuedRecord(record);
    await this.client.query(insertDesktopLinkSql, [
      record.record_id,
      record.token_digest,
      record.subject_id,
      record.organization_id,
      record.device_id,
      record.issued_at,
      record.expires_at,
      record.status,
      null,
    ]);
  }

  public async get(recordId: string): Promise<DesktopLinkRecord | undefined> {
    if (!isBoundedIdentifier(recordId, 128)) {
      return undefined;
    }

    const result = await this.client.query<PostgresDesktopLinkRow>(
      getDesktopLinkSql,
      [recordId],
    );
    if (result.rows.length !== 1) {
      return undefined;
    }
    const row = result.rows[0];
    return row === undefined ? undefined : toDesktopLinkRecord(row);
  }

  public async consumeIfIssued(
    recordId: string,
    expectedDigest: string,
    consumedAt: string,
  ): Promise<DesktopLinkRecord | undefined> {
    const consumedAtIso = toIsoTimestamp(consumedAt);
    if (
      !isBoundedIdentifier(recordId, 128) ||
      !sha256HexPattern.test(expectedDigest) ||
      consumedAtIso === null
    ) {
      return undefined;
    }

    const result = await this.client.query<PostgresDesktopLinkRow>(
      consumeDesktopLinkSql,
      [recordId, expectedDigest, consumedAtIso],
    );
    if (result.rows.length !== 1) {
      return undefined;
    }
    const row = result.rows[0];
    return row === undefined ? undefined : toDesktopLinkRecord(row);
  }
}

export function getDesktopLinkPersistenceSql(): Readonly<{
  insert: string;
  get: string;
  consume: string;
}> {
  return Object.freeze({
    insert: insertDesktopLinkSql,
    get: getDesktopLinkSql,
    consume: consumeDesktopLinkSql,
  });
}

export type DesktopLinkStatus = 'issued' | 'consumed' | 'revoked' | 'expired';

export const DESKTOP_LINK_RECORD_STORE = Symbol('DESKTOP_LINK_RECORD_STORE');

export interface DesktopLinkRecord {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly token_digest: string;
  readonly subject_id: string;
  readonly organization_id: string;
  readonly device_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly status: DesktopLinkStatus;
  readonly consumed_at?: string | null;
}

export interface DesktopLinkRecordStore {
  put(record: DesktopLinkRecord): Promise<void>;
  get(recordId: string): Promise<DesktopLinkRecord | undefined>;
  consumeIfIssued(
    recordId: string,
    expectedDigest: string,
    consumedAt: string,
  ): Promise<DesktopLinkRecord | undefined>;
  revokeIfIssued(
    recordId: string,
    subjectId: string,
    organizationId: string,
    revokedAt: string,
  ): Promise<DesktopLinkRecord | undefined>;
  listLatestConsumed(
    subjectId: string,
    organizationId: string,
    limit: number,
  ): Promise<readonly DesktopLinkRecord[]>;
}

export class InMemoryDesktopLinkRecordStore implements DesktopLinkRecordStore {
  private readonly records = new Map<string, DesktopLinkRecord>();

  public async put(record: DesktopLinkRecord): Promise<void> {
    if (this.records.has(record.record_id)) {
      throw new Error('desktop link record already exists');
    }
    this.records.set(record.record_id, Object.freeze({ ...record }));
  }

  public async get(recordId: string): Promise<DesktopLinkRecord | undefined> {
    return this.records.get(recordId);
  }

  public async consumeIfIssued(
    recordId: string,
    expectedDigest: string,
    consumedAt: string,
  ): Promise<DesktopLinkRecord | undefined> {
    const current = this.records.get(recordId);
    if (
      current === undefined ||
      current.status !== 'issued' ||
      current.token_digest !== expectedDigest
    ) {
      return undefined;
    }

    const consumed: DesktopLinkRecord = Object.freeze({
      ...current,
      status: 'consumed',
      consumed_at: consumedAt,
    });
    this.records.set(recordId, consumed);
    return consumed;
  }

  public async revokeIfIssued(
    recordId: string,
    subjectId: string,
    organizationId: string,
    revokedAt: string,
  ): Promise<DesktopLinkRecord | undefined> {
    const current = this.records.get(recordId);
    const revokedAtMs = Date.parse(revokedAt);
    if (
      current === undefined ||
      current.status !== 'issued' ||
      current.subject_id !== subjectId ||
      current.organization_id !== organizationId ||
      !Number.isFinite(revokedAtMs) ||
      revokedAtMs < Date.parse(current.issued_at) ||
      revokedAtMs >= Date.parse(current.expires_at)
    ) {
      return undefined;
    }

    const revoked: DesktopLinkRecord = Object.freeze({
      ...current,
      status: 'revoked',
    });
    this.records.set(recordId, revoked);
    return revoked;
  }

  public async listLatestConsumed(
    subjectId: string,
    organizationId: string,
    limit: number,
  ): Promise<readonly DesktopLinkRecord[]> {
    if (
      subjectId.trim().length === 0 ||
      organizationId.trim().length === 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    ) {
      return [];
    }

    const latestByDevice = new Map<string, DesktopLinkRecord>();
    for (const record of this.records.values()) {
      if (
        record.subject_id !== subjectId ||
        record.organization_id !== organizationId ||
        record.status !== 'consumed' ||
        typeof record.consumed_at !== 'string'
      ) {
        continue;
      }
      const current = latestByDevice.get(record.device_id);
      if (
        current === undefined ||
        Date.parse(record.consumed_at) > Date.parse(current.consumed_at ?? '')
      ) {
        latestByDevice.set(record.device_id, record);
      }
    }

    return Object.freeze(
      [...latestByDevice.values()]
        .sort((left, right) => {
          const timeDelta =
            Date.parse(right.consumed_at ?? '') -
            Date.parse(left.consumed_at ?? '');
          return timeDelta !== 0
            ? timeDelta
            : left.device_id.localeCompare(right.device_id);
        })
        .slice(0, limit),
    );
  }
}

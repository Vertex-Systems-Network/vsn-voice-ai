export type DesktopLinkStatus = 'issued' | 'consumed' | 'revoked' | 'expired';

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
  put(record: DesktopLinkRecord): void;
  get(recordId: string): DesktopLinkRecord | undefined;
  consumeIfIssued(
    recordId: string,
    expectedDigest: string,
    consumedAt: string,
  ): DesktopLinkRecord | undefined;
}

export class InMemoryDesktopLinkRecordStore implements DesktopLinkRecordStore {
  private readonly records = new Map<string, DesktopLinkRecord>();

  public put(record: DesktopLinkRecord): void {
    if (this.records.has(record.record_id)) {
      throw new Error('desktop link record already exists');
    }
    this.records.set(record.record_id, Object.freeze({ ...record }));
  }

  public get(recordId: string): DesktopLinkRecord | undefined {
    return this.records.get(recordId);
  }

  public consumeIfIssued(
    recordId: string,
    expectedDigest: string,
    consumedAt: string,
  ): DesktopLinkRecord | undefined {
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
}

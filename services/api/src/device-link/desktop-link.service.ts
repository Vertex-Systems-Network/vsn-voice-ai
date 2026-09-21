import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import type { AuthenticatedPrincipal } from '../identity/authenticated-principal.js';
import type { AuthorizationContext } from '../organizations/tenant-authorization.js';
import type {
  DesktopLinkRecord,
  DesktopLinkRecordStore,
} from './desktop-link-record.js';

const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const MIN_TTL_MS = 30 * 1_000;
const MAX_TTL_MS = 10 * 60 * 1_000;
const TOKEN_BYTES = 32;
const REQUIRED_PERMISSION = 'device.link';
const LINKED_DEVICE_PAGE_SIZE = 50;

export interface DesktopLinkIssue {
  readonly recordId: string;
  readonly exchangeToken: string;
  readonly expiresAt: string;
}

export interface DesktopLinkBinding {
  readonly linked: true;
  readonly recordId: string;
  readonly subjectId: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly consumedAt: string;
}

export interface DesktopLinkStatusSnapshot {
  readonly recordId: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly status: 'issued' | 'consumed' | 'revoked' | 'expired';
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

export interface LinkedDesktopSnapshot {
  readonly recordId: string;
  readonly deviceId: string;
  readonly linkedAt: string;
}

export interface LinkedDesktopInventory {
  readonly devices: readonly LinkedDesktopSnapshot[];
  readonly hasMore: boolean;
}

export interface DesktopLinkClock {
  now(): Date;
}

export class SystemDesktopLinkClock implements DesktopLinkClock {
  public now(): Date {
    return new Date();
  }
}

export class DesktopLinkDeniedError extends Error {
  public constructor(reason: string) {
    super(reason);
    this.name = 'DesktopLinkDeniedError';
  }
}

function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DesktopLinkDeniedError(`${field} is required`);
  }
}

function ttlMilliseconds(ttlMs: number | undefined): number {
  const ttl = ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
    throw new DesktopLinkDeniedError('desktop link ttl must be between 30 seconds and 10 minutes');
  }
  return ttl;
}

export class DesktopLinkService {
  public constructor(
    private readonly store: DesktopLinkRecordStore,
    private readonly clock: DesktopLinkClock = new SystemDesktopLinkClock(),
  ) {}

  public async issue(
    authorization: AuthorizationContext,
    deviceId: string,
    ttlMs?: number,
  ): Promise<DesktopLinkIssue> {
    requireNonEmpty(deviceId, 'device id');
    if (!authorization.permissions.includes(REQUIRED_PERMISSION)) {
      throw new DesktopLinkDeniedError('device.link permission is required');
    }

    const issuedAt = this.clock.now();
    const expiresAt = new Date(issuedAt.getTime() + ttlMilliseconds(ttlMs));
    const recordId = randomUUID();
    const exchangeToken = randomBytes(TOKEN_BYTES).toString('base64url');

    const record: DesktopLinkRecord = {
      schema_version: 1,
      record_id: recordId,
      token_digest: digestToken(exchangeToken),
      subject_id: authorization.subject_id,
      organization_id: authorization.organization_id,
      device_id: deviceId,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'issued',
    };
    await this.store.put(record);

    return Object.freeze({
      recordId,
      exchangeToken,
      expiresAt: expiresAt.toISOString(),
    });
  }

  public async listLinked(
    principal: AuthenticatedPrincipal,
    organizationId: string,
  ): Promise<LinkedDesktopInventory> {
    requireNonEmpty(principal.subjectId, 'subject id');
    requireNonEmpty(organizationId, 'organization id');

    const records = await this.store.listLatestConsumed(
      principal.subjectId,
      organizationId,
      LINKED_DEVICE_PAGE_SIZE + 1,
    );
    const devices = records.slice(0, LINKED_DEVICE_PAGE_SIZE).map((record) => {
      if (record.status !== 'consumed' || typeof record.consumed_at !== 'string') {
        throw new DesktopLinkDeniedError('linked desktop inventory contains invalid state');
      }
      return Object.freeze({
        recordId: record.record_id,
        deviceId: record.device_id,
        linkedAt: record.consumed_at,
      });
    });
    return Object.freeze({
      devices: Object.freeze(devices),
      hasMore: records.length > LINKED_DEVICE_PAGE_SIZE,
    });
  }

  public async inspect(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    recordId: string,
  ): Promise<DesktopLinkStatusSnapshot> {
    requireNonEmpty(principal.subjectId, 'subject id');
    requireNonEmpty(organizationId, 'organization id');
    requireNonEmpty(recordId, 'record id');

    const record = await this.store.get(recordId);
    if (
      record === undefined ||
      record.subject_id !== principal.subjectId ||
      record.organization_id !== organizationId
    ) {
      throw new DesktopLinkDeniedError('desktop link record is unavailable');
    }

    const expired =
      record.status === 'issued' &&
      this.clock.now().getTime() >= Date.parse(record.expires_at);
    const status = expired ? 'expired' as const : record.status;

    return Object.freeze({
      recordId: record.record_id,
      organizationId: record.organization_id,
      deviceId: record.device_id,
      status,
      expiresAt: record.expires_at,
      consumedAt: record.consumed_at ?? null,
    });
  }

  public async revoke(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    recordId: string,
  ): Promise<DesktopLinkStatusSnapshot> {
    requireNonEmpty(principal.subjectId, 'subject id');
    requireNonEmpty(organizationId, 'organization id');
    requireNonEmpty(recordId, 'record id');

    const record = await this.store.get(recordId);
    if (
      record === undefined ||
      record.subject_id !== principal.subjectId ||
      record.organization_id !== organizationId
    ) {
      throw new DesktopLinkDeniedError('desktop link record is unavailable');
    }

    if (record.status === 'revoked') {
      return Object.freeze({
        recordId: record.record_id,
        organizationId: record.organization_id,
        deviceId: record.device_id,
        status: 'revoked' as const,
        expiresAt: record.expires_at,
        consumedAt: null,
      });
    }

    const now = this.clock.now();
    if (
      record.status !== 'issued' ||
      now.getTime() >= Date.parse(record.expires_at)
    ) {
      throw new DesktopLinkDeniedError('desktop link exchange cannot be revoked');
    }

    const revoked = await this.store.revokeIfIssued(
      recordId,
      principal.subjectId,
      organizationId,
      now.toISOString(),
    );
    if (revoked === undefined) {
      throw new DesktopLinkDeniedError('desktop link revoke lost state race');
    }

    return Object.freeze({
      recordId: revoked.record_id,
      organizationId: revoked.organization_id,
      deviceId: revoked.device_id,
      status: 'revoked' as const,
      expiresAt: revoked.expires_at,
      consumedAt: null,
    });
  }

  public async consume(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    deviceId: string,
    recordId: string,
    exchangeToken: string,
  ): Promise<DesktopLinkBinding> {
    requireNonEmpty(principal.subjectId, 'subject id');
    requireNonEmpty(organizationId, 'organization id');
    requireNonEmpty(deviceId, 'device id');
    requireNonEmpty(recordId, 'record id');
    requireNonEmpty(exchangeToken, 'exchange token');

    const record = await this.store.get(recordId);
    const suppliedDigest = digestToken(exchangeToken);
    if (
      record === undefined ||
      record.status !== 'issued' ||
      !safeDigestEqual(record.token_digest, suppliedDigest)
    ) {
      throw new DesktopLinkDeniedError('desktop link exchange is invalid or already consumed');
    }

    const now = this.clock.now();
    if (now.getTime() >= Date.parse(record.expires_at)) {
      throw new DesktopLinkDeniedError('desktop link exchange has expired');
    }
    if (record.subject_id !== principal.subjectId) {
      throw new DesktopLinkDeniedError('desktop link subject does not match');
    }
    if (record.organization_id !== organizationId) {
      throw new DesktopLinkDeniedError('desktop link organization does not match');
    }
    if (record.device_id !== deviceId) {
      throw new DesktopLinkDeniedError('desktop link device does not match');
    }

    const consumedAt = now.toISOString();
    const consumed = await this.store.consumeIfIssued(recordId, suppliedDigest, consumedAt);
    if (consumed === undefined) {
      throw new DesktopLinkDeniedError('desktop link exchange lost single-use race');
    }

    return Object.freeze({
      linked: true,
      recordId: consumed.record_id,
      subjectId: consumed.subject_id,
      organizationId: consumed.organization_id,
      deviceId: consumed.device_id,
      consumedAt,
    });
  }
}

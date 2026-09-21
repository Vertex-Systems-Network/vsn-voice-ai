import type { OnApplicationShutdown } from '@nestjs/common';

import type { PostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import { loadOptionalPostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import type { ClosablePostgresQueryClient } from '../organizations/node-postgres-query-client.js';
import { NodePostgresQueryClient } from '../organizations/node-postgres-query-client.js';
import type {
  DesktopLinkRecord,
  DesktopLinkRecordStore,
} from './desktop-link-record.js';
import { PostgresDesktopLinkRecordStore } from './postgres-desktop-link-record-store.js';

export class DesktopLinkPersistenceUnavailableError extends Error {
  public constructor() {
    super('desktop link persistence is unavailable');
    this.name = 'DesktopLinkPersistenceUnavailableError';
  }
}

class RejectingDesktopLinkRecordStore implements DesktopLinkRecordStore {
  public async put(_record: DesktopLinkRecord): Promise<void> {
    throw new DesktopLinkPersistenceUnavailableError();
  }

  public async get(_recordId: string): Promise<DesktopLinkRecord | undefined> {
    throw new DesktopLinkPersistenceUnavailableError();
  }

  public async consumeIfIssued(
    _recordId: string,
    _expectedDigest: string,
    _consumedAt: string,
  ): Promise<DesktopLinkRecord | undefined> {
    throw new DesktopLinkPersistenceUnavailableError();
  }
}

export type DesktopLinkPostgresQueryClientFactory = (
  config: PostgresRuntimeConfig,
) => ClosablePostgresQueryClient;

function defaultClientFactory(
  config: PostgresRuntimeConfig,
): ClosablePostgresQueryClient {
  return new NodePostgresQueryClient(config);
}

/**
 * Runtime persistence boundary for desktop-link exchanges. It remains fail
 * closed when PostgreSQL is not configured and owns the lifecycle of the pool
 * it creates when persistence is enabled.
 */
export class RuntimeDesktopLinkRecordStore
  implements DesktopLinkRecordStore, OnApplicationShutdown
{
  private closePromise: Promise<void> | null = null;

  public constructor(
    private readonly delegate: DesktopLinkRecordStore,
    private readonly closeClient: (() => Promise<void>) | null,
  ) {}

  public async put(record: DesktopLinkRecord): Promise<void> {
    try {
      await this.delegate.put(record);
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw error;
      }
      throw new DesktopLinkPersistenceUnavailableError();
    }
  }

  public async get(recordId: string): Promise<DesktopLinkRecord | undefined> {
    try {
      return await this.delegate.get(recordId);
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw error;
      }
      throw new DesktopLinkPersistenceUnavailableError();
    }
  }

  public async consumeIfIssued(
    recordId: string,
    expectedDigest: string,
    consumedAt: string,
  ): Promise<DesktopLinkRecord | undefined> {
    try {
      return await this.delegate.consumeIfIssued(recordId, expectedDigest, consumedAt);
    } catch (error: unknown) {
      if (error instanceof DesktopLinkPersistenceUnavailableError) {
        throw error;
      }
      throw new DesktopLinkPersistenceUnavailableError();
    }
  }

  public onApplicationShutdown(): Promise<void> {
    if (this.closeClient === null) {
      return Promise.resolve();
    }
    if (this.closePromise === null) {
      this.closePromise = this.closeClient();
    }
    return this.closePromise;
  }
}

export function createRuntimeDesktopLinkRecordStore(
  env: Readonly<Record<string, string | undefined>>,
  createClient: DesktopLinkPostgresQueryClientFactory = defaultClientFactory,
): RuntimeDesktopLinkRecordStore {
  const config = loadOptionalPostgresRuntimeConfig(env);
  if (config === null) {
    return new RuntimeDesktopLinkRecordStore(
      new RejectingDesktopLinkRecordStore(),
      null,
    );
  }

  const client = createClient(config);
  return new RuntimeDesktopLinkRecordStore(
    new PostgresDesktopLinkRecordStore(client),
    () => client.close(),
  );
}

import { Pool, type PoolConfig } from 'pg';

import type { PostgresRuntimeConfig } from '../config/postgres-runtime-config.js';
import type {
  PostgresQueryClient,
  PostgresQueryResult,
} from './postgres-organization-membership-resolver.js';

export interface ClosablePostgresQueryClient extends PostgresQueryClient {
  close(): Promise<void>;
}

export function createNodePostgresPoolOptions(
  config: PostgresRuntimeConfig,
): PoolConfig {
  return {
    connectionString: config.connectionString,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    allowExitOnIdle: false,
    application_name: 'vsn-api-membership',
    ssl: config.sslMode === 'require' ? { rejectUnauthorized: true } : false,
  };
}

/**
 * Thin node-postgres pool adapter. Query values are copied into a mutable array
 * expected by node-postgres; SQL/result validation remains in the domain
 * membership resolver.
 */
export class NodePostgresQueryClient implements ClosablePostgresQueryClient {
  private readonly pool: Pool;

  public constructor(config: PostgresRuntimeConfig) {
    this.pool = new Pool(createNodePostgresPoolOptions(config));
  }

  public async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as readonly Row[] };
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

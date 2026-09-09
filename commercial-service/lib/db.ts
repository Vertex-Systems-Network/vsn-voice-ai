import { Pool, type PoolClient } from "pg";
import { databaseConfig } from "./env";

const REQUIRED_MIGRATION = "001_baseline.sql";
let pool: Pool | null = null;
let schemaReady = false;

export function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseConfig().databaseUrl,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      application_name: "anpos-commercial-service",
    });
  }
  return pool;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  try {
    const migration = await db().query(
      "SELECT checksum_sha256 FROM commercial_schema_migrations WHERE name=$1",
      [REQUIRED_MIGRATION],
    );
    if (!migration.rowCount) throw new Error("COMMERCIAL_DATABASE_MIGRATION_REQUIRED");
    const tables = await db().query(`
      SELECT
        to_regclass('public.marketplace_deliveries') AS marketplace_deliveries,
        to_regclass('public.entitlements') AS entitlements,
        to_regclass('public.organization_seat_assignments') AS organization_seat_assignments,
        to_regclass('public.template_access_grants') AS template_access_grants,
        to_regclass('public.rate_limit_windows') AS rate_limit_windows,
        to_regclass('public.commercial_audit_log') AS commercial_audit_log
    `);
    if (Object.values(tables.rows[0] ?? {}).some((value) => value == null)) {
      throw new Error("COMMERCIAL_DATABASE_SCHEMA_INCOMPLETE");
    }
  } catch (error: any) {
    if (error?.code === "42P01") throw new Error("COMMERCIAL_DATABASE_MIGRATION_REQUIRED");
    throw error;
  }
  schemaReady = true;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

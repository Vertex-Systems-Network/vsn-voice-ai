import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("DATABASE_URL is required for migrations");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
  query_timeout: 30_000,
  application_name: "anpos-commercial-migrator",
});
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(hashtext('anpos-commercial-migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS commercial_schema_migrations (
      name TEXT PRIMARY KEY,
      checksum_sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const directory = join(process.cwd(), "migrations");
  const files = (await readdir(directory))
    .filter((name) => /^\d{3}_[A-Za-z0-9_.-]+\.sql$/.test(name))
    .sort();
  if (!files.length) throw new Error("No commercial migrations found");

  for (const name of files) {
    const sql = await readFile(join(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query(
      "SELECT checksum_sha256 FROM commercial_schema_migrations WHERE name=$1",
      [name],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== checksum) {
        throw new Error(`Applied migration checksum changed: ${name}`);
      }
      console.log(`already applied ${name}`);
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO commercial_schema_migrations(name,checksum_sha256) VALUES ($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log(`applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('anpos-commercial-migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}

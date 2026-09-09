import { db, ensureSchema, transaction } from "./db";
import { removeTemplateCollaborator } from "./github";

export type AccessUser = { id: number; login: string };

export async function recordTemplateAccessGrant(sourceAccountId: number, user: AccessUser, requestId: string): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO template_access_grants(source_account_id,github_user_id,github_login,status,granted_at,revoked_at,updated_at)
       VALUES ($1,$2,$3,'active',NOW(),NULL,NOW())
       ON CONFLICT (source_account_id,github_user_id) DO UPDATE SET
         github_login=EXCLUDED.github_login,status='active',granted_at=NOW(),revoked_at=NULL,updated_at=NOW()`,
      [sourceAccountId, user.id, user.login],
    );
    await client.query("DELETE FROM access_reconciliation_jobs WHERE github_user_id=$1", [user.id]);
    await client.query(
      "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,'template_access_grant_recorded',$2,$3::jsonb)",
      [requestId, sourceAccountId, JSON.stringify({ github_user_id: user.id, github_login: user.login })],
    );
  });
}

export async function revokeAllTemplateGrantsForSource(sourceAccountId: number, requestId: string): Promise<number> {
  return transaction(async (client) => {
    const revoked = await client.query(
      `UPDATE template_access_grants SET status='revoked',revoked_at=NOW(),updated_at=NOW()
       WHERE source_account_id=$1 AND status='active'
       RETURNING github_user_id,github_login`,
      [sourceAccountId],
    );
    for (const row of revoked.rows) {
      await client.query(
        `INSERT INTO access_reconciliation_jobs(github_user_id,github_login,status,attempts,available_at,last_error,updated_at)
         VALUES ($1,$2,'pending',0,NOW(),NULL,NOW())
         ON CONFLICT (github_user_id) DO UPDATE SET github_login=EXCLUDED.github_login,status='pending',available_at=NOW(),last_error=NULL,updated_at=NOW()`,
        [row.github_user_id, row.github_login],
      );
    }
    if (revoked.rowCount) {
      await client.query(
        "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,'template_access_grants_revoked',$2,$3::jsonb)",
        [requestId, sourceAccountId, JSON.stringify({ count: revoked.rowCount })],
      );
    }
    return revoked.rowCount ?? 0;
  });
}

export async function processTemplateAccessForUser(user: AccessUser, requestId: string): Promise<{ action: string }> {
  await ensureSchema();
  const active = await db().query(
    "SELECT 1 FROM template_access_grants WHERE github_user_id=$1 AND status='active' LIMIT 1",
    [user.id],
  );
  if (active.rowCount) {
    await db().query("DELETE FROM access_reconciliation_jobs WHERE github_user_id=$1", [user.id]);
    return { action: "retained_due_to_other_active_grant" };
  }

  try {
    await removeTemplateCollaborator(user.login);
    await transaction(async (client) => {
      await client.query("DELETE FROM access_reconciliation_jobs WHERE github_user_id=$1", [user.id]);
      await client.query(
        "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,'template_collaborator_access_removed',NULL,$2::jsonb)",
        [requestId, JSON.stringify({ github_user_id: user.id, github_login: user.login })],
      );
    });
    return { action: "removed" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
    await db().query(
      `INSERT INTO access_reconciliation_jobs(github_user_id,github_login,status,attempts,available_at,last_error,updated_at)
       VALUES ($1,$2,'pending',1,NOW() + interval '5 minutes',$3,NOW())
       ON CONFLICT (github_user_id) DO UPDATE SET
         github_login=EXCLUDED.github_login,status='pending',attempts=access_reconciliation_jobs.attempts + 1,
         available_at=NOW() + LEAST(interval '6 hours', (interval '5 minutes' * POWER(2, LEAST(access_reconciliation_jobs.attempts, 6)))),
         last_error=EXCLUDED.last_error,updated_at=NOW()`,
      [user.id, user.login, message],
    );
    return { action: "retry_queued" };
  }
}

export async function processPendingTemplateAccessJobs(limit: number, requestId: string) {
  await ensureSchema();
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const jobs = await db().query(
    `SELECT github_user_id,github_login FROM access_reconciliation_jobs
     WHERE status='pending' AND available_at <= NOW() ORDER BY available_at ASC LIMIT $1`,
    [bounded],
  );
  const results = [];
  for (const row of jobs.rows) {
    const result = await processTemplateAccessForUser({ id: Number(row.github_user_id), login: row.github_login }, requestId);
    results.push({ github_user_id: Number(row.github_user_id), github_login: row.github_login, ...result });
  }
  return results;
}

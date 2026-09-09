import type { PoolClient } from "pg";
import { db, ensureSchema, transaction } from "./db";
import { organizationSeatCapacity } from "./plans";

const ACTIVE_STATES = new Set(["active", "trial", "grace"]);

export type SeatUser = { id: number; login: string };
export type SeatRevocationResult = {
  revoked: boolean;
  not_active: boolean;
  github_user_id: number | null;
  github_login: string | null;
};

async function audit(client: PoolClient, requestId: string, eventType: string, accountId: number, metadata: object = {}) {
  await client.query(
    "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,$2,$3,$4::jsonb)",
    [requestId, eventType, accountId, JSON.stringify(metadata)],
  );
}

export async function hasActiveSeat(accountId: number, userId: number): Promise<boolean> {
  await ensureSchema();
  const result = await db().query(
    "SELECT 1 FROM organization_seat_assignments WHERE github_account_id=$1 AND github_user_id=$2 AND status='active' LIMIT 1",
    [accountId, userId],
  );
  return Boolean(result.rowCount);
}

export async function requireActiveSeat(accountId: number, userId: number): Promise<void> {
  if (!(await hasActiveSeat(accountId, userId))) throw new Error("ORGANIZATION_SEAT_REQUIRED");
}

export async function listSeats(accountId: number) {
  await ensureSchema();
  const result = await db().query(
    `SELECT github_user_id,github_login,status,assigned_by_user_id,assigned_at,revoked_at,updated_at
     FROM organization_seat_assignments WHERE github_account_id=$1 ORDER BY status ASC, github_login ASC`,
    [accountId],
  );
  return result.rows;
}

export async function assignSeat(accountId: number, target: SeatUser, assignedByUserId: number, requestId: string) {
  return transaction(async (client) => {
    const entitlementResult = await client.query(
      "SELECT github_account_type,plan_id,seats,state FROM entitlements WHERE github_account_id=$1 FOR UPDATE",
      [accountId],
    );
    if (!entitlementResult.rowCount) throw new Error("ENTITLEMENT_NOT_FOUND");
    const entitlement = entitlementResult.rows[0];
    if (entitlement.github_account_type !== "Organization") throw new Error("ORGANIZATION_ACCOUNT_REQUIRED");
    if (!ACTIVE_STATES.has(String(entitlement.state))) throw new Error("ENTITLEMENT_NOT_ACTIVE");

    const existing = await client.query(
      "SELECT status FROM organization_seat_assignments WHERE github_account_id=$1 AND github_user_id=$2 FOR UPDATE",
      [accountId, target.id],
    );
    if (existing.rows[0]?.status === "active") {
      return { assigned: false, already_active: true, github_user_id: target.id, github_login: target.login };
    }

    const capacity = organizationSeatCapacity(String(entitlement.plan_id), entitlement.seats == null ? null : Number(entitlement.seats));
    const activeCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM organization_seat_assignments WHERE github_account_id=$1 AND status='active'",
      [accountId],
    );
    const activeCount = Number(activeCountResult.rows[0]?.count ?? 0);
    if (activeCount >= capacity) throw new Error("SEAT_CAPACITY_EXCEEDED");

    await client.query(
      `INSERT INTO organization_seat_assignments(
         github_account_id,github_user_id,github_login,status,assigned_by_user_id,assigned_at,revoked_at,updated_at
       ) VALUES ($1,$2,$3,'active',$4,NOW(),NULL,NOW())
       ON CONFLICT (github_account_id,github_user_id) DO UPDATE SET
         github_login=EXCLUDED.github_login,status='active',assigned_by_user_id=EXCLUDED.assigned_by_user_id,
         assigned_at=NOW(),revoked_at=NULL,updated_at=NOW()`,
      [accountId, target.id, target.login, assignedByUserId],
    );
    await audit(client, requestId, "organization_seat_assigned", accountId, {
      github_user_id: target.id,
      github_login: target.login,
      capacity,
      active_after: activeCount + 1,
    });
    return { assigned: true, github_user_id: target.id, github_login: target.login, capacity, active_after: activeCount + 1 };
  });
}

export async function revokeSeat(
  accountId: number,
  targetUserId: number,
  revokedByUserId: number,
  requestId: string,
): Promise<SeatRevocationResult> {
  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE organization_seat_assignments
       SET status='revoked',revoked_at=NOW(),updated_at=NOW()
       WHERE github_account_id=$1 AND github_user_id=$2 AND status='active'
       RETURNING github_user_id,github_login`,
      [accountId, targetUserId],
    );
    if (!result.rowCount) {
      return { revoked: false, not_active: true, github_user_id: null, github_login: null };
    }
    const row = result.rows[0];
    await client.query(
      `UPDATE template_access_grants SET status='revoked',revoked_at=NOW(),updated_at=NOW()
       WHERE source_account_id=$1 AND github_user_id=$2 AND status='active'`,
      [accountId, targetUserId],
    );
    await client.query(
      `INSERT INTO access_reconciliation_jobs(github_user_id,github_login,status,attempts,available_at,last_error,updated_at)
       VALUES ($1,$2,'pending',0,NOW(),NULL,NOW())
       ON CONFLICT (github_user_id) DO UPDATE SET github_login=EXCLUDED.github_login,status='pending',available_at=NOW(),last_error=NULL,updated_at=NOW()`,
      [targetUserId, row.github_login],
    );
    await audit(client, requestId, "organization_seat_revoked", accountId, {
      github_user_id: targetUserId,
      github_login: row.github_login,
      revoked_by_user_id: revokedByUserId,
    });
    return { revoked: true, not_active: false, github_user_id: targetUserId, github_login: row.github_login };
  });
}

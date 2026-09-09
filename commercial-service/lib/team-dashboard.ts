import { db, ensureSchema } from "./db";
import { organizationSeatCapacity } from "./plans";

export const ORGANIZATION_TEAM_FEATURE = "organization_team_features";
const ACTIVE_STATES = new Set(["active", "trial", "grace"]);

type EntitlementRecord = {
  github_account_id?: unknown;
  github_login?: unknown;
  github_account_type?: unknown;
  plan_id?: unknown;
  marketplace_plan_id?: unknown;
  seats?: unknown;
  state?: unknown;
  features?: unknown;
  billing_cycle?: unknown;
  billing_updated_at?: unknown;
  updated_at?: unknown;
};

type SeatRecord = {
  github_user_id?: unknown;
  github_login?: unknown;
  status?: unknown;
  assigned_by_user_id?: unknown;
  assigned_at?: unknown;
  revoked_at?: unknown;
  updated_at?: unknown;
};

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function optionalIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function loadTeamEntitlementRecord(accountId: number): Promise<EntitlementRecord> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("VALID_ACCOUNT_ID_REQUIRED");
  await ensureSchema();
  const result = await db().query(
    `SELECT github_account_id,github_login,github_account_type,plan_id,marketplace_plan_id,seats,state,features,
            billing_cycle,billing_updated_at,updated_at
       FROM entitlements WHERE github_account_id=$1`,
    [accountId],
  );
  if (!result.rowCount) throw new Error("ENTITLEMENT_NOT_FOUND");
  return result.rows[0] as EntitlementRecord;
}

export function buildTeamDashboardSummary(entitlement: EntitlementRecord, seatRows: SeatRecord[]) {
  const accountId = positiveInteger(entitlement.github_account_id);
  const accountLogin = optionalString(entitlement.github_login);
  const accountType = optionalString(entitlement.github_account_type);
  const planId = optionalString(entitlement.plan_id);
  const state = optionalString(entitlement.state);
  const features = Array.isArray(entitlement.features) ? entitlement.features.map(String) : [];

  if (!accountId || !accountLogin || accountType !== "Organization") throw new Error("ORGANIZATION_ACCOUNT_REQUIRED");
  if (!planId || !state || !ACTIVE_STATES.has(state)) throw new Error("ENTITLEMENT_NOT_ACTIVE");
  if (!features.includes(ORGANIZATION_TEAM_FEATURE)) throw new Error("ORGANIZATION_TEAM_FEATURES_REQUIRED");

  const marketplaceSeats = entitlement.seats == null ? null : positiveInteger(entitlement.seats);
  const capacity = organizationSeatCapacity(planId, marketplaceSeats);
  const assignments = seatRows.flatMap((row) => {
    const userId = positiveInteger(row.github_user_id);
    const login = optionalString(row.github_login);
    const status = optionalString(row.status);
    if (!userId || !login || !status || !["active", "revoked"].includes(status)) return [];
    return [{
      github_user_id: userId,
      github_login: login,
      status,
      assigned_by_user_id: positiveInteger(row.assigned_by_user_id),
      assigned_at: optionalIso(row.assigned_at),
      revoked_at: optionalIso(row.revoked_at),
      updated_at: optionalIso(row.updated_at),
    }];
  });
  const active = assignments.filter((seat) => seat.status === "active").length;

  return {
    account: {
      id: accountId,
      login: accountLogin,
      type: "Organization" as const,
    },
    plan: {
      id: planId,
      state,
      billing_cycle: optionalString(entitlement.billing_cycle),
      marketplace_plan_id: positiveInteger(entitlement.marketplace_plan_id),
      billing_updated_at: optionalIso(entitlement.billing_updated_at),
      record_updated_at: optionalIso(entitlement.updated_at),
      billing_authority: "github_marketplace" as const,
    },
    seats: {
      capacity,
      active,
      available: Math.max(capacity - active, 0),
      assignments,
    },
    support: {
      contractual_support_activated_by_source: false,
      note: "Team support/SLA requires an operator-approved customer contract; source code does not activate it.",
    },
  };
}

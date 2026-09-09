import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getMarketplaceSubscription } from "./github";
import { signEntitlement } from "./crypto";
import { db, ensureSchema, transaction } from "./db";
import { serviceConfig } from "./env";
import { resolveMarketplacePlan } from "./plans";
import { requireActiveSeat } from "./seats";
import { processPendingTemplateAccessJobs, revokeAllTemplateGrantsForSource } from "./template-access";

const ACTIVE_STATES = new Set(["active", "trial", "grace"]);

export type ReconciledEntitlement = {
  state: "cancelled" | "trial" | "active";
  github_account_id: number;
  github_account_type: "User" | "Organization" | null;
  github_login: string | null;
  plan_id: string | null;
  seats: number | null;
  entitlements: string[];
  signed_entitlement: ReturnType<typeof signEntitlement> | null;
  seat_assignment_required: boolean;
};

function tokenExpiry(now: Date): string {
  const configured = Number(process.env.ANPOS_ENTITLEMENT_TTL_SECONDS ?? "86400");
  const seconds = Number.isFinite(configured) ? Math.min(Math.max(configured, 900), 604800) : 86400;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function audit(client: PoolClient, requestId: string, eventType: string, accountId: number, metadata: object = {}) {
  await client.query(
    "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,$2,$3,$4::jsonb)",
    [requestId, eventType, accountId, JSON.stringify(metadata)],
  );
}

export async function reconcileEntitlement(accountId: number, requestId: string): Promise<ReconciledEntitlement> {
  const subscription = await getMarketplaceSubscription(accountId);
  const result = await transaction<ReconciledEntitlement>(async (client) => {
    const existing = await client.query("SELECT * FROM entitlements WHERE github_account_id=$1 FOR UPDATE", [accountId]);
    if (!subscription?.marketplace_purchase?.plan?.id) {
      if (existing.rowCount) {
        await client.query(
          "UPDATE entitlements SET state='cancelled',signed_envelope=NULL,expires_at=NOW(),updated_at=NOW() WHERE github_account_id=$1",
          [accountId],
        );
      }
      await audit(client, requestId, "entitlement_cancelled_or_absent", accountId);
      return {
        state: "cancelled",
        github_account_id: accountId,
        github_account_type: null,
        github_login: null,
        plan_id: null,
        seats: null,
        signed_entitlement: null,
        entitlements: [],
        seat_assignment_required: false,
      };
    }

    if (!Number.isSafeInteger(subscription.id) || subscription.id <= 0 || subscription.id !== accountId) {
      throw new Error("Marketplace account identity mismatch");
    }
    if (!new Set(["User", "Organization"]).has(subscription.type) || !subscription.login) {
      throw new Error("Unsupported Marketplace account type");
    }

    const marketplacePlanId = subscription.marketplace_purchase.plan.id;
    // resolveMarketplacePlan delegates paid IDs through marketplacePlanMap while keeping Community outside that paid map.
    const resolvedPlan = resolveMarketplacePlan(marketplacePlanId);
    const planId = resolvedPlan.planId;
    const features = resolvedPlan.features;

    const now = new Date();
    const licenseId = existing.rows[0]?.license_id ?? randomUUID();
    const seats = subscription.marketplace_purchase.unit_count ?? null;
    const state: "trial" | "active" = subscription.marketplace_purchase.on_free_trial ? "trial" : "active";
    const accountType = subscription.type as "User" | "Organization";
    const issuedAt = now.toISOString();
    const envelopeExpiresAt = tokenExpiry(now);
    const envelope = !resolvedPlan.paid || accountType === "Organization" ? null : signEntitlement({
      issuer: serviceConfig().entitlementIssuer,
      subject: { github_account_id: subscription.id, github_account_type: accountType, github_login: subscription.login },
      license_id: licenseId,
      plan_id: planId,
      seats,
      entitlements: features,
      issued_at: issuedAt,
      not_before: issuedAt,
      expires_at: envelopeExpiresAt,
    });

    await client.query(`
      INSERT INTO entitlements(
        github_account_id,github_login,github_account_type,license_id,plan_id,marketplace_plan_id,seats,state,features,billing_cycle,
        issued_at,not_before,expires_at,billing_updated_at,signed_envelope,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$11,$12,$13,$14::jsonb,NOW())
      ON CONFLICT (github_account_id) DO UPDATE SET
        github_login=EXCLUDED.github_login,github_account_type=EXCLUDED.github_account_type,plan_id=EXCLUDED.plan_id,
        marketplace_plan_id=EXCLUDED.marketplace_plan_id,seats=EXCLUDED.seats,state=EXCLUDED.state,features=EXCLUDED.features,
        billing_cycle=EXCLUDED.billing_cycle,issued_at=EXCLUDED.issued_at,not_before=EXCLUDED.not_before,
        expires_at=EXCLUDED.expires_at,billing_updated_at=EXCLUDED.billing_updated_at,
        signed_envelope=EXCLUDED.signed_envelope,updated_at=NOW()
    `, [
      subscription.id, subscription.login, accountType, licenseId, planId, marketplacePlanId, seats, state,
      JSON.stringify(features), subscription.marketplace_purchase.billing_cycle ?? null, issuedAt, envelopeExpiresAt,
      subscription.marketplace_purchase.updated_at ?? null, JSON.stringify(envelope),
    ]);
    await audit(client, requestId, "entitlement_reconciled", accountId, {
      plan_id: planId,
      marketplace_plan_id: marketplacePlanId,
      state,
      account_type: accountType,
      paid: resolvedPlan.paid,
    });
    return {
      state,
      github_account_id: accountId,
      github_account_type: accountType,
      github_login: subscription.login,
      plan_id: planId,
      seats,
      entitlements: features,
      signed_entitlement: envelope,
      seat_assignment_required: resolvedPlan.paid && accountType === "Organization",
    };
  });

  if (result.state === "cancelled" || !result.entitlements.includes("private_template_access")) {
    const revoked = await revokeAllTemplateGrantsForSource(accountId, requestId);
    if (revoked > 0) await processPendingTemplateAccessJobs(10, requestId).catch(() => []);
  }
  return result;
}

export async function getEntitlement(accountId: number) {
  await ensureSchema();
  const result = await db().query(
    "SELECT github_account_id,github_login,github_account_type,license_id,plan_id,marketplace_plan_id,seats,state,features,issued_at,not_before,expires_at,signed_envelope,updated_at FROM entitlements WHERE github_account_id=$1",
    [accountId],
  );
  return result.rows[0] ?? null;
}

export async function issueEntitlementForPrincipal(accountId: number, user: { id: number; login: string }, requestId: string) {
  const entitlement = await getEntitlement(accountId);
  if (!entitlement) throw new Error("ENTITLEMENT_NOT_FOUND");
  if (!ACTIVE_STATES.has(String(entitlement.state))) throw new Error("ENTITLEMENT_NOT_ACTIVE");
  const features = Array.isArray(entitlement.features) ? entitlement.features.map(String) : [];
  if (!features.length) throw new Error("ENTITLEMENT_FEATURES_MISSING");

  const subject = {
    github_account_id: Number(entitlement.github_account_id),
    github_account_type: String(entitlement.github_account_type),
    github_login: String(entitlement.github_login),
  };
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = tokenExpiry(now);

  let envelope;
  if (subject.github_account_type === "Organization") {
    await requireActiveSeat(accountId, user.id);
    envelope = signEntitlement({
      issuer: serviceConfig().entitlementIssuer,
      subject,
      principal: { github_user_id: user.id, github_login: user.login },
      license_id: String(entitlement.license_id),
      plan_id: String(entitlement.plan_id),
      seats: entitlement.seats == null ? null : Number(entitlement.seats),
      entitlements: features,
      issued_at: issuedAt,
      not_before: issuedAt,
      expires_at: expiresAt,
    });
  } else {
    if (user.id !== accountId) throw new Error("FORBIDDEN_GITHUB_ACCOUNT");
    envelope = signEntitlement({
      issuer: serviceConfig().entitlementIssuer,
      subject,
      license_id: String(entitlement.license_id),
      plan_id: String(entitlement.plan_id),
      seats: entitlement.seats == null ? null : Number(entitlement.seats),
      entitlements: features,
      issued_at: issuedAt,
      not_before: issuedAt,
      expires_at: expiresAt,
    });
  }

  await db().query(
    "INSERT INTO commercial_audit_log(request_id,event_type,github_account_id,metadata) VALUES ($1,'entitlement_token_issued',$2,$3::jsonb)",
    [requestId, accountId, JSON.stringify({ github_user_id: user.id, github_login: user.login, format_version: envelope.format_version })],
  );
  return {
    state: String(entitlement.state),
    github_account_id: accountId,
    github_account_type: subject.github_account_type,
    github_login: subject.github_login,
    plan_id: String(entitlement.plan_id),
    seats: entitlement.seats == null ? null : Number(entitlement.seats),
    entitlements: features,
    issued_at: issuedAt,
    not_before: issuedAt,
    expires_at: expiresAt,
    billing_record_updated_at: iso(entitlement.updated_at),
    signed_entitlement: envelope,
  };
}

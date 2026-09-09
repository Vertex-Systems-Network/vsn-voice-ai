export const PLAN_FEATURES: Record<string, string[]> = {
  developer: ["private_template_access", "protocol_update_channel"],
  pro: ["private_template_access", "protocol_update_channel", "premium_blueprints", "premium_provider_adapters", "hosted_orchestrator_when_offered"],
  team: ["private_template_access", "protocol_update_channel", "premium_blueprints", "premium_provider_adapters", "hosted_orchestrator_when_offered", "organization_team_features", "commercial_support"],
  enterprise: ["private_template_access", "protocol_update_channel", "premium_blueprints", "premium_provider_adapters", "hosted_or_self_hosted_orchestrator_when_offered", "organization_team_features", "enterprise_policy_controls", "priority_support_or_sla_when_contracted"],
};

export function communityMarketplacePlanId(): number {
  const raw = process.env.ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID;
  if (!raw || !/^\d+$/.test(raw)) throw new Error("ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID is not configured");
  const planId = Number(raw);
  if (!Number.isSafeInteger(planId) || planId <= 0) throw new Error("Invalid ANPOS_COMMUNITY_MARKETPLACE_PLAN_ID");
  return planId;
}

export function marketplacePlanMap(): Record<string, string> {
  const raw = process.env.ANPOS_MARKETPLACE_PLAN_MAP;
  if (!raw) throw new Error("ANPOS_MARKETPLACE_PLAN_MAP is not configured");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Invalid ANPOS_MARKETPLACE_PLAN_MAP"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid ANPOS_MARKETPLACE_PLAN_MAP");
  const result = parsed as Record<string, string>;
  const communityId = String(communityMarketplacePlanId());
  for (const [marketplaceId, planId] of Object.entries(result)) {
    if (!/^\d+$/.test(marketplaceId) || marketplaceId === communityId || !PLAN_FEATURES[planId]) {
      throw new Error("Invalid ANPOS_MARKETPLACE_PLAN_MAP");
    }
  }
  return result;
}

export function resolveMarketplacePlan(marketplacePlanId: number): { planId: string; features: string[]; paid: boolean } {
  if (!Number.isSafeInteger(marketplacePlanId) || marketplacePlanId <= 0) throw new Error("Invalid Marketplace plan ID");
  if (marketplacePlanId === communityMarketplacePlanId()) {
    return { planId: "community", features: [], paid: false };
  }
  const planId = marketplacePlanMap()[String(marketplacePlanId)];
  if (!planId) throw new Error(`Marketplace plan ${marketplacePlanId} is not mapped`);
  return { planId, features: PLAN_FEATURES[planId], paid: true };
}

export function organizationSeatCapacity(planId: string, marketplaceUnitCount: number | null): number {
  if (Number.isInteger(marketplaceUnitCount) && Number(marketplaceUnitCount) > 0) return Number(marketplaceUnitCount);
  const raw = process.env.ANPOS_ORG_SEAT_LIMITS;
  if (!raw) throw new Error("ORGANIZATION_SEAT_CAPACITY_NOT_CONFIGURED");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("INVALID_ORGANIZATION_SEAT_LIMITS"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_ORGANIZATION_SEAT_LIMITS");
  const configured = Number((parsed as Record<string, unknown>)[planId]);
  if (!Number.isInteger(configured) || configured < 1 || configured > 100_000) {
    throw new Error("ORGANIZATION_SEAT_CAPACITY_NOT_CONFIGURED");
  }
  return configured;
}

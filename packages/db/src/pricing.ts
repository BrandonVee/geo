import { eq } from "drizzle-orm";
import { db } from "./client";
import { featurePointCosts, pricingTierRules, users } from "./schema";

export type PricingTier = "retail" | "bronze" | "silver" | "gold";

const defaultRule = {
  retail: {
    displayName: "普通用户",
    publicationMarkupBps: 3000,
    pointMultiplierBps: 10000,
  },
  bronze: {
    displayName: "铜牌代理",
    publicationMarkupBps: 2000,
    pointMultiplierBps: 9000,
  },
  silver: {
    displayName: "银牌代理",
    publicationMarkupBps: 1500,
    pointMultiplierBps: 8000,
  },
  gold: {
    displayName: "金牌代理",
    publicationMarkupBps: 1000,
    pointMultiplierBps: 7000,
  },
} satisfies Record<
  PricingTier,
  Omit<typeof pricingTierRules.$inferInsert, "tier">
>;

export async function getUserPricingTier(userId: string): Promise<PricingTier> {
  const [row] = await db
    .select({ pricingTier: users.pricingTier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.pricingTier ?? "retail";
}

export async function getPricingTierRule(tier: PricingTier) {
  const [row] = await db
    .select()
    .from(pricingTierRules)
    .where(eq(pricingTierRules.tier, tier))
    .limit(1);
  return row ?? { tier, ...defaultRule[tier], updatedBy: null };
}

export async function listPricingTierRules() {
  const stored = await db.select().from(pricingTierRules);
  const byTier = new Map(stored.map((row) => [row.tier, row]));
  return (["retail", "bronze", "silver", "gold"] as const).map(
    (tier) =>
      byTier.get(tier) ?? { tier, ...defaultRule[tier], updatedBy: null },
  );
}

export async function setPricingTierRule(input: {
  tier: PricingTier;
  displayName: string;
  publicationMarkupBps: number;
  pointMultiplierBps: number;
  updatedBy: string;
}) {
  const [row] = await db
    .insert(pricingTierRules)
    .values(input)
    .onConflictDoUpdate({
      target: pricingTierRules.tier,
      set: {
        displayName: input.displayName,
        publicationMarkupBps: input.publicationMarkupBps,
        pointMultiplierBps: input.pointMultiplierBps,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function getEffectiveFeaturePointCost(
  featureCode: string,
  userId: string,
) {
  const [basePoints, tier] = await Promise.all([
    db
      .select({ points: featurePointCosts.points })
      .from(featurePointCosts)
      .where(eq(featurePointCosts.featureCode, featureCode))
      .limit(1)
      .then(([row]) => row?.points ?? 0),
    getUserPricingTier(userId),
  ]);
  const rule = await getPricingTierRule(tier);
  return {
    tier,
    basePoints,
    pointMultiplierBps: rule.pointMultiplierBps,
    points: Math.ceil((basePoints * rule.pointMultiplierBps) / 10_000),
  };
}

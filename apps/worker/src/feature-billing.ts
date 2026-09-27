import type { BillableFeatureCode } from "@geo/core";
import {
  consumeBalance,
  getEffectiveFeaturePointCost,
  restoreBalance,
} from "@geo/db";

type FeatureChargeContext = {
  organizationId: string;
  brandId: string;
  actorUserId: string;
  referenceId: string;
  pricingSnapshot?: { tier: string; points: number } | null;
};

export async function consumeFeaturePoints(
  featureCode: BillableFeatureCode,
  featureName: string,
  context: FeatureChargeContext,
) {
  const pricing =
    context.pricingSnapshot ??
    (await getEffectiveFeaturePointCost(featureCode, context.actorUserId));
  if (pricing.points <= 0) return 0;
  const consumed = await consumeBalance({
    organizationId: context.organizationId,
    brandId: context.brandId,
    asset: "answerbit_points",
    amount: pricing.points,
    referenceType: "feature_usage",
    referenceId: context.referenceId,
    idempotencyKey: `feature:${featureCode}:${context.referenceId}:consume`,
    reason: `${featureName}功能计费（${pricing.tier}）`,
    actorUserId: context.actorUserId,
  });
  if (!consumed.ok) throw new Error("ANSWERBIT_POINTS_INSUFFICIENT");
  return "transaction" in consumed ? consumed.transaction.amount : 0;
}

export async function restoreFeaturePoints(
  featureCode: BillableFeatureCode,
  featureName: string,
  points: number,
  context: FeatureChargeContext,
) {
  if (points <= 0) return;
  await restoreBalance({
    organizationId: context.organizationId,
    brandId: context.brandId,
    asset: "answerbit_points",
    amount: points,
    referenceType: "feature_usage_failed",
    referenceId: context.referenceId,
    idempotencyKey: `feature:${featureCode}:${context.referenceId}:restore`,
    reason: `${featureName}失败返还`,
    actorUserId: context.actorUserId,
  });
}

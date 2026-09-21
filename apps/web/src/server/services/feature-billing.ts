import {
  consumeBalance,
  getEffectiveFeaturePointCost,
  restoreBalance,
} from "@geo/db";
import type { BillableFeatureCode } from "@geo/core";
import { ApiError } from "@/server/http/errors";

type FeatureCharge = {
  featureCode: BillableFeatureCode;
  featureName: string;
  organizationId: string;
  brandId: string;
  actorUserId: string;
  referenceId: string;
};

export async function getPointBilledFeatureQuote(
  featureCode: BillableFeatureCode,
  userId: string,
) {
  return getEffectiveFeaturePointCost(featureCode, userId);
}

/** Charges once for a complete business feature, regardless of API call count. */
export async function runPointBilledFeature<T>(
  input: FeatureCharge,
  execute: () => Promise<T>,
): Promise<T> {
  const pricing = await getEffectiveFeaturePointCost(
    input.featureCode,
    input.actorUserId,
  );
  const configuredPoints = pricing.points;
  let chargedPoints = 0;
  if (configuredPoints > 0) {
    const consumed = await consumeBalance({
      organizationId: input.organizationId,
      brandId: input.brandId,
      asset: "answerbit_points",
      amount: configuredPoints,
      referenceType: "feature_usage",
      referenceId: input.referenceId,
      idempotencyKey: `feature:${input.featureCode}:${input.referenceId}:consume`,
      reason: `${input.featureName}功能计费（${pricing.tier}）`,
      actorUserId: input.actorUserId,
    });
    if (!consumed.ok)
      throw new ApiError(
        402,
        "ANSWERBIT_POINTS_INSUFFICIENT",
        `当前品牌积分不足，${input.featureName}需要 ${configuredPoints} 积分`,
      );
    chargedPoints = "transaction" in consumed ? consumed.transaction.amount : 0;
  }

  try {
    return await execute();
  } catch (error) {
    if (chargedPoints > 0) {
      try {
        await restoreBalance({
          organizationId: input.organizationId,
          brandId: input.brandId,
          asset: "answerbit_points",
          amount: chargedPoints,
          referenceType: "feature_usage_failed",
          referenceId: input.referenceId,
          idempotencyKey: `feature:${input.featureCode}:${input.referenceId}:restore`,
          reason: `${input.featureName}失败返还`,
          actorUserId: input.actorUserId,
        });
      } catch (restoreError) {
        console.error(
          JSON.stringify({
            event: "feature-usage.restore-failed",
            featureCode: input.featureCode,
            referenceId: input.referenceId,
            message:
              restoreError instanceof Error
                ? restoreError.message
                : String(restoreError),
          }),
        );
      }
    }
    throw error;
  }
}

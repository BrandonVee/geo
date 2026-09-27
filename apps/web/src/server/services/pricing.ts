import type { PricingTierRuleInput } from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { pricingRepository } from "@/server/repositories/pricing";

export const pricingService = {
  async list(userId: string) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    return pricingRepository.listRules();
  },

  async update(
    input: PricingTierRuleInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    const row = await pricingRepository.setRule({
      ...input,
      updatedBy: userId,
    });
    await writeAudit(audit, {
      operation: "pricing.tier.update",
      resourceType: "pricing_tier_rule",
      resourceId: row.tier,
      summary: `更新${row.displayName}价格规则：发布加价 ${(row.publicationMarkupBps / 100).toFixed(2)}%，积分加价 ${(row.pointMarkupBps / 100).toFixed(2)}%`,
    });
    return row;
  },
};

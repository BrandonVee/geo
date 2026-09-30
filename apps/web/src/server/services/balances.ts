import type {
  AdminGrantBalanceInput,
  AdminDeductBalanceInput,
  AdminBalanceTransactionQuery,
  AllocateBrandBalanceInput,
  FeaturePointCostInput,
  BalanceTransactionQuery,
  PointUsageQuery,
} from "@geo/contracts";
import { isBillableFeature } from "@geo/core";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError } from "@/server/http/errors";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { balanceRepository } from "@/server/repositories/balances";
import { organizationRepository } from "@/server/repositories/organizations";
import { organizationService } from "./organizations";

export const balanceService = {
  async adminList(userId: string) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    return balanceRepository.all();
  },
  async adminTransactions(input: AdminBalanceTransactionQuery, userId: string) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    return balanceRepository.allTransactions(input);
  },
  async list(
    organizationId: string,
    brandId: string | undefined,
    teamBindingId: string | undefined,
    userId: string,
  ) {
    if (brandId) {
      await authorizeBrand(
        organizationId,
        teamBindingId!,
        brandId,
        userId,
        "balance.read",
      );
      const accounts = await balanceRepository.list(organizationId);
      return accounts.filter((item) => item.brandId === brandId);
    }
    await organizationService.authorize(organizationId, userId, "balance.read");
    return balanceRepository.list(organizationId);
  },
  async transactions(input: BalanceTransactionQuery, userId: string) {
    await organizationService.authorize(
      input.organizationId,
      userId,
      "balance.read",
    );
    return balanceRepository.transactions(input);
  },
  async pointUsage(input: PointUsageQuery, userId: string) {
    if (input.brandId) {
      await authorizeBrand(
        input.organizationId,
        input.teamBindingId!,
        input.brandId,
        userId,
        "balance.read",
      );
    } else {
      await organizationService.authorize(
        input.organizationId,
        userId,
        "balance.read",
      );
    }
    const membership = await organizationRepository.findMembershipRole(
      input.organizationId,
      userId,
    );
    if (!input.brandId && membership?.role !== "tenant_admin")
      throw new ApiError(
        403,
        "PERMISSION_DENIED",
        "只有企业管理员可以查看企业整体积分统计",
      );
    const beginAt = new Date(`${input.beginDate}T00:00:00+08:00`);
    const endAtExclusive = new Date(
      new Date(`${input.endDate}T00:00:00+08:00`).getTime() + 86_400_000,
    );
    const result = await balanceRepository.pointUsage({
      organizationId: input.organizationId,
      brandId: input.brandId,
      beginAt,
      endAtExclusive,
      operation: input.operation,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      ...result,
      organizationBalance:
        membership?.role === "tenant_admin" ? result.organizationBalance : null,
    };
  },
  async grant(
    input: AdminGrantBalanceInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    const result = await balanceRepository.grant({
      ...input,
      actorUserId: userId,
    });
    await writeAudit(
      { ...audit, organizationId: input.organizationId },
      {
        operation: "balance.grant",
        resourceType: "balance_transaction",
        resourceId: result.transaction.id,
        summary: `${input.asset} 管理员入账 ${input.amount}：${input.reason}`,
      },
    );
    return result;
  },
  async deduct(
    input: AdminDeductBalanceInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    if (
      input.brandId &&
      !(await balanceRepository.brandExists(
        input.organizationId,
        input.brandId,
      ))
    )
      throw new ApiError(404, "BRAND_NOT_FOUND", "品牌不存在");
    const result = await balanceRepository.deduct({
      ...input,
      actorUserId: userId,
    });
    if (!result.ok)
      throw new ApiError(
        result.code === "IDEMPOTENCY_CONFLICT" ? 409 : 422,
        result.code,
        result.code === "IDEMPOTENCY_CONFLICT"
          ? "重复请求的扣减内容不一致"
          : "当前账户余额不足，无法扣减",
      );
    if (!result.replayed)
      await writeAudit(
        { ...audit, organizationId: input.organizationId },
        {
          operation: "balance.deduct",
          resourceType: "balance_transaction",
          resourceId: result.transaction.id,
          summary: `${input.asset} 管理员手动扣减 ${input.amount}：${input.reason}`,
        },
      );
    return result;
  },
  async allocate(
    input: AllocateBrandBalanceInput,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      input.organizationId,
      userId,
      "balance.allocate",
    );
    if (
      !(await balanceRepository.brandExists(
        input.organizationId,
        input.brandId,
      ))
    )
      throw new ApiError(404, "BRAND_NOT_FOUND", "品牌不存在");
    const result = await balanceRepository.allocate({
      ...input,
      actorUserId: userId,
    });
    if (!result.ok && result.code === "AGENT_ANSWERBIT_POINTS_QUOTA_EXCEEDED")
      throw new ApiError(
        422,
        "AGENT_ANSWERBIT_POINTS_QUOTA_EXCEEDED",
        "本次划拨将超过代理商腾讯积分额度",
      );
    if (!result.ok)
      throw new ApiError(422, "INSUFFICIENT_BALANCE", "企业可分配余额不足");
    await writeAudit(
      { ...audit, organizationId: input.organizationId },
      {
        operation: "balance.allocate",
        resourceType: "balance_transaction",
        resourceId: result.transaction.id,
        summary: `向品牌 ${input.brandId} 划分 ${input.asset} ${input.amount}：${input.reason}`,
      },
    );
    return result;
  },
  async pointCosts(userId: string) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    return balanceRepository.pointCosts();
  },
  async setPointCost(
    input: FeaturePointCostInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.balance.manage");
    if (!isBillableFeature(input.featureCode))
      throw new ApiError(
        422,
        "FEATURE_NOT_BILLABLE",
        "只能配置功能目录中的积分项目",
      );
    const row = await balanceRepository.setPointCost({
      ...input,
      updatedBy: userId,
    });
    await writeAudit(audit, {
      operation: "feature.point-cost.update",
      resourceType: "feature_point_cost",
      resourceId: row.featureCode,
      summary: `${row.featureCode} 每次功能使用扣减 ${row.points} 积分`,
    });
    return row;
  },
};

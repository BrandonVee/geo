import type {
  MeteringPageQuery,
  MeteringPeriodQuery,
  MeteringScopeQuery,
  PurchaseAnswerBitQuotaInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import {
  purchaseQuotaLogged,
  queryBillingLogsLogged,
  queryBillingUsageLogged,
  queryCreditBillsLogged,
  queryCreditRankLogged,
  queryCreditStatusLogged,
  queryCreditTrendLogged,
  queryCreditUsageLogged,
  queryQuotaOverridesLogged,
  querySubscriptionLogged,
} from "@/server/integrations/answerbit/gateway";
import { ApiError } from "@/server/http/errors";
import { resolveBrandScope } from "@/server/permissions/brand-scope";
import {
  isPlatformAdministrator,
  requirePlatformPermission,
} from "@/server/permissions/platform";
import { brandRepository } from "@/server/repositories/brands";
import { mapUpstreamError } from "./answerbit-connections";

type MeteringInput =
  | MeteringScopeQuery
  | MeteringPeriodQuery
  | MeteringPageQuery
  | PurchaseAnswerBitQuotaInput;
async function prepare(
  input: MeteringInput,
  userId: string,
  requestId: string,
) {
  const platformAdministrator = await isPlatformAdministrator(userId);
  const scope = platformAdministrator
    ? ({ unrestricted: true as const, accesses: [] } as const)
    : await resolveBrandScope(
        input.organizationId,
        input.teamBindingId,
        userId,
        "resource.read",
      );
  const allowedBrandIds = scope.unrestricted
    ? (
        await brandRepository.listBrands(
          input.organizationId,
          input.teamBindingId,
        )
      ).map((brand) => brand.brandId)
    : scope.accesses.map((access) => access.brandId);
  if (!scope.unrestricted && !input.brandId)
    throw new ApiError(
      403,
      "BRAND_SCOPE_REQUIRED",
      "品牌用户必须指定已授权品牌",
    );
  if (input.brandId && !allowedBrandIds.includes(input.brandId))
    throw new ApiError(
      403,
      "PERMISSION_DENIED",
      "没有访问该品牌计量数据的权限",
    );
  const brandId = input.brandId ?? allowedBrandIds[0];
  const answerBit = await loadAnswerBitTeamContext(
    input.organizationId,
    input.teamBindingId,
  );
  return {
    ...answerBit,
    platformAdministrator,
    scope,
    brandId,
    allowedBrandIds,
    log: {
      organizationId: input.organizationId,
      connectionId: answerBit.connection.id,
      requestId,
      actorUserId: userId,
      brandId,
    },
  };
}
const periodPayload = (
  input: MeteringPeriodQuery,
  teamId: string,
  brandId?: string,
) => ({
  team_id: teamId,
  ...(brandId ? { brand_id: brandId } : {}),
  ...(input.startUnix !== undefined
    ? { start_unix: input.startUnix, end_unix: input.endUnix }
    : {}),
  ...(input.quotaTypes.length ? { quota_types: input.quotaTypes } : {}),
});
const pagePayload = (
  input: MeteringPageQuery,
  teamId: string,
  brandId?: string,
) => ({
  team_id: teamId,
  ...(brandId ? { brand_id: brandId } : {}),
  page: input.page,
  page_size: input.pageSize,
  ...(input.keyword ? { keyword: input.keyword } : {}),
  ...(input.startTime !== undefined
    ? { start_time: input.startTime, end_time: input.endTime }
    : {}),
  ...(input.status !== undefined ? { status: input.status } : {}),
});
async function upstream<T>(execute: () => Promise<T>) {
  try {
    return await execute();
  } catch (error) {
    return mapUpstreamError(error);
  }
}

export const meteringService = {
  async usage(input: MeteringScopeQuery, userId: string, requestId: string) {
    const { team, apiKey, brandId, log, platformAdministrator } = await prepare(
      input,
      userId,
      requestId,
    );
    const usageBrandId =
      platformAdministrator && input.brandId === undefined
        ? undefined
        : brandId;
    const result = await upstream(() =>
      queryBillingUsageLogged(
        apiKey,
        {
          team_id: team.teamId,
          ...(usageBrandId ? { brand_id: usageBrandId } : {}),
        },
        { ...log, brandId: usageBrandId },
      ),
    );
    if (platformAdministrator) return result;
    return { plan: result.plan };
  },
  async subscription(
    input: MeteringScopeQuery,
    userId: string,
    requestId: string,
  ) {
    await requirePlatformPermission(userId, "platform.answerbit.read");
    const { team, apiKey, log } = await prepare(input, userId, requestId);
    return upstream(() => querySubscriptionLogged(apiKey, team.teamId, log));
  },
  async credits(input: MeteringScopeQuery, userId: string, requestId: string) {
    await requirePlatformPermission(userId, "platform.answerbit.read");
    const { team, apiKey, log } = await prepare(input, userId, requestId);
    return upstream(() => queryCreditStatusLogged(apiKey, team.teamId, log));
  },
  async creditUsage(
    input: MeteringPeriodQuery,
    userId: string,
    requestId: string,
  ) {
    const { team, apiKey, brandId, log } = await prepare(
      input,
      userId,
      requestId,
    );
    return upstream(() =>
      queryCreditUsageLogged(
        apiKey,
        periodPayload(input, team.teamId, brandId),
        log,
      ),
    );
  },
  async creditTrends(
    input: MeteringPeriodQuery,
    userId: string,
    requestId: string,
  ) {
    const { team, apiKey, brandId, log } = await prepare(
      input,
      userId,
      requestId,
    );
    return upstream(() =>
      queryCreditTrendLogged(
        apiKey,
        periodPayload(input, team.teamId, brandId),
        log,
      ),
    );
  },
  async creditRanks(
    input: MeteringPeriodQuery,
    userId: string,
    requestId: string,
  ) {
    const { team, apiKey, log, allowedBrandIds } = await prepare(
      input,
      userId,
      requestId,
    );
    const result = await upstream(() =>
      queryCreditRankLogged(
        apiKey,
        {
          team_id: team.teamId,
          ...(input.startUnix !== undefined
            ? { start_unix: input.startUnix, end_unix: input.endUnix }
            : {}),
        },
        log,
      ),
    );
    return result.filter((item) => allowedBrandIds.includes(item.brand_id));
  },
  async creditBills(
    input: MeteringPageQuery,
    userId: string,
    requestId: string,
  ) {
    const { team, apiKey, brandId, log } = await prepare(
      input,
      userId,
      requestId,
    );
    return upstream(() =>
      queryCreditBillsLogged(
        apiKey,
        pagePayload(input, team.teamId, brandId),
        log,
      ),
    );
  },
  async subscriptionLogs(
    input: MeteringPageQuery,
    userId: string,
    requestId: string,
  ) {
    await requirePlatformPermission(userId, "platform.answerbit.read");
    const { team, apiKey, log } = await prepare(input, userId, requestId);
    const payload = pagePayload(input, team.teamId);
    return upstream(() =>
      queryBillingLogsLogged(
        apiKey,
        {
          team_id: payload.team_id,
          page: payload.page,
          page_size: payload.page_size,
          keyword: payload.keyword,
        },
        log,
      ),
    );
  },
  async quotaOverrides(
    input: MeteringPageQuery,
    userId: string,
    requestId: string,
  ) {
    await requirePlatformPermission(userId, "platform.answerbit.read");
    const { team, apiKey, log } = await prepare(input, userId, requestId);
    return upstream(() =>
      queryQuotaOverridesLogged(
        apiKey,
        { team_id: team.teamId, page: input.page, page_size: input.pageSize },
        log,
      ),
    );
  },
  async purchaseQuota(
    input: PurchaseAnswerBitQuotaInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    const { team, apiKey, log } = await prepare(input, userId, audit.requestId);
    const unitCost = 400;
    const estimatedCreditCost = input.quotaAmount * unitCost;
    await upstream(() =>
      purchaseQuotaLogged(
        apiKey,
        {
          team_id: team.teamId,
          quota_type: input.quotaType,
          quota_amount: input.quotaAmount,
        },
        log,
      ),
    );
    await writeAudit(
      { ...audit, organizationId: input.organizationId },
      {
        operation: "platform.answerbit.quota.purchase",
        resourceType: "answerbit_quota",
        resourceId: input.quotaType,
        summary: `通过腾讯 /geo/billing/quota/purchase 扩容监控品牌 ${input.quotaAmount} 个（提交前按 ${unitCost} 积分/个估算 ${estimatedCreditCost} 积分）`,
      },
    );
    return {
      quotaType: input.quotaType,
      quotaAmount: input.quotaAmount,
      estimatedCreditCost,
    };
  },
};

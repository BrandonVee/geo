import { randomUUID } from "node:crypto";
import type { DatabaseTransaction } from "@geo/db";
import { publicationTrackingSourceSchema } from "@geo/contracts";
import type {
  AppealPublicationOrderInput,
  ResolvePublicationActionInput,
  AdminPublicationChannelQuery,
  CreatePublicationChannelInput,
  CreatePublicationOrderInput,
  PublicationChannelQuery,
  PublicationOrderActionInput,
  PublicationOrderQuery,
  AdminPublicationOrderQuery,
  UpdatePublicationChannelInput,
  UpdatePublicationOrderInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError } from "@/server/http/errors";
import {
  FrogPublicationError,
  frogPriceToCents,
  loadFrogPublicationChannels,
  type FrogPublicationClient,
  type FrogMediaType,
  reconcilePublicationOrders,
} from "@/server/integrations/frog-publication/client";
import { resolveFrogPublicationClient } from "@/server/integrations/frog-publication/configuration";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { publicationRepository } from "@/server/repositories/publications";
import { pricingRepository } from "@/server/repositories/pricing";
import { organizationService } from "./organizations";

const isFrogMediaType = (value: string | null): value is FrogMediaType =>
  value === "website" || value === "wemedia";

let frogChannelsRefreshedAt = 0;
let frogChannelsRefresh: Promise<void> | undefined;
export function invalidateFrogPublicationCache() {
  frogChannelsRefreshedAt = 0;
}

export async function refreshFrogChannels(client: FrogPublicationClient) {
  if (!client.configured) return;
  if (Date.now() - frogChannelsRefreshedAt < 5 * 60_000) return;
  if (!frogChannelsRefresh)
    frogChannelsRefresh = (async () => {
      await publicationRepository.upsertProviderChannels(
        await loadFrogPublicationChannels(client, {
          onFieldError: (mediaType, error) =>
            console.error(
              JSON.stringify({
                level: "warn",
                event: "frog-publication.fields.refresh-failed",
                mediaType,
                error: error instanceof Error ? error.message : "unknown",
              }),
            ),
        }),
      );
      frogChannelsRefreshedAt = Date.now();
    })();
  try {
    await frogChannelsRefresh;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "frog-publication.channels.refresh-failed",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
  } finally {
    frogChannelsRefresh = undefined;
  }
}

async function syncFrogOrders(
  rows: Awaited<ReturnType<typeof publicationRepository.orders>>,
) {
  const client = await resolveFrogPublicationClient();
  if (!client.configured) return;
  const result = await reconcilePublicationOrders(
    rows,
    client,
    publicationRepository,
  );
  if (result.errors)
    console.error(
      JSON.stringify({
        event: "frog-publication.orders.sync-failed",
        ...result,
      }),
    );
}

// @project-doc docs/domains/balance_and_publication.md#publication_state_machine
async function performOrderAction(
  orderId: string,
  input: PublicationOrderActionInput & {
    reason?: 1 | 2 | 3 | 4;
    detail?: string;
  },
  operation: "cancel" | "appeal",
  userId: string,
  audit: AuditContext,
) {
  await authorizeBrand(
    input.organizationId,
    input.teamBindingId,
    input.brandId,
    userId,
    "publication.create",
  );
  const row = await publicationRepository.findOrder(
    orderId,
    input.organizationId,
  );
  if (!row || row.order.brandId !== input.brandId)
    throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
  if (
    (operation === "cancel" && row.order.status === "cancelled") ||
    (operation === "appeal" &&
      row.order.providerStatus === 9 &&
      ["processing", "published"].includes(row.order.status))
  )
    return row.order;
  if (
    !(
      operation === "cancel"
        ? ["submitted", "processing"]
        : ["processing", "published"]
    ).includes(row.order.status)
  )
    throw new ApiError(
      409,
      "PUBLICATION_ORDER_STATE_CONFLICT",
      "当前订单状态不允许此操作，请刷新订单",
    );
  if (
    (row.channel.provider === "frog_media" || operation === "appeal") &&
    (row.channel.provider !== "frog_media" ||
      !row.order.providerOrderId ||
      !isFrogMediaType(row.channel.providerMediaType))
  )
    throw new ApiError(
      operation === "cancel" ? 409 : 422,
      operation === "cancel"
        ? "FROG_PUBLICATION_RECONCILIATION_REQUIRED"
        : "PUBLICATION_APPEAL_UNSUPPORTED",
      "请先核对上游订单；当前订单不支持此操作",
    );
  const id = input.actionRequestId ?? randomUUID();
  const scope = {
    organizationId: input.organizationId,
    teamBindingId: input.teamBindingId,
    brandId: input.brandId,
    userId,
  };
  const claim = await publicationRepository.beginAction(
    {
      ...scope,
      orderId,
      action: {
        id,
        operation,
        state: "pending",
        actorUserId: userId,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        ...(operation === "appeal"
          ? { reason: input.reason, detail: input.detail }
          : {}),
      },
    },
    (tx) =>
      writeAudit(
        { ...audit, organizationId: input.organizationId },
        {
          operation: "publication.order.action.started",
          resourceType: "publication_order",
          resourceId: orderId,
          summary: `开始${operation === "cancel" ? "取消发布" : "发布申诉"}，操作 ${id}`,
        },
        tx,
      ),
  );
  if (claim.kind === "missing")
    throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
  if (claim.kind === "replayed") return claim.order;
  if (claim.kind === "blocked")
    throw new ApiError(
      409,
      "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      "该订单已有操作待核对，请先检查原操作结果",
      { action: claim.order.providerAction },
    );
  if (claim.kind !== "started")
    throw new ApiError(
      409,
      "PUBLICATION_ACTION_CONFLICT",
      "订单或原操作已变化，请刷新后检查",
    );
  const completedAudit = (tx: DatabaseTransaction) =>
    writeAudit(
      { ...audit, organizationId: input.organizationId },
      {
        operation:
          operation === "cancel"
            ? "publication.order.cancelled"
            : "publication.order.appeal",
        resourceType: "publication_order",
        resourceId: orderId,
        summary: `${operation === "cancel" ? "取消发布并返还余额" : "提交发布申诉"}，操作 ${id}`,
      },
      tx,
    );
  try {
    if (claim.channel.provider === "frog_media") {
      const client = await resolveFrogPublicationClient();
      if (
        !(await publicationRepository.dispatchAction({
          ...scope,
          orderId,
          actionId: id,
        }))
      )
        throw new Error("PUBLICATION_ACTION_DISPATCH_CONFLICT");
      if (operation === "cancel")
        await client.cancel(
          claim.channel.providerMediaType as FrogMediaType,
          claim.order.providerOrderId!,
        );
      else
        await client.appeal(claim.channel.providerMediaType as FrogMediaType, {
          orderId: claim.order.providerOrderId!,
          reason: input.reason!,
          detail: input.detail,
        });
    }
    const updated =
      operation === "cancel"
        ? await publicationRepository.updateOrder(
            {
              orderId,
              status: "cancelled",
              processedBy: userId,
              providerMessage: "用户取消投稿",
              providerSyncedAt: new Date(),
              expectedActionId: id,
            },
            completedAudit,
          )
        : await publicationRepository.recordProviderSnapshot(
            {
              orderId,
              providerStatus: 9,
              providerMessage: input.detail || "已提交发布申诉",
              expectedActionId: id,
            },
            completedAudit,
          );
    if (!updated) throw new Error("PUBLICATION_ACTION_COMPLETION_CONFLICT");
    return updated;
  } catch (error) {
    const rejected =
      error instanceof FrogPublicationError &&
      ["business", "not_configured"].includes(error.kind);
    await publicationRepository.settleAction(
      {
        ...scope,
        orderId,
        actionId: id,
        state: rejected ? "rejected" : "uncertain",
      },
      (tx) =>
        writeAudit(
          { ...audit, organizationId: input.organizationId },
          {
            operation: rejected
              ? "publication.order.action.rejected"
              : "publication.order.action.uncertain",
            resourceType: "publication_order",
            resourceId: orderId,
            summary: `${rejected ? "上游明确拒绝" : "结果待核对"}，操作 ${id}`,
            result: "failed",
          },
          tx,
        ),
    );
    if (rejected)
      throw new ApiError(
        422,
        error.kind === "not_configured"
          ? "FROG_PUBLICATION_NOT_CONFIGURED"
          : operation === "cancel"
            ? "FROG_PUBLICATION_CANCEL_REJECTED"
            : "FROG_PUBLICATION_APPEAL_REJECTED",
        operation === "cancel"
          ? "上游拒绝取消，订单与余额保持不变"
          : "上游拒绝申诉，请检查原说明后再提交",
      );
    throw new ApiError(
      error instanceof FrogPublicationError && error.kind === "timeout"
        ? 504
        : 502,
      operation === "cancel"
        ? "FROG_PUBLICATION_CANCEL_FAILED"
        : "FROG_PUBLICATION_APPEAL_FAILED",
      "处理结果暂未确认，请核对订单状态，避免重复提交",
    );
  }
}

export const publicationService = {
  // @project-doc docs/domains/geo_operations.md#article_tracking
  async trackingSource(
    orderId: string,
    scope: PublicationOrderActionInput,
    userId: string,
  ) {
    await authorizeBrand(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "publication.read",
    );
    await authorizeBrand(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.create",
    );
    const row = await publicationRepository.findOrder(
      orderId,
      scope.organizationId,
    );
    if (!row || row.order.brandId !== scope.brandId)
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    if (row.order.status !== "published")
      throw new ApiError(
        409,
        "PUBLICATION_ORDER_NOT_PUBLISHED",
        "订单尚未发布或已退稿，请刷新发布订单后再加入追踪",
      );
    const source = publicationTrackingSourceSchema.safeParse({
      orderId: row.order.id,
      title: row.order.title,
      url: row.order.resultUrl,
    });
    if (!source.success)
      throw new ApiError(
        422,
        "PUBLICATION_RESULT_URL_UNAVAILABLE",
        "订单缺少有效的公开发布链接，请先核对发布结果",
      );
    return source.data;
  },
  async providerBalance(userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const client = await resolveFrogPublicationClient();
    if (!client.configured)
      return {
        configured: false as const,
        available: false as const,
        moneyAmount: null,
        powerCount: null,
        checkedAt: null,
        message: "尚未配置媒体发布 API Key",
      };
    try {
      const balance = await client.getBalance();
      return {
        configured: true as const,
        available: true as const,
        moneyAmount: frogPriceToCents(balance.money),
        powerCount: balance.power_count,
        checkedAt: new Date().toISOString(),
        message: "媒体发布账户连接正常",
      };
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "frog-publication.balance.query-failed",
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
      return {
        configured: true as const,
        available: false as const,
        moneyAmount: null,
        powerCount: null,
        checkedAt: new Date().toISOString(),
        message:
          error instanceof FrogPublicationError && error.kind === "timeout"
            ? "媒体发布账户余额查询超时"
            : "媒体发布账户余额暂时不可用",
      };
    }
  },
  async channels(query: PublicationChannelQuery, userId: string) {
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "请先登录");
    const client = await resolveFrogPublicationClient();
    const pricingTier = await pricingRepository.userTier(userId);
    return publicationRepository.channelPage({
      ...query,
      activeOnly: true,
      pricingTier,
      provider: client.configured ? "frog_media" : "manual",
    });
  },
  async channel(channelId: string, userId: string) {
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "请先登录");
    const channel = await publicationRepository.findChannelForUser(
      channelId,
      userId,
    );
    return channel?.status === "active" && channel.providerStatus === "active"
      ? channel
      : undefined;
  },
  async list(query: PublicationOrderQuery, userId: string) {
    const { organizationId, teamBindingId, brandId } = query;
    if (brandId)
      await authorizeBrand(
        organizationId,
        teamBindingId!,
        brandId,
        userId,
        "publication.read",
      );
    else
      await organizationService.authorize(
        organizationId,
        userId,
        "publication.read",
      );
    const page = await publicationRepository.orderPage({ ...query, userId });
    if (page.list.length) await syncFrogOrders(page.list);
    return publicationRepository.orderPage({ ...query, userId });
  },
  async manuscript(
    orderId: string,
    scope: { organizationId: string; teamBindingId: string; brandId: string },
    userId: string,
  ) {
    await authorizeBrand(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "publication.read",
    );
    const manuscript = await publicationRepository.manuscript({
      ...scope,
      orderId,
      userId,
    });
    if (!manuscript)
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    return manuscript;
  },
  async adminManuscript(orderId: string, userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const manuscript = await publicationRepository.adminManuscript(
      orderId,
      userId,
    );
    if (!manuscript)
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    return manuscript;
  },
  async create(
    input: CreatePublicationOrderInput,
    userId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "publication.create",
    );
    const replay = await publicationRepository.findSubmissionReplay({
      ...input,
      createdBy: userId,
    });
    if (replay) {
      if (!replay.ok)
        throw new ApiError(
          409,
          "PUBLICATION_IDEMPOTENCY_CONFLICT",
          "该幂等键已用于其他发布请求",
        );
      return replay;
    }
    const channel = await publicationRepository.findChannelForUser(
      input.channelId,
      userId,
    );
    if (
      !channel ||
      channel.status !== "active" ||
      channel.providerStatus !== "active"
    )
      throw new ApiError(
        404,
        "PUBLICATION_CHANNEL_NOT_FOUND",
        "发布渠道不存在或已下架",
      );
    const frogClient =
      channel.provider === "frog_media"
        ? await resolveFrogPublicationClient()
        : undefined;
    if (channel.provider === "frog_media" && !frogClient?.configured)
      throw new ApiError(
        503,
        "FROG_PUBLICATION_NOT_CONFIGURED",
        "聚合发布 API Key 尚未配置",
      );
    if (
      channel.provider === "frog_media" &&
      (!channel.providerResourceId ||
        !isFrogMediaType(channel.providerMediaType))
    )
      throw new ApiError(
        422,
        "PUBLICATION_CHANNEL_INVALID",
        "聚合渠道映射不完整，请刷新渠道",
      );
    if (channel.provider === "frog_media") {
      try {
        const providerBalance = await frogClient!.getBalance();
        if (
          frogPriceToCents(providerBalance.money) < channel.providerCostAmount
        )
          throw new ApiError(
            503,
            "FROG_PUBLICATION_BALANCE_INSUFFICIENT",
            "媒体发布平台余额不足，请联系平台管理员充值",
          );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error(
          JSON.stringify({
            level: "warn",
            event: "frog-publication.balance.preflight-failed",
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }
    const result = await publicationRepository.createOrder(
      {
        ...input,
        createdBy: userId,
      },
      (tx, orderId) =>
        writeAudit(
          { ...audit, organizationId: input.organizationId },
          {
            operation: "publication.order.create",
            resourceType: "publication_order",
            resourceId: orderId,
            summary: `提交人民币计费发布订单：${input.title}`,
          },
          tx,
        ),
    );
    if (!result.ok) {
      if (result.code === "IDEMPOTENCY_CONFLICT")
        throw new ApiError(
          409,
          "PUBLICATION_IDEMPOTENCY_CONFLICT",
          "该幂等键已用于其他发布请求",
        );
      if (result.code === "CHANNEL_NOT_FOUND")
        throw new ApiError(
          404,
          "PUBLICATION_CHANNEL_NOT_FOUND",
          "发布渠道不存在或已下架",
        );
      const contentErrors = {
        SOURCE_NOT_READY: "来源文章不存在、范围不匹配、尚未完成或正文为空",
        CONTENT_SOURCE_CONFLICT: "来源文章与直接正文不能同时提交",
        CONTENT_URL_INVALID: "内容链接只支持有效的 HTTP(S) 地址",
        CONTENT_REQUIRED:
          "请提供正文、已定稿文章或内容链接；聚合渠道必须有正文",
        CONTENT_TOO_LARGE: "投稿正文超过 500000 字符，请缩短文章后再提交",
      };
      if (result.code in contentErrors)
        throw new ApiError(
          422,
          `PUBLICATION_${result.code}`,
          contentErrors[result.code as keyof typeof contentErrors],
        );
      throw new ApiError(
        422,
        "PUBLICATION_BALANCE_INSUFFICIENT",
        "品牌发布余额不足",
      );
    }
    const response = {
      ok: true as const,
      order: result.order,
      replayed: result.replayed,
    };
    if (
      result.replayed ||
      result.channel.provider !== "frog_media" ||
      !result.channel.providerResourceId ||
      !isFrogMediaType(result.channel.providerMediaType)
    )
      return response;
    try {
      const submitted = await frogClient!.submit(
        result.channel.providerMediaType,
        {
          resourceId: result.channel.providerResourceId,
          title: result.manuscript.title,
          content: result.manuscript.contentHtml!,
          remark: result.manuscript.submissionNote || undefined,
          thirdId: result.order.id,
        },
      );
      const order = await publicationRepository.updateOrder({
        orderId: result.order.id,
        status: "processing",
        processedBy: userId,
        providerOrderId: submitted.order_nid,
        providerStatus: 0,
        providerMessage: "投稿成功",
        providerSyncedAt: new Date(),
      });
      return { ...response, order: order ?? result.order };
    } catch (error) {
      const explicitRejection =
        error instanceof FrogPublicationError && error.kind === "business";
      if (explicitRejection)
        await publicationRepository.updateOrder({
          orderId: result.order.id,
          status: "failed",
          note: error.message,
          processedBy: userId,
          providerMessage: error.message,
          providerSyncedAt: new Date(),
        });
      else
        await publicationRepository.recordProviderSnapshot({
          orderId: result.order.id,
          providerMessage:
            error instanceof FrogPublicationError
              ? error.message
              : "聚合发布处理结果未确认",
        });
      throw new ApiError(
        error instanceof FrogPublicationError && error.kind === "timeout"
          ? 504
          : 502,
        explicitRejection
          ? "FROG_PUBLICATION_REJECTED"
          : "FROG_PUBLICATION_RESULT_UNCERTAIN",
        explicitRejection
          ? "聚合发布上游拒绝投稿，发布余额已返还"
          : "聚合发布结果暂不确定，请刷新订单状态后再处理",
      );
    }
  },
  async cancel(
    orderId: string,
    input: PublicationOrderActionInput,
    userId: string,
    audit: AuditContext,
  ) {
    return performOrderAction(orderId, input, "cancel", userId, audit);
  },
  async appeal(
    orderId: string,
    input: AppealPublicationOrderInput,
    userId: string,
    audit: AuditContext,
  ) {
    return performOrderAction(orderId, input, "appeal", userId, audit);
  },
  async resolveAction(
    orderId: string,
    input: ResolvePublicationActionInput,
    userId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "publication.create",
    );
    const result = await publicationRepository.resolveAction(
      { ...input, orderId, userId },
      (tx) =>
        writeAudit(
          { ...audit, organizationId: input.organizationId },
          {
            operation: "publication.order.action.resolved",
            resourceType: "publication_order",
            resourceId: orderId,
            summary: `核对并结束操作 ${input.actionId}：${input.note}`,
          },
          tx,
        ),
    );
    if (result.kind === "missing")
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    if (result.kind === "running")
      throw new ApiError(
        409,
        "PUBLICATION_ACTION_IN_PROGRESS",
        "原操作仍在执行，请稍后重新核对",
      );
    if (result.kind === "conflict")
      throw new ApiError(
        409,
        "PUBLICATION_ACTION_CONFLICT",
        "订单操作已变化，请刷新后重新核对",
      );
    return result.order;
  },
  async adminChannels(query: AdminPublicationChannelQuery, userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    return publicationRepository.channelPage({
      ...query,
      includeTierPrices: true,
    });
  },
  async adminChannel(channelId: string, userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const row = await publicationRepository.adminChannel(channelId, userId);
    if (!row)
      throw new ApiError(
        404,
        "PUBLICATION_CHANNEL_NOT_FOUND",
        "发布渠道不存在",
      );
    return row;
  },
  async createChannel(
    input: CreatePublicationChannelInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const row = await publicationRepository.upsertChannel({
      ...input,
      updatedBy: userId,
    });
    if (!row)
      throw new ApiError(
        500,
        "PUBLICATION_CHANNEL_CREATE_FAILED",
        "发布渠道创建失败",
      );
    await writeAudit(audit, {
      operation: "publication.channel.create",
      resourceType: "publication_channel",
      resourceId: row.id,
      summary: `创建发布渠道 ${row.name}，价格 ${row.priceAmount} 分`,
    });
    return row;
  },
  async updateChannel(
    channelId: string,
    input: UpdatePublicationChannelInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const result = await publicationRepository.updateChannel(
      channelId,
      input,
      userId,
      (tx, row) =>
        writeAudit(
          audit,
          {
            operation: "publication.channel.update",
            resourceType: "publication_channel",
            resourceId: row.id,
            summary: `更新发布渠道 ${row.name} 的分级售价与平台状态 ${row.status}；上游成本 ${row.providerCostAmount} 分`,
          },
          tx,
        ),
    );
    if (result.kind === "missing")
      throw new ApiError(
        404,
        "PUBLICATION_CHANNEL_NOT_FOUND",
        "发布渠道不存在",
      );
    if (result.kind === "conflict")
      throw new ApiError(
        409,
        "PUBLICATION_CHANNEL_CONFLICT",
        "渠道设置已变化，请核对最新设置后重新确认",
        { current: result.channel },
      );
    if (result.kind === "below_cost")
      throw new ApiError(
        422,
        "PUBLICATION_PRICE_BELOW_COST",
        "聚合渠道售价不能低于媒体发布渠道采购成本",
        { current: result.channel },
      );
    return result.channel;
  },
  // @project-doc docs/architecture/platform_administration.md#publication_fulfillment
  async adminOrders(query: AdminPublicationOrderQuery, userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    return publicationRepository.adminOrderPage({ ...query, userId });
  },
  async adminOrder(orderId: string, userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const row = await publicationRepository.adminOrder(orderId, userId);
    if (!row)
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    return row;
  },
  async updateOrder(
    orderId: string,
    input: UpdatePublicationOrderInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const current = await publicationRepository.findOrder(orderId);
    if (!current)
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    if (current.channel.provider === "frog_media")
      throw new ApiError(
        409,
        "PUBLICATION_ORDER_UPSTREAM_MANAGED",
        "聚合订单由上游履约，请使用取消或申诉流程并核对状态",
      );
    if (input.status === "published" && !input.resultUrl)
      throw new ApiError(
        422,
        "RESULT_URL_REQUIRED",
        "发布完成时必须填写结果链接",
      );
    const row = await publicationRepository.updateOrder({
      orderId,
      ...input,
      processedBy: userId,
    });
    if (row === undefined)
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    if (row === null)
      throw new ApiError(
        409,
        "PUBLICATION_ORDER_STATE_CONFLICT",
        "当前发布订单状态不允许此操作",
      );
    await writeAudit(
      { ...audit, organizationId: row.organizationId },
      {
        operation: `publication.order.${input.status}`,
        resourceType: "publication_order",
        resourceId: row.id,
        summary: input.note ?? `发布订单状态更新为 ${input.status}`,
      },
    );
    return row;
  },
};

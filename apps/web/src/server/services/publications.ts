import { publicationBodyHtml } from "@geo/core";
import { publicationTrackingSourceSchema } from "@geo/contracts";
import type {
  AppealPublicationOrderInput,
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
import { articleRepository } from "@/server/repositories/articles";
import { contentDocumentRepository } from "@/server/repositories/content-documents";
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
    const replay = await publicationRepository.findByIdempotency(
      input.organizationId,
      input.idempotencyKey,
    );
    if (replay) {
      if (
        replay.brandId !== input.brandId ||
        replay.channelId !== input.channelId ||
        replay.title !== input.title ||
        replay.createdBy !== userId ||
        (replay.sourceJobId ?? undefined) !== input.sourceJobId ||
        (replay.sourceDocumentId ?? undefined) !== input.sourceDocumentId ||
        (replay.contentUrl ?? undefined) !== input.contentUrl
      )
        throw new ApiError(
          409,
          "PUBLICATION_IDEMPOTENCY_CONFLICT",
          "该幂等键已用于其他发布请求",
        );
      return { ok: true as const, order: replay, replayed: true as const };
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
    let contentHtml = input.contentHtml;
    if (input.sourceJobId) {
      const job = await articleRepository.findJob(
        {
          organizationId: input.organizationId,
          teamBindingId: input.teamBindingId,
          brandId: input.brandId,
        },
        input.sourceJobId,
      );
      if (!job || job.status !== "succeeded" || !job.articleBody)
        throw new ApiError(
          422,
          "PUBLICATION_SOURCE_NOT_READY",
          "来源生成任务不存在或内容尚未完成",
        );
      contentHtml = publicationBodyHtml(job.articleBody);
    }
    if (input.sourceDocumentId) {
      const document = await contentDocumentRepository.find(
        {
          organizationId: input.organizationId,
          teamBindingId: input.teamBindingId,
          brandId: input.brandId,
        },
        input.sourceDocumentId,
      );
      if (!document || document.status !== "ready" || !document.body)
        throw new ApiError(
          422,
          "PUBLICATION_SOURCE_NOT_READY",
          "来源文档不存在、尚未定稿或正文为空",
        );
      contentHtml = publicationBodyHtml(document.body);
    }
    if (channel.provider === "frog_media" && !contentHtml)
      throw new ApiError(
        422,
        "PUBLICATION_CONTENT_REQUIRED",
        "聚合发布需要 HTML 正文、已完成的生成任务或已定稿文档",
      );
    const result = await publicationRepository.createOrder({
      organizationId: input.organizationId,
      brandId: input.brandId,
      channelId: input.channelId,
      title: input.title,
      contentUrl: input.contentUrl,
      contentHtml,
      sourceJobId: input.sourceJobId,
      sourceDocumentId: input.sourceDocumentId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      createdBy: userId,
    });
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
      throw new ApiError(
        422,
        "PUBLICATION_BALANCE_INSUFFICIENT",
        "品牌发布余额不足",
      );
    }
    await writeAudit(
      { ...audit, organizationId: input.organizationId },
      {
        operation: "publication.order.create",
        resourceType: "publication_order",
        resourceId: result.order.id,
        summary: `提交人民币计费发布订单：${input.title}`,
      },
    ).catch(() =>
      console.error(
        JSON.stringify({
          event: "publication.audit.failed",
          orderId: result.order.id,
        }),
      ),
    );
    if (
      result.replayed ||
      channel.provider !== "frog_media" ||
      !channel.providerResourceId ||
      !isFrogMediaType(channel.providerMediaType)
    )
      return result;
    try {
      const submitted = await frogClient!.submit(channel.providerMediaType, {
        resourceId: channel.providerResourceId,
        title: input.title,
        content: contentHtml!,
        remark: input.note || undefined,
        thirdId: result.order.id,
      });
      const order = await publicationRepository.updateOrder({
        orderId: result.order.id,
        status: "processing",
        processedBy: userId,
        providerOrderId: submitted.order_nid,
        providerStatus: 0,
        providerMessage: "投稿成功",
        providerSyncedAt: new Date(),
      });
      return { ...result, order: order ?? result.order };
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
    if (row.order.status === "cancelled") return row.order;
    if (!["submitted", "processing"].includes(row.order.status))
      throw new ApiError(
        409,
        "PUBLICATION_ORDER_STATE_CONFLICT",
        "当前发布订单状态不允许取消",
      );
    if (row.channel.provider === "frog_media") {
      if (
        !row.order.providerOrderId ||
        !isFrogMediaType(row.channel.providerMediaType)
      )
        throw new ApiError(
          409,
          "FROG_PUBLICATION_RECONCILIATION_REQUIRED",
          "投稿结果尚未确认，请先核对聚合发布上游订单",
        );
      try {
        const frogClient = await resolveFrogPublicationClient();
        await frogClient.cancel(
          row.channel.providerMediaType,
          row.order.providerOrderId,
        );
      } catch (error) {
        throw new ApiError(
          error instanceof FrogPublicationError && error.kind === "timeout"
            ? 504
            : 502,
          "FROG_PUBLICATION_CANCEL_FAILED",
          "聚合发布上游未确认取消，本地订单与余额保持不变",
        );
      }
    }
    const updated = await publicationRepository.updateOrder({
      orderId,
      status: "cancelled",
      processedBy: userId,
      providerMessage: "用户取消投稿",
      providerSyncedAt: new Date(),
    });
    if (updated === null)
      throw new ApiError(
        409,
        "PUBLICATION_ORDER_STATE_CONFLICT",
        "当前发布订单状态不允许取消",
      );
    if (!updated)
      throw new ApiError(404, "PUBLICATION_ORDER_NOT_FOUND", "发布订单不存在");
    await writeAudit(
      { ...audit, organizationId: input.organizationId },
      {
        operation: "publication.order.cancelled",
        resourceType: "publication_order",
        resourceId: orderId,
        summary: "取消聚合发布订单并返还发布余额",
      },
    );
    return updated;
  },
  async appeal(
    orderId: string,
    input: AppealPublicationOrderInput,
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
      row.channel.provider !== "frog_media" ||
      !row.order.providerOrderId ||
      !isFrogMediaType(row.channel.providerMediaType)
    )
      throw new ApiError(
        422,
        "PUBLICATION_APPEAL_UNSUPPORTED",
        "该订单不支持聚合发布申诉",
      );
    if (!["processing", "published"].includes(row.order.status))
      throw new ApiError(
        409,
        "PUBLICATION_ORDER_STATE_CONFLICT",
        "当前发布订单状态不允许申诉",
      );
    if (row.order.providerStatus === 9) return row.order;
    try {
      const frogClient = await resolveFrogPublicationClient();
      await frogClient.appeal(row.channel.providerMediaType, {
        orderId: row.order.providerOrderId,
        reason: input.reason,
        detail: input.detail,
      });
    } catch (error) {
      throw new ApiError(
        error instanceof FrogPublicationError && error.kind === "timeout"
          ? 504
          : 502,
        "FROG_PUBLICATION_APPEAL_FAILED",
        "聚合发布上游未确认申诉，请稍后重试",
      );
    }
    const updated = await publicationRepository.recordProviderSnapshot({
      orderId,
      providerStatus: 9,
      providerMessage: input.detail || "已提交发布申诉",
    });
    await writeAudit(
      { ...audit, organizationId: input.organizationId },
      {
        operation: "publication.order.appeal",
        resourceType: "publication_order",
        resourceId: orderId,
        summary: `提交聚合发布申诉，原因 ${input.reason}`,
      },
    );
    return updated;
  },
  async adminChannels(query: AdminPublicationChannelQuery, userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    return publicationRepository.channelPage({
      ...query,
      includeTierPrices: true,
    });
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
    const current = await publicationRepository.findChannel(channelId);
    if (!current)
      throw new ApiError(
        404,
        "PUBLICATION_CHANNEL_NOT_FOUND",
        "发布渠道不存在",
      );
    if (
      current.provider === "frog_media" &&
      Object.values(input.tierPrices).some(
        (price) => price !== null && price < current.providerCostAmount,
      )
    )
      throw new ApiError(
        422,
        "PUBLICATION_PRICE_BELOW_COST",
        "聚合渠道售价不能低于媒体发布渠道采购成本",
      );
    const row = await publicationRepository.upsertChannel({
      id: channelId,
      ...input,
      updatedBy: userId,
    });
    if (!row)
      throw new ApiError(
        404,
        "PUBLICATION_CHANNEL_NOT_FOUND",
        "发布渠道不存在",
      );
    await writeAudit(audit, {
      operation: "publication.channel.update",
      resourceType: "publication_channel",
      resourceId: row.id,
      summary: `更新发布渠道 ${row.name} 的分级售价与平台状态 ${row.status}；上游成本 ${row.providerCostAmount} 分`,
    });
    return row;
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

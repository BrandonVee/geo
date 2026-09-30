import { createHash } from "node:crypto";
import { settleTrackingFailure } from "@geo/db";
import { traceArticleSchema, type TraceArticleInput } from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import { traceArticleLogged } from "@/server/integrations/answerbit/gateway";
import { AnswerBitError } from "@/server/integrations/answerbit/errors";
import { ApiError } from "@/server/http/errors";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { trackingRepository } from "@/server/repositories/article-tracking";
import { getSecretCipher } from "@/server/security/secret-cipher";
import { assertPointBilledFeatureQuote } from "./feature-billing";

type TrackingRecord = Awaited<
  ReturnType<typeof trackingRepository.begin>
>["record"];
const decode = (record: TrackingRecord) =>
  traceArticleSchema.parse(
    JSON.parse(
      getSecretCipher().decrypt(
        record.requestPayload.ciphertext,
        record.organizationId,
      ),
    ),
  );
const publicRecord = (record: TrackingRecord, replayed: boolean) => ({
  id: record.id,
  status: record.status,
  articleId: record.articleId,
  points: record.points,
  refunded: record.refunded,
  errorCode: record.errorCode,
  errorMessage: record.errorCode
    ? ((
        {
          ANSWERBIT_UNAUTHORIZED:
            "腾讯接入凭证无访问权限，请联系平台管理员处理",
          ANSWERBIT_RATE_LIMITED: "腾讯请求频率过高，请稍后再提交",
          ANSWERBIT_BUSINESS: "腾讯拒绝了本次追踪，请核对公开文章链接与标题",
          ANSWERBIT_INSUFFICIENT_BALANCE:
            "腾讯账户余额不足，请联系平台管理员处理",
        } as Record<string, string>
      )[record.errorCode] ?? "本次追踪结果需要先在目录中核对")
    : null,
  createdAt: record.createdAt,
  replayed,
  idempotencyKey: record.idempotencyKey,
  input: decode(record),
});
async function recover(record: TrackingRecord, audit: AuditContext) {
  if (record.articleId && record.status !== "succeeded")
    return trackingRepository.complete(record.id, decode(record), audit);
  if (
    record.status === "submitting" &&
    record.updatedAt.getTime() < Date.now() - 60_000
  )
    return (await settleTrackingFailure(
      record.id,
      "uncertain",
      "ARTICLE_TRACKING_INTERRUPTED",
      new Date(Date.now() - 60_000),
    ))!;
  return record;
}

// @project-doc docs/domains/geo_operations.md#article_tracking
export const articleTrackingService = {
  async create(
    input: TraceArticleInput,
    key: string,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "resource.create",
    );
    const { connection, apiKey } = await loadAnswerBitTeamContext(
      input.organizationId,
      input.teamBindingId,
    );
    let result;
    try {
      result = await trackingRepository.begin(
        {
          organizationId: input.organizationId,
          teamBindingId: input.teamBindingId,
          brandId: input.brandId,
          requestedBy: userId,
          idempotencyKey: key,
          requestFingerprint: createHash("sha256")
            .update(JSON.stringify({ ...input, expectedPoints: undefined }))
            .digest("hex"),
          requestPayload: {
            ciphertext: getSecretCipher().encrypt(
              JSON.stringify(input),
              input.organizationId,
            ),
          },
        },
        audit,
        async () =>
          (
            await assertPointBilledFeatureQuote(
              "effect_tracking",
              userId,
              input.expectedPoints,
            )
          ).points,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ARTICLE_TRACKING_IDEMPOTENCY_CONFLICT"
      )
        throw new ApiError(
          409,
          error.message,
          "该提交标识已用于另一份追踪内容，请先确认原提交",
        );
      if (
        error instanceof Error &&
        error.message === "ANSWERBIT_POINTS_INSUFFICIENT"
      )
        throw new ApiError(
          402,
          error.message,
          `当前品牌积分不足，效果追踪需要 ${input.expectedPoints} 积分`,
        );
      throw error;
    }
    if (result.replayed)
      return publicRecord(await recover(result.record, audit), true);
    let articleId: string;
    try {
      articleId = await traceArticleLogged(
        apiKey,
        {
          brand_id: input.brandId,
          title: input.title,
          urls: input.urls,
          tag_ids: input.tagIds,
          language: input.language,
        },
        {
          organizationId: input.organizationId,
          connectionId: connection.id,
          brandId: input.brandId,
          actorUserId: userId,
          requestId,
        },
      );
    } catch (error) {
      const definite =
        error instanceof AnswerBitError &&
        [
          "unauthorized",
          "rate_limited",
          "business",
          "insufficient_balance",
        ].includes(error.kind);
      const record = await settleTrackingFailure(
        result.record.id,
        definite ? "failed" : "uncertain",
        definite
          ? `ANSWERBIT_${(error as AnswerBitError).kind.toUpperCase()}`
          : "ARTICLE_TRACKING_UNCERTAIN",
      );
      return publicRecord(record!, false);
    }
    await trackingRepository.rememberArticle(result.record.id, articleId);
    return publicRecord(
      await trackingRepository.complete(result.record.id, input, audit),
      false,
    );
  },
  async list(
    scope: Pick<
      TraceArticleInput,
      "organizationId" | "teamBindingId" | "brandId"
    >,
    userId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.read",
    );
    const records = await trackingRepository.list(scope, userId);
    const results = [];
    for (const record of records)
      results.push(publicRecord(await recover(record, audit), true));
    return results;
  },
};

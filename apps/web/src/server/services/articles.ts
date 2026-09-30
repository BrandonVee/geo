import { assertEnterpriseAccess } from "@geo/db";
import {
  answerBitArticleCreatePayloadSchema,
  type ArticleDetailQuery,
  type ArticleListQuery,
  type CreateArticleJobInput,
  type TraceArticleInput,
} from "@geo/contracts";
import type { Permission } from "@geo/core";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError } from "@/server/http/errors";
import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import {
  getArticleContentLogged,
  queryArticlesLogged,
  queryArticleTemplatesLogged,
  queryArticleTraceDetailLogged,
  traceArticleLogged,
} from "@/server/integrations/answerbit/gateway";
import {
  cancelArticleGeneration,
  prepareArticleGenerationQueue,
} from "@/server/jobs/boss";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { articleRepository } from "@/server/repositories/articles";
import { getSecretCipher } from "@/server/security/secret-cipher";
import { mapUpstreamError } from "./answerbit-connections";
import {
  assertPointBilledFeatureQuote,
  runPointBilledFeature,
} from "./feature-billing";
type Scope = { organizationId: string; teamBindingId: string; brandId: string };
const logContext = (
  scope: Scope,
  connectionId: string,
  requestId: string,
  actorUserId: string,
) => ({
  organizationId: scope.organizationId,
  connectionId,
  requestId,
  actorUserId,
  brandId: scope.brandId,
});
async function prepare(scope: Scope, userId: string, permission: Permission) {
  await authorizeBrand(
    scope.organizationId,
    scope.teamBindingId,
    scope.brandId,
    userId,
    permission,
  );
  return loadAnswerBitTeamContext(scope.organizationId, scope.teamBindingId);
}
function jobGenerationMode(
  job: NonNullable<Awaited<ReturnType<typeof articleRepository.findJob>>>,
): "standard" | "reference" | null {
  try {
    const ciphertext = job.requestPayload?.ciphertext;
    if (typeof ciphertext !== "string") return null;
    const payload = answerBitArticleCreatePayloadSchema.parse(
      JSON.parse(getSecretCipher().decrypt(ciphertext, job.organizationId)),
    );
    return payload.high_ref ? "reference" : "standard";
  } catch {
    return null;
  }
}
const publicJob = (
  job: Awaited<ReturnType<typeof articleRepository.findJob>>,
) =>
  job
    ? {
        id: job.id,
        organizationId: job.organizationId,
        teamBindingId: job.teamBindingId,
        brandId: job.brandId,
        status: job.status,
        answerbitArticleId: job.answerbitArticleId,
        articleTitle: job.articleTitle,
        articleBody: job.articleBody,
        articleStatus: job.articleStatus,
        templateType: job.templateType,
        generationMode: jobGenerationMode(job),
        source: job.source,
        language: job.language,
        tags: job.tags,
        attemptCount: job.attemptCount,
        errorCode: job.errorCode,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }
    : undefined;

function assertJobReplay(
  job: NonNullable<Awaited<ReturnType<typeof articleRepository.findJob>>>,
  input: CreateArticleJobInput,
  userId: string,
) {
  let matches = false;
  try {
    if (typeof job.requestPayload?.ciphertext !== "string")
      throw new Error("Invalid job payload");
    const saved = answerBitArticleCreatePayloadSchema.parse(
      JSON.parse(
        getSecretCipher().decrypt(
          job.requestPayload.ciphertext,
          job.organizationId,
        ),
      ),
    );
    const requested = answerBitArticleCreatePayloadSchema.parse({
      brand_id: input.brandId,
      template_type: input.templateType,
      prompt_ids: input.promptIds,
      knowledge_ids: input.knowledgeIds,
      once_knowledge: input.supplementalKnowledge,
      high_ref: input.highReference,
      tag_ids: input.tagIds,
      language: input.language,
    });
    matches =
      job.brandId === input.brandId &&
      job.teamBindingId === input.teamBindingId &&
      job.requestedBy === userId &&
      JSON.stringify(saved) === JSON.stringify(requested) &&
      JSON.stringify(
        (job.tags ?? [])
          .filter((tag) => tag.tagId.startsWith("local:"))
          .map((tag) => tag.tagName),
      ) === JSON.stringify(input.contentTags);
  } catch {
    matches = false;
  }
  if (!matches)
    throw new ApiError(
      409,
      "ARTICLE_JOB_IDEMPOTENCY_CONFLICT",
      "同一幂等键的生成内容或操作用户不一致，请重新提交",
    );
}
function articleQueueUnavailable() {
  return new ApiError(
    503,
    "ARTICLE_QUEUE_UNAVAILABLE",
    "文章生成队列暂时不可用，请稍后重试",
  );
}
async function submitJob(
  input: CreateArticleJobInput,
  values: Parameters<typeof articleRepository.submitJob>[0],
  userId: string,
  audit: AuditContext,
) {
  let enqueue;
  try {
    enqueue = await prepareArticleGenerationQueue();
  } catch {
    throw articleQueueUnavailable();
  }
  const result = await articleRepository.submitJob(values, {
    validateReplay: (job) => assertJobReplay(job, input, userId),
    enqueue: async (data, executor) => {
      try {
        return await enqueue(data, executor);
      } catch {
        throw articleQueueUnavailable();
      }
    },
    audit: {
      context: audit,
      input: {
        operation: "answerbit.article.generate",
        resourceType: "article_generation_job",
        summary: "提交按功能积分计费的 AI 文章生成任务",
      },
    },
  });
  return { ...publicJob(result.job), replayed: result.replayed };
}
export const articleService = {
  async list(input: ArticleListQuery, userId: string, requestId: string) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.read",
    );
    try {
      const data = await queryArticlesLogged(
        apiKey,
        {
          brand_id: input.brandId,
          limit: input.limit,
          scroll_id: input.scrollId,
          start_time: input.startTime,
          end_time: input.endTime,
          title: input.title,
          status: input.statuses,
          source: input.sources,
          template_type: input.templateTypes,
          tag_ids: input.tagIds,
          ref_order_type: input.refOrderType,
          language: input.languages,
          has_video: input.hasVideo,
          has_video_generating: input.hasVideoGenerating,
        },
        logContext(input, connection.id, requestId, userId),
      );
      await articleRepository.sync(input, data.list);
      return data;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async trace(
    input: TraceArticleInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.create",
    );
    try {
      return await runPointBilledFeature(
        {
          featureCode: "effect_tracking",
          featureName: "效果追踪链接",
          organizationId: input.organizationId,
          brandId: input.brandId,
          actorUserId: userId,
          referenceId: requestId,
          expectedPoints: input.expectedPoints,
        },
        async () => {
          const articleId = await traceArticleLogged(
            apiKey,
            {
              brand_id: input.brandId,
              title: input.title,
              urls: input.urls,
              tag_ids: input.tagIds,
              language: input.language,
            },
            logContext(input, connection.id, requestId, userId),
          );
          const mapping = await articleRepository.save(input, {
            articleId,
            title: input.title,
            status: 3,
            source: 2,
            templateType: 0,
            language: input.language,
          });
          await writeAudit(audit, {
            operation: "answerbit.article.trace",
            resourceType: "answerbit_article",
            resourceId: articleId,
            summary: `创建效果追踪 ${input.title}`,
          });
          return mapping;
        },
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async traceDetail(
    articleId: string,
    input: ArticleDetailQuery,
    userId: string,
    requestId: string,
  ) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.read",
    );
    try {
      return await queryArticleTraceDetailLogged(
        apiKey,
        {
          article_id: articleId,
          begin_date: input.beginDate,
          end_date: input.endDate,
        },
        logContext(input, connection.id, requestId, userId),
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async content(
    articleId: string,
    scope: Scope,
    userId: string,
    requestId: string,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.read",
    );
    try {
      const content = await getArticleContentLogged(
        apiKey,
        scope.brandId,
        articleId,
        logContext(scope, connection.id, requestId, userId),
      );
      await articleRepository.save(scope, {
        articleId: content.article_id,
        title: content.title,
        status: content.status,
        source: content.source,
        templateType: content.template_type,
        language: content.language,
      });
      return content;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async templates(
    scope: Scope,
    localCode: string,
    userId: string,
    requestId: string,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.read",
    );
    try {
      return await queryArticleTemplatesLogged(
        apiKey,
        localCode,
        logContext(scope, connection.id, requestId, userId),
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async createJob(
    input: CreateArticleJobInput,
    idempotencyKey: string,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.create",
    );
    const existing = await articleRepository.findJobByIdempotency(
      input.organizationId,
      idempotencyKey,
    );
    if (existing) {
      assertJobReplay(existing, input, userId);
      if (
        existing.status === "queued" &&
        !existing.queueJobId &&
        !existing.executionId &&
        !existing.answerbitArticleId
      )
        return submitJob(input, existing, userId, audit);
      return { ...publicJob(existing), replayed: true };
    }
    await assertEnterpriseAccess(input.organizationId, true);
    let templates;
    try {
      templates = await queryArticleTemplatesLogged(
        apiKey,
        input.language,
        logContext(input, connection.id, requestId, userId),
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
    const template = templates.find(
      (item) => item.template_id === input.templateType,
    );
    if (!template || ![0, 1].includes(template.is_high_ref))
      throw new ApiError(
        422,
        "ARTICLE_TEMPLATE_UNAVAILABLE",
        "所选模板不可用，请刷新后重新选择",
      );
    if (template.is_high_ref === 1 && !input.highReference)
      throw new ApiError(
        422,
        "ARTICLE_REFERENCE_REQUIRED",
        "参考文章生成必须提供参考文章链接",
      );
    if (template.is_high_ref === 0 && input.highReference)
      throw new ApiError(
        422,
        "ARTICLE_REFERENCE_NOT_ALLOWED",
        "普通文章生成不接受参考文章链接，请切换到参考文章生成",
      );
    const pricingSnapshot = await assertPointBilledFeatureQuote(
      "ai_article_generation",
      userId,
      input.expectedPoints,
    );
    const requestPayload = answerBitArticleCreatePayloadSchema.parse({
      brand_id: input.brandId,
      template_type: input.templateType,
      prompt_ids: input.promptIds,
      knowledge_ids: input.knowledgeIds,
      once_knowledge: input.supplementalKnowledge,
      high_ref: input.highReference,
      tag_ids: input.tagIds,
      language: input.language,
    });
    const encryptedRequestPayload = {
      ciphertext: getSecretCipher().encrypt(
        JSON.stringify(requestPayload),
        input.organizationId,
      ),
    };
    return submitJob(
      input,
      {
        organizationId: input.organizationId,
        teamBindingId: input.teamBindingId,
        brandId: input.brandId,
        requestedBy: userId,
        pricingSnapshot,
        idempotencyKey,
        requestPayload: encryptedRequestPayload,
        templateType: input.templateType,
        language: input.language,
        tags: input.contentTags.map((tagName) => ({
          tagId: `local:${tagName.toLocaleLowerCase()}`,
          tagName,
        })),
      },
      userId,
      audit,
    );
  },
  async listJobs(scope: Scope, limit: number, userId: string) {
    await authorizeBrand(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.read",
    );
    return (await articleRepository.listJobs(scope, limit)).map((job) =>
      publicJob(job),
    );
  },
  async getJob(scope: Scope, jobId: string, userId: string) {
    await authorizeBrand(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.read",
    );
    const job = await articleRepository.findJob(scope, jobId);
    if (!job)
      throw new ApiError(404, "ARTICLE_JOB_NOT_FOUND", "文章生成任务不存在");
    return publicJob(job);
  },
  async cancelJob(
    scope: Scope,
    jobId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.create",
    );
    const job = await articleRepository.findJob(scope, jobId);
    if (!job)
      throw new ApiError(404, "ARTICLE_JOB_NOT_FOUND", "文章生成任务不存在");
    if (job.status !== "queued" || !job.queueJobId)
      throw new ApiError(
        409,
        "ARTICLE_JOB_NOT_CANCELLABLE",
        "仅等待中的任务可以取消",
      );
    await cancelArticleGeneration(job.queueJobId);
    const cancelled = await articleRepository.cancelQueuedJob(scope, jobId);
    if (!cancelled)
      throw new ApiError(
        409,
        "ARTICLE_JOB_NOT_CANCELLABLE",
        "任务已经开始执行",
      );
    await writeAudit(audit, {
      operation: "answerbit.article.cancel",
      resourceType: "article_generation_job",
      resourceId: jobId,
      summary: "取消尚未开始计费的文章生成任务",
    });
    return publicJob(cancelled);
  },
};

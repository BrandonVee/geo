import { EnterpriseAccessError } from "@geo/core";
import {
  assertEnterpriseAccess,
  claimReportExport,
  redeliverReportExport,
  scheduleArticleResultPoll,
  recoverArticleJob,
  failArticleJob,
  recoverStaleTrackingSubmissions,
} from "@geo/db";
import {
  FrogPublicationClient,
  loadFrogPublicationChannels,
  reconcilePublicationOrders,
} from "@geo/publication";
import { randomUUID } from "node:crypto";
import { workerEnvSchema } from "@geo/config";
import {
  traceArticleSchema,
  answerBitArticleContentSchema,
  answerBitArticleProgressSchema,
  answerBitArticleRankSchema,
  answerBitDashboardMetricsSchema,
  answerBitDomainRankSchema,
  answerBitIdResultSchema,
  answerBitTaskListSchema,
} from "@geo/contracts";
import {
  BoundedJsonResponseError,
  type AnswerBitOperation,
  decideAsyncJobRecovery,
  discardResponseBody,
  InvalidAnswerBitEnvelopeError,
  parseAnswerBitEnvelope,
  platformAnswerBitCredentialAad,
  platformFrogCredentialAad,
  platformAnswerBitConnectionSentinel,
  readBoundedJsonResponse,
  runtimeTaskDefinitions,
  SecretCipher,
  type QueueJobState,
  type RuntimeTaskName,
} from "@geo/core";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  answerbitApiCalls,
  answerbitReadCache,
  answerbitArticleMappings,
  answerbitBrandMappings,
  answerbitConnections,
  answerbitCredentialAssignments,
  answerbitTeamBindings,
  articleGenerationJobs,
  balanceTransactions,
  commitQuota,
  contentDocuments,
  contentDocumentVersions,
  db,
  notificationRules,
  operationLogs,
  organizations,
  platformAnswerbitCredentials,
  platformFrogCredentials,
  platformUserRoles,
  pool,
  releaseQuota,
  reportExports,
  roles,
  runBillingMaintenance,
  listPendingProviderPublicationOrders,
  updatePublicationOrder,
  recordPublicationProviderSnapshot,
  publicationChannels,
  runtimeHeartbeats,
  runtimeTaskStatuses,
  syncTencentEnterpriseDirectory,
  upsertProviderPublicationChannels,
  users,
} from "@geo/db";
import { PgBoss, type Job } from "pg-boss";
import {
  runtimeTaskErrorCode,
  skippedRuntimeTaskErrorCode,
} from "./runtime-task";
import { evaluateNotificationRules } from "./notification-evaluation";
import { assertWorkerJobAccess, WorkerJobAccessError } from "./job-access";
import {
  type AnswerBitDataSchema,
  InvalidAnswerBitDataError,
  parseAnswerBitData,
  AnswerBitHttpError,
  AnswerBitBusinessError,
} from "./answerbit-response";
import {
  createArticleOnce,
  ArticleCreationUncertainError,
} from "./article-create";
import {
  InvalidArticleJobPayloadError,
  parseArticleJobPayload,
} from "./article-job-payload";
import {
  maxReportExportRows,
  parseReportExportFilters,
  reportExportPayload,
  ReportExportBuffer,
} from "./report-export";
import {
  queryTencentBrandDirectory,
  TencentDirectoryError,
} from "./tencent-directory";

const runtimeEnvResult = workerEnvSchema.safeParse(process.env);
if (!runtimeEnvResult.success) {
  console.error(
    JSON.stringify({
      event: "geo-worker.configuration-invalid",
      errorCode: "CONFIGURATION_INVALID",
      fields: [
        ...new Set(
          runtimeEnvResult.error.issues.map((issue) => issue.path.join(".")),
        ),
      ].sort(),
    }),
  );
  process.exit(1);
}
const runtimeEnv = runtimeEnvResult.data;
const cipher = new SecretCipher(runtimeEnv.APP_ENCRYPTION_KEY);
const boss = new PgBoss({
  connectionString: runtimeEnv.DATABASE_URL,
  application_name: `${runtimeEnv.DB_APPLICATION_NAME.slice(0, 58)}-jobs`,
  max: runtimeEnv.JOB_DB_POOL_MAX,
  connectionTimeoutMillis: runtimeEnv.DB_CONNECT_TIMEOUT_MS,
});
boss.on("error", (error) => {
  const errorCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "JOB_DATABASE_ERROR";
  console.error(
    JSON.stringify({
      event: "job-database.error",
      component: "worker",
      errorCode,
    }),
  );
});
const workerInstanceId = randomUUID();
const workerVersion = runtimeEnv.APP_VERSION;
const workerHeartbeatIntervalMs = 30_000;
const workerHeartbeatStaleRetentionMs = 7 * 24 * 60 * 60_000;

async function processTencentEnterpriseSync() {
  const [configuration] = await db
    .select()
    .from(platformAnswerbitCredentials)
    .where(eq(platformAnswerbitCredentials.id, 1))
    .limit(1);
  if (!configuration?.teamId || configuration.status !== "active") {
    console.info(JSON.stringify({ event: "tencent-enterprise-sync.skipped" }));
    return {
      skipped: true,
      reason: !configuration?.teamId
        ? "ANSWERBIT_KEY_NOT_CONFIGURED"
        : "ANSWERBIT_KEY_NOT_ACTIVE",
    };
  }
  if (
    configuration.lastSyncedAt &&
    Date.now() - configuration.lastSyncedAt.getTime() < 20 * 60 * 60_000
  ) {
    console.info(JSON.stringify({ event: "tencent-enterprise-sync.fresh" }));
    return;
  }
  const teamId = configuration.teamId;

  let actorUserId = configuration.updatedBy;
  if (actorUserId) {
    const [actor] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, actorUserId), eq(users.status, "active")))
      .limit(1);
    actorUserId = actor?.id ?? null;
  }
  if (!actorUserId) {
    const [fallbackActor] = await db
      .select({ id: users.id })
      .from(platformUserRoles)
      .innerJoin(roles, eq(roles.id, platformUserRoles.roleId))
      .innerJoin(users, eq(users.id, platformUserRoles.userId))
      .where(and(eq(roles.code, "super_admin"), eq(users.status, "active")))
      .limit(1);
    actorUserId = fallbackActor?.id ?? null;
  }
  if (!actorUserId) throw new Error("TENCENT_ENTERPRISE_SYNC_ACTOR_NOT_FOUND");

  const requestId = randomUUID();
  try {
    const brands = await queryTencentBrandDirectory({
      apiKey: cipher.decrypt(
        configuration.encryptedApiKey,
        platformAnswerBitCredentialAad,
      ),
      teamId,
      requestId,
      baseUrl: runtimeEnv.ANSWERBIT_BASE_URL,
    });
    const result = await syncTencentEnterpriseDirectory({
      brands,
      teamId,
      apiKeyHint: configuration.apiKeyHint,
      actorUserId,
      checkedAt: new Date(),
      expectedKeyVersion: configuration.keyVersion,
      completeDirectory: true,
    });
    try {
      await db
        .delete(answerbitReadCache)
        .where(
          lt(
            answerbitReadCache.checkedAt,
            new Date(Date.now() - 7 * 24 * 60 * 60_000),
          ),
        );
    } catch {
      console.error(
        JSON.stringify({ event: "answerbit-read-cache.prune-failed" }),
      );
    }
    if (
      !result.skipped &&
      (result.createdEnterpriseCount > 0 ||
        result.updatedEnterpriseCount > 0 ||
        result.closedEnterpriseCount > 0)
    )
      await db.insert(operationLogs).values({
        actorUserId,
        operation: "platform.answerbit.enterprise.sync.automatic",
        resourceType: "platform_answerbit_credential",
        resourceId: "1",
        requestId,
        result: "success",
        summary: `自动同步腾讯企业：新增 ${result.createdEnterpriseCount} 家、更新 ${result.updatedEnterpriseCount} 家、关闭 ${result.closedEnterpriseCount} 家`,
      });
    console.info(
      JSON.stringify({
        event: "tencent-enterprise-sync.completed",
        requestId,
        ...result,
        organizations: undefined,
      }),
    );
  } catch (error) {
    if (
      error instanceof TencentDirectoryError &&
      error.kind === "unauthorized"
    ) {
      const checkedAt = new Date();
      await db.transaction(async (tx) => {
        const invalidated = await tx
          .update(platformAnswerbitCredentials)
          .set({
            status: "invalid",
            lastCheckedAt: checkedAt,
            updatedAt: checkedAt,
          })
          .where(
            and(
              eq(platformAnswerbitCredentials.id, 1),
              eq(
                platformAnswerbitCredentials.keyVersion,
                configuration.keyVersion,
              ),
            ),
          )
          .returning({ id: platformAnswerbitCredentials.id });
        if (!invalidated.length) return;
        await tx
          .update(answerbitConnections)
          .set({
            status: "invalid",
            lastCheckedAt: checkedAt,
            updatedAt: checkedAt,
          })
          .where(
            eq(
              answerbitConnections.encryptedApiKey,
              platformAnswerBitConnectionSentinel,
            ),
          );
        await tx
          .update(answerbitTeamBindings)
          .set({
            status: "invalid",
            lastErrorCode: "ANSWERBIT_DIRECTORY_UNAUTHORIZED",
            lastCheckedAt: checkedAt,
            updatedAt: checkedAt,
          })
          .where(eq(answerbitTeamBindings.teamId, teamId));
      });
    }
    console.error(
      JSON.stringify({
        event: "tencent-enterprise-sync.failed",
        requestId,
        errorCode:
          error instanceof TencentDirectoryError
            ? error.message
            : "TENCENT_ENTERPRISE_SYNC_FAILED",
      }),
    );
    throw error;
  }
}

async function loadJob(organizationId: string, jobId: string) {
  const [job] = await db
    .select()
    .from(articleGenerationJobs)
    .where(
      and(
        eq(articleGenerationJobs.id, jobId),
        eq(articleGenerationJobs.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!job) throw new Error("ARTICLE_JOB_NOT_FOUND");
  const [team] = await db
    .select()
    .from(answerbitTeamBindings)
    .where(
      and(
        eq(answerbitTeamBindings.id, job.teamBindingId),
        eq(answerbitTeamBindings.organizationId, organizationId),
        eq(answerbitTeamBindings.status, "active"),
      ),
    )
    .limit(1);
  return { job, team };
}

// @project-doc docs/interfaces/answerbit_integration.md#credential_resolution
async function resolveWorkerCredential(input: {
  organizationId: string;
  teamBindingId: string;
  operation: AnswerBitOperation;
  brandId?: string;
}) {
  const [shared] = await db
    .select()
    .from(platformAnswerbitCredentials)
    .where(eq(platformAnswerbitCredentials.id, 1))
    .limit(1);
  if (shared?.teamId) {
    if (shared.status !== "active")
      throw new Error("ANSWERBIT_KEY_NOT_CONFIGURED");
    const [team] = await db
      .select({
        connectionId: answerbitTeamBindings.connectionId,
        teamId: answerbitTeamBindings.teamId,
      })
      .from(answerbitTeamBindings)
      .where(
        and(
          eq(answerbitTeamBindings.id, input.teamBindingId),
          eq(answerbitTeamBindings.organizationId, input.organizationId),
          eq(answerbitTeamBindings.status, "active"),
        ),
      )
      .limit(1);
    if (!team || team.teamId !== shared.teamId)
      throw new Error("ANSWERBIT_TEAM_SCOPE_MISMATCH");
    if (input.brandId) {
      const [brand] = await db
        .select({ id: answerbitBrandMappings.id })
        .from(answerbitBrandMappings)
        .where(
          and(
            eq(answerbitBrandMappings.organizationId, input.organizationId),
            eq(answerbitBrandMappings.teamBindingId, input.teamBindingId),
            eq(answerbitBrandMappings.brandId, input.brandId),
          ),
        )
        .limit(1);
      if (!brand) throw new Error("ANSWERBIT_KEY_SCOPE_MISMATCH");
    }
    return {
      connectionId: team.connectionId,
      apiKey: cipher.decrypt(
        shared.encryptedApiKey,
        platformAnswerBitCredentialAad,
      ),
    };
  }

  const credentials = await db
    .select({
      connectionId: answerbitCredentialAssignments.connectionId,
      scopeType: answerbitCredentialAssignments.scopeType,
      brandId: answerbitCredentialAssignments.brandId,
      permissions: answerbitCredentialAssignments.permissions,
      priority: answerbitCredentialAssignments.priority,
      updatedAt: answerbitCredentialAssignments.updatedAt,
      encryptedApiKey: answerbitConnections.encryptedApiKey,
      status: answerbitConnections.status,
    })
    .from(answerbitCredentialAssignments)
    .innerJoin(
      answerbitConnections,
      and(
        eq(
          answerbitConnections.id,
          answerbitCredentialAssignments.connectionId,
        ),
        eq(
          answerbitConnections.organizationId,
          answerbitCredentialAssignments.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(answerbitCredentialAssignments.organizationId, input.organizationId),
        eq(answerbitCredentialAssignments.teamBindingId, input.teamBindingId),
      ),
    );
  if (!credentials.length) throw new Error("ANSWERBIT_KEY_NOT_CONFIGURED");
  const active = credentials.filter((item) => item.status === "active");
  if (!active.length) throw new Error("ANSWERBIT_KEY_NOT_CONFIGURED");
  const scoped = active.filter((item) =>
    input.brandId
      ? item.scopeType === "team" ||
        (item.scopeType === "brand" && item.brandId === input.brandId)
      : item.scopeType === "team",
  );
  if (!scoped.length) throw new Error("ANSWERBIT_KEY_SCOPE_MISMATCH");
  const eligible = scoped
    .filter(
      (item) =>
        item.permissions.includes(input.operation) ||
        item.permissions.includes("*"),
    )
    .sort((left, right) => {
      const scopeOrder =
        Number(left.scopeType === "team") - Number(right.scopeType === "team");
      return (
        scopeOrder ||
        left.priority - right.priority ||
        right.updatedAt.getTime() - left.updatedAt.getTime()
      );
    });
  const selected = eligible[0];
  if (!selected) throw new Error("ANSWERBIT_KEY_PERMISSION_DENIED");
  return {
    connectionId: selected.connectionId,
    apiKey: cipher.decrypt(selected.encryptedApiKey, input.organizationId),
  };
}

async function recordAnswerBitApiCall(
  values: typeof answerbitApiCalls.$inferInsert,
): Promise<void> {
  try {
    await db.insert(answerbitApiCalls).values(values);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "answerbit-api-call.log-failed",
        requestId: values.requestId,
        operation: values.operation,
        status: values.status,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

// @project-doc docs/interfaces/answerbit_integration.md#response_validation
async function callAnswerBit<T>(
  operation: AnswerBitOperation,
  payload: unknown,
  context: {
    organizationId: string;
    teamBindingId: string;
    requestId: string;
    brandId?: string;
    actorUserId?: string;
  },
  timeoutMs: number,
  schema: AnswerBitDataSchema<T>,
  beforeSend?: () => Promise<void>,
): Promise<T> {
  const credential = await resolveWorkerCredential({
    organizationId: context.organizationId,
    teamBindingId: context.teamBindingId,
    operation,
    brandId: context.brandId,
  });
  if (beforeSend) await beforeSend();
  const started = performance.now();
  const apiCallContext = {
    organizationId: context.organizationId,
    connectionId: credential.connectionId,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
  };
  let httpStatus: number | undefined;
  let answerbitCode: number | undefined;
  try {
    const response = await fetch(
      new URL(operation, runtimeEnv.ANSWERBIT_BASE_URL),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-API-Key": credential.apiKey,
          "X-Request-ID": context.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    httpStatus = response.status;
    if (!response.ok) {
      await discardResponseBody(response);
      throw new AnswerBitHttpError(response.status);
    }
    const envelope = parseAnswerBitEnvelope(
      await readBoundedJsonResponse(response),
    );
    answerbitCode = envelope.code;
    if (envelope.code !== 0) throw new AnswerBitBusinessError(envelope.code);
    const data = parseAnswerBitData(schema, envelope.data);
    await recordAnswerBitApiCall({
      ...apiCallContext,
      operation,
      answerbitCode,
      httpStatus,
      status: "success",
      durationMs: Math.round(performance.now() - started),
    });
    return data;
  } catch (error) {
    const timeout =
      error instanceof DOMException && error.name === "TimeoutError";
    const invalidResponse =
      error instanceof BoundedJsonResponseError ||
      error instanceof InvalidAnswerBitEnvelopeError ||
      error instanceof InvalidAnswerBitDataError;
    await recordAnswerBitApiCall({
      ...apiCallContext,
      operation,
      answerbitCode,
      httpStatus,
      status: timeout ? "timeout" : "failed",
      durationMs: Math.round(performance.now() - started),
      errorCode: timeout
        ? "ANSWERBIT_TIMEOUT"
        : invalidResponse
          ? "ANSWERBIT_INVALID_RESPONSE"
          : "ANSWERBIT_WORKER_ERROR",
    });
    throw error;
  }
}

// @project-doc docs/domains/geo_operations.md#article_jobs
const articlePollIntervalMs = 30_000;
const articleGenerationDeadlineMs = 20 * 60_000;

async function scheduleArticleContentPoll(input: {
  organizationId: string;
  jobId: string;
  executionId: string;
}) {
  try {
    await scheduleArticleResultPoll(input, async (data, executor) => {
      const queueJobId = await boss.send("article-generation", data, {
        db: executor,
        startAfter: new Date(Date.now() + articlePollIntervalMs),
        retryLimit: 0,
        expireInSeconds: 240,
      });
      if (!queueJobId) throw new Error("QUEUE_SEND_EMPTY");
      return queueJobId;
    });
  } catch {
    throw new Error("ARTICLE_POLL_SCHEDULE_FAILED");
  }
}

async function processArticleGeneration(data: {
  organizationId: string;
  jobId: string;
}) {
  const executionId = randomUUID();
  const claimed = await db
    .update(articleGenerationJobs)
    .set({
      status: "running",
      executionId,
      startedAt: sql`coalesce(${articleGenerationJobs.startedAt}, now())`,
      attemptCount: sql`${articleGenerationJobs.attemptCount} + 1`,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(articleGenerationJobs.id, data.jobId),
        eq(articleGenerationJobs.organizationId, data.organizationId),
        or(
          eq(articleGenerationJobs.status, "queued"),
          and(
            eq(articleGenerationJobs.status, "running"),
            isNull(articleGenerationJobs.executionId),
            sql`${articleGenerationJobs.answerbitArticleId} is not null`,
          ),
        ),
      ),
    )
    .returning();
  if (!claimed.length) return;
  const context = await loadJob(data.organizationId, data.jobId);
  let articleId = context.job.answerbitArticleId ?? undefined;
  try {
    if (!context.team) throw new Error("TEAM_BINDING_NOT_FOUND");
    if (!articleId) {
      await assertEnterpriseAccess(data.organizationId, true);
      await assertWorkerJobAccess({
        organizationId: data.organizationId,
        teamBindingId: context.job.teamBindingId,
        brandId: context.job.brandId,
        userId: context.job.requestedBy,
        permission: "resource.create",
      });
    }
    const requestPayload = parseArticleJobPayload(
      context.job.requestPayload,
      (ciphertext) => cipher.decrypt(ciphertext, data.organizationId),
      {
        brandId: context.job.brandId,
        templateType: context.job.templateType,
        language: context.job.language,
      },
    );
    if (!articleId) {
      const created = await createArticleOnce(
        { ...data, executionId },
        ({ requestId, beforeSend }) =>
          callAnswerBit(
            "/geo/article/create",
            requestPayload,
            {
              organizationId: data.organizationId,
              teamBindingId: context.team!.id,
              requestId,
              brandId: context.job.brandId,
              actorUserId: context.job.requestedBy,
            },
            120_000,
            answerBitIdResultSchema,
            beforeSend,
          ),
      );
      if (created.kind === "skipped") return;
      articleId = created.articleId;
    }
    const deadline =
      (claimed[0].startedAt?.getTime() ?? Date.now()) +
      articleGenerationDeadlineMs;
    let progress:
      | ReturnType<typeof answerBitArticleProgressSchema.parse>
      | undefined;
    try {
      progress = await callAnswerBit(
        "/geo/article/get",
        { brand_id: context.job.brandId, article_id: articleId },
        {
          organizationId: data.organizationId,
          teamBindingId: context.team.id,
          requestId: randomUUID(),
          brandId: context.job.brandId,
          actorUserId: context.job.requestedBy,
        },
        10_000,
        answerBitArticleProgressSchema,
      );
    } catch (error) {
      if (
        Date.now() < deadline &&
        !(error instanceof InvalidAnswerBitDataError) &&
        !(error instanceof InvalidAnswerBitEnvelopeError) &&
        !(error instanceof BoundedJsonResponseError)
      ) {
        await scheduleArticleContentPoll({ ...data, executionId });
        return;
      }
      throw error;
    }
    if (progress.status === 0) {
      if (Date.now() >= deadline) throw new Error("ARTICLE_GENERATION_TIMEOUT");
      await scheduleArticleContentPoll({ ...data, executionId });
      return;
    }
    const content = answerBitArticleContentSchema.parse(progress);
    if (!content.main_body.trim()) {
      if (Date.now() >= deadline) throw new Error("ARTICLE_GENERATION_TIMEOUT");
      await scheduleArticleContentPoll({ ...data, executionId });
      return;
    }
    const upstreamTags = content.tags.map((tag) => ({
      tagId: tag.tag_id,
      tagName: tag.tag_name,
    }));
    const tags = [...(context.job.tags ?? []), ...upstreamTags].filter(
      (tag, index, all) =>
        tag.tagName &&
        all.findIndex(
          (candidate) =>
            candidate.tagId === tag.tagId ||
            candidate.tagName.toLocaleLowerCase() ===
              tag.tagName.toLocaleLowerCase(),
        ) === index,
    );
    const finalized = await db.transaction(async (tx) => {
      const [completed] = await tx
        .update(articleGenerationJobs)
        .set({
          status: "succeeded",
          articleTitle: content.title,
          articleBody: content.main_body,
          articleStatus: content.status,
          templateType: content.template_type,
          source: content.source,
          language: content.language,
          tags,
          completedAt: new Date(),
          errorCode: null,
          executionId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(articleGenerationJobs.id, data.jobId),
            eq(articleGenerationJobs.executionId, executionId),
          ),
        )
        .returning({ id: articleGenerationJobs.id });
      if (!completed) return false;
      await tx
        .insert(answerbitArticleMappings)
        .values({
          organizationId: data.organizationId,
          teamBindingId: context.job.teamBindingId,
          brandId: context.job.brandId,
          articleId: articleId!,
          title: content.title,
          status: content.status,
          source: content.source,
          templateType: content.template_type,
          language: content.language,
        })
        .onConflictDoUpdate({
          target: [
            answerbitArticleMappings.organizationId,
            answerbitArticleMappings.teamBindingId,
            answerbitArticleMappings.brandId,
            answerbitArticleMappings.articleId,
          ],
          set: {
            title: content.title,
            status: content.status,
            source: content.source,
            templateType: content.template_type,
            language: content.language,
            syncedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      const [document] = await tx
        .insert(contentDocuments)
        .values({
          organizationId: data.organizationId,
          teamBindingId: context.job.teamBindingId,
          brandId: context.job.brandId,
          createdBy: context.job.requestedBy,
          updatedBy: context.job.requestedBy,
          source: "ai_generated",
          sourceJobId: context.job.id,
          title: content.title,
          body: content.main_body,
          status: "ready",
          language: content.language,
          tags: tags.map((tag) => tag.tagName).slice(0, 20),
        })
        .onConflictDoNothing({ target: contentDocuments.sourceJobId })
        .returning();
      if (document)
        await tx.insert(contentDocumentVersions).values({
          documentId: document.id,
          organizationId: data.organizationId,
          version: 1,
          title: document.title,
          body: document.body,
          status: document.status,
          language: document.language,
          tags: document.tags,
          changeSummary: "AI 生成完成并保存到文档库",
          createdBy: context.job.requestedBy,
        });
      return true;
    });
    if (!finalized) {
      console.info(
        JSON.stringify({
          event: "article-generation.superseded",
          jobId: data.jobId,
          executionId,
        }),
      );
      return;
    }
    if (context.job.quotaReservationKey) {
      try {
        const settled = await commitQuota(
          data.organizationId,
          context.job.quotaReservationKey,
        );
        if (!settled.ok)
          console.error(
            JSON.stringify({
              event: "article-generation.quota-commit-pending",
              jobId: data.jobId,
              code: settled.code,
            }),
          );
      } catch (quotaError) {
        console.error(
          JSON.stringify({
            event: "article-generation.quota-commit-pending",
            jobId: data.jobId,
            message:
              quotaError instanceof Error ? quotaError.message : "unknown",
          }),
        );
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "ARTICLE_POLL_SCHEDULE_FAILED"
    ) {
      console.error(
        JSON.stringify({
          event: "article-generation.poll-schedule-failed",
          jobId: data.jobId,
        }),
      );
      return;
    }
    const uncertain = error instanceof ArticleCreationUncertainError;
    const failed = await failArticleJob({
      ...data,
      executionId,
      errorCode:
        error instanceof EnterpriseAccessError
          ? error.code
          : error instanceof WorkerJobAccessError
            ? error.code === "JOB_PERMISSION_REVOKED"
              ? "ARTICLE_PERMISSION_REVOKED"
              : error.code
            : error instanceof InvalidArticleJobPayloadError
              ? "INVALID_ARTICLE_JOB_PAYLOAD"
              : error instanceof Error &&
                  error.message === "ARTICLE_GENERATION_TIMEOUT"
                ? "ARTICLE_GENERATION_TIMEOUT"
                : uncertain
                  ? "ANSWERBIT_CREATE_UNCERTAIN"
                  : articleId
                    ? "ARTICLE_CONTENT_FETCH_FAILED"
                    : "ARTICLE_CREATE_FAILED",
    });
    if (!failed) {
      console.info(
        JSON.stringify({
          event: "article-generation.superseded",
          jobId: data.jobId,
          executionId,
        }),
      );
      return;
    }
    if (context.job.quotaReservationKey) {
      try {
        await releaseQuota(
          data.organizationId,
          context.job.quotaReservationKey,
        );
      } catch (quotaError) {
        console.error(
          JSON.stringify({
            event: "article-generation.quota-release-pending",
            jobId: data.jobId,
            message:
              quotaError instanceof Error ? quotaError.message : "unknown",
          }),
        );
      }
    }
    console.error(
      JSON.stringify({
        event: "article-generation.failed",
        jobId: data.jobId,
        uncertain,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw error;
  }
}

// @project-doc docs/domains/geo_operations.md#report_exports
async function processReportExport(data: {
  organizationId: string;
  exportId: string;
}) {
  const executionId = randomUUID();
  const claimed = await claimReportExport(data, executionId);
  if (!claimed) return;
  try {
    await assertEnterpriseAccess(data.organizationId);
    await assertWorkerJobAccess({
      organizationId: data.organizationId,
      teamBindingId: claimed.teamBindingId,
      brandId: claimed.brandId,
      userId: claimed.requestedBy,
      permission: "report.export",
    });
    const [team] = await db
      .select()
      .from(answerbitTeamBindings)
      .where(
        and(
          eq(answerbitTeamBindings.id, claimed.teamBindingId),
          eq(answerbitTeamBindings.organizationId, data.organizationId),
          eq(answerbitTeamBindings.status, "active"),
        ),
      )
      .limit(1);
    if (!team) throw new Error("TEAM_BINDING_NOT_FOUND");
    const filters = parseReportExportFilters(claimed.filters);
    const operation =
      claimed.reportType === "answers"
        ? "/geo/task/get"
        : claimed.reportType === "domain_rank"
          ? "/geo/domain/rank"
          : "/geo/article/rank";
    const exportBuffer = new ReportExportBuffer();
    let page = 1;
    let total = 0;
    do {
      const payload = reportExportPayload(
        claimed.reportType,
        claimed.brandId,
        filters,
        page,
      );
      const responseSchema =
        claimed.reportType === "answers"
          ? answerBitTaskListSchema
          : claimed.reportType === "domain_rank"
            ? answerBitDomainRankSchema
            : answerBitArticleRankSchema;
      const result = await callAnswerBit<{
        scores?: unknown[];
        reference_count?: unknown[];
        total: number;
      }>(
        operation,
        payload,
        {
          organizationId: data.organizationId,
          teamBindingId: team.id,
          requestId: randomUUID(),
          brandId: claimed.brandId,
          actorUserId: claimed.requestedBy,
        },
        30_000,
        responseSchema,
      );
      const chunk =
        claimed.reportType === "answers"
          ? result.scores
          : result.reference_count;
      if (!chunk) throw new Error("INVALID_REPORT_RESPONSE");
      const chunkRows = chunk.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new Error("INVALID_REPORT_RESPONSE");
        return row as Record<string, unknown>;
      });
      exportBuffer.append(chunkRows);
      total = result.total;
      page += 1;
      if (!chunk.length) break;
    } while (
      !exportBuffer.full &&
      exportBuffer.rowCount < Math.min(total, maxReportExportRows)
    );
    const { fileContent, rowCount } = exportBuffer.toCsv();
    const completedAt = new Date();
    const expiresAt = new Date(completedAt.getTime() + 24 * 60 * 60_000);
    const filename = `geo-${claimed.reportType}-${filters.beginDate}-${filters.endDate}-${claimed.id.slice(0, 8)}.csv`;
    const [completed] = await db
      .update(reportExports)
      .set({
        status: "succeeded",
        filename,
        mimeType: "text/csv",
        fileContent,
        rowCount,
        completedAt,
        expiresAt,
        executionId: null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(reportExports.id, claimed.id),
          eq(reportExports.executionId, executionId),
        ),
      )
      .returning({ id: reportExports.id });
    if (!completed) {
      console.info(
        JSON.stringify({
          event: "report-export.superseded",
          exportId: claimed.id,
          executionId,
        }),
      );
      return;
    }
  } catch (error) {
    const [failed] = await db
      .update(reportExports)
      .set({
        status: "failed",
        errorCode:
          error instanceof EnterpriseAccessError
            ? error.code
            : error instanceof WorkerJobAccessError
              ? error.code === "JOB_PERMISSION_REVOKED"
                ? "REPORT_PERMISSION_REVOKED"
                : error.code
              : error instanceof Error
                ? error.message.slice(0, 128)
                : "REPORT_EXPORT_FAILED",
        completedAt: new Date(),
        executionId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reportExports.id, claimed.id),
          eq(reportExports.executionId, executionId),
        ),
      )
      .returning({ id: reportExports.id });
    if (!failed) {
      console.info(
        JSON.stringify({
          event: "report-export.superseded",
          exportId: claimed.id,
          executionId,
        }),
      );
      return;
    }
    if (claimed.quotaReservationKey)
      await releaseQuota(data.organizationId, claimed.quotaReservationKey);
    throw error;
  }
  if (claimed.quotaReservationKey) {
    try {
      await commitQuota(data.organizationId, claimed.quotaReservationKey);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "report-export.quota-commit-pending",
          exportId: claimed.id,
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }
}

const asyncJobQueuedStaleMs = 10 * 60_000;
const asyncJobRunningStaleMs = 15 * 60_000;
const asyncJobRecoveryBatchSize = 100;

async function queueJobState(
  queueName: "article-generation" | "report-export",
  queueJobId: string | null,
): Promise<QueueJobState | null> {
  if (!queueJobId) return null;
  const job = await boss.getJobById(queueName, queueJobId);
  return job?.state ?? null;
}

async function enqueueRecoveredReport(input: {
  id: string;
  organizationId: string;
  queueJobId: string | null;
}) {
  return redeliverReportExport(
    {
      organizationId: input.organizationId,
      exportId: input.id,
      expectedQueueJobId: input.queueJobId,
    },
    async (data, executor) => {
      const queueJobId = await boss.send("report-export", data, {
        db: executor,
        singletonKey: data.exportId,
        retryLimit: 0,
        expireInSeconds: 600,
      });
      if (!queueJobId) throw new Error("REPORT_JOB_REDELIVERY_FAILED");
      return queueJobId;
    },
  );
}

async function processAsyncJobReconciliation() {
  const lockClient = await pool.connect();
  let locked = false;
  const result = {
    scannedArticles: 0,
    scannedReports: 0,
    requeuedArticles: 0,
    uncertainArticles: 0,
    requeuedReports: 0,
    activeJobs: 0,
    races: 0,
    errors: 0,
  };
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      ["geo:async-job-reconciliation"],
    );
    locked = lock.rows[0]?.locked ?? false;
    if (!locked) return { ...result, skipped: true };

    const now = new Date();
    const queuedCutoff = new Date(now.getTime() - asyncJobQueuedStaleMs);
    const runningCutoff = new Date(now.getTime() - asyncJobRunningStaleMs);
    const [articleCandidates, reportCandidates] = await Promise.all([
      db
        .select({
          id: articleGenerationJobs.id,
          organizationId: articleGenerationJobs.organizationId,
          brandId: articleGenerationJobs.brandId,
          requestedBy: articleGenerationJobs.requestedBy,
          status: articleGenerationJobs.status,
          queueJobId: articleGenerationJobs.queueJobId,
          executionId: articleGenerationJobs.executionId,
          answerbitArticleId: articleGenerationJobs.answerbitArticleId,
          updatedAt: articleGenerationJobs.updatedAt,
        })
        .from(articleGenerationJobs)
        .where(
          or(
            and(
              eq(articleGenerationJobs.status, "queued"),
              lte(articleGenerationJobs.updatedAt, queuedCutoff),
            ),
            and(
              eq(articleGenerationJobs.status, "running"),
              lte(articleGenerationJobs.updatedAt, runningCutoff),
            ),
          ),
        )
        .orderBy(articleGenerationJobs.updatedAt)
        .limit(asyncJobRecoveryBatchSize),
      db
        .select({
          id: reportExports.id,
          organizationId: reportExports.organizationId,
          status: reportExports.status,
          queueJobId: reportExports.queueJobId,
          executionId: reportExports.executionId,
          updatedAt: reportExports.updatedAt,
        })
        .from(reportExports)
        .where(
          or(
            and(
              eq(reportExports.status, "queued"),
              lte(reportExports.updatedAt, queuedCutoff),
            ),
            and(
              eq(reportExports.status, "running"),
              lte(reportExports.updatedAt, runningCutoff),
            ),
          ),
        )
        .orderBy(reportExports.updatedAt)
        .limit(asyncJobRecoveryBatchSize),
    ]);
    result.scannedArticles = articleCandidates.length;
    result.scannedReports = reportCandidates.length;

    for (const candidate of articleCandidates) {
      try {
        const state = await queueJobState(
          "article-generation",
          candidate.queueJobId,
        );
        const action = await recoverArticleJob(
          {
            organizationId: candidate.organizationId,
            jobId: candidate.id,
            expectedQueueJobId: candidate.queueJobId,
            expectedExecutionId: candidate.executionId,
            status: candidate.status as "queued" | "running",
            staleBefore:
              candidate.status === "queued" ? queuedCutoff : runningCutoff,
            queueState: state,
          },
          async (data, executor) => {
            const queueJobId = await boss.send("article-generation", data, {
              db: executor,
              singletonKey: data.jobId,
              retryLimit: 0,
              expireInSeconds: 300,
            });
            if (!queueJobId) throw new Error("ARTICLE_JOB_REDELIVERY_FAILED");
            return queueJobId;
          },
        );
        if (action === "none") result.activeJobs += 1;
        else if (action === "superseded") result.races += 1;
        else if (action === "fail_uncertain") result.uncertainArticles += 1;
        else result.requeuedArticles += 1;
      } catch (error) {
        result.errors += 1;
        console.error(
          JSON.stringify({
            event: "async-job-reconciliation.item-failed",
            kind: "article",
            jobId: candidate.id,
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }

    for (const candidate of reportCandidates) {
      try {
        const state = await queueJobState(
          "report-export",
          candidate.queueJobId,
        );
        const action = decideAsyncJobRecovery({
          kind: "report",
          status: candidate.status as "queued" | "running",
          queueState: state,
        });
        if (action === "none") {
          result.activeJobs += 1;
          continue;
        }
        const candidateCutoff =
          candidate.status === "queued" ? queuedCutoff : runningCutoff;
        const executionCondition = candidate.executionId
          ? eq(reportExports.executionId, candidate.executionId)
          : isNull(reportExports.executionId);
        const [reset] = await db
          .update(reportExports)
          .set({
            status: "queued",
            executionId: null,
            startedAt: null,
            completedAt: null,
            errorCode: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(reportExports.id, candidate.id),
              eq(reportExports.status, candidate.status),
              executionCondition,
              lte(reportExports.updatedAt, candidateCutoff),
            ),
          )
          .returning({ id: reportExports.id });
        if (!reset) {
          result.races += 1;
          continue;
        }
        if (await enqueueRecoveredReport(candidate))
          result.requeuedReports += 1;
      } catch (error) {
        result.errors += 1;
        console.error(
          JSON.stringify({
            event: "async-job-reconciliation.item-failed",
            kind: "report",
            exportId: candidate.id,
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }
  } finally {
    if (locked)
      await lockClient.query("select pg_advisory_unlock(hashtext($1))", [
        "geo:async-job-reconciliation",
      ]);
    lockClient.release();
  }

  console.info(
    JSON.stringify({ event: "async-job-reconciliation.completed", ...result }),
  );
  if (result.errors > 0)
    throw new Error("ASYNC_JOB_RECONCILIATION_PARTIAL_FAILURE");
  return result;
}

async function processNotificationEvaluation() {
  const rulesToEvaluate = await db
    .select({
      rule: notificationRules,
      team: answerbitTeamBindings,
    })
    .from(notificationRules)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, notificationRules.organizationId),
        eq(organizations.status, "active"),
        sql`(${organizations.serviceExpiresAt} is null or ${organizations.serviceExpiresAt} > now())`,
      ),
    )
    .innerJoin(
      answerbitTeamBindings,
      and(
        eq(answerbitTeamBindings.id, notificationRules.teamBindingId),
        eq(
          answerbitTeamBindings.organizationId,
          notificationRules.organizationId,
        ),
        ne(answerbitTeamBindings.status, "disabled"),
      ),
    )
    .where(eq(notificationRules.enabled, true));
  return evaluateNotificationRules(rulesToEvaluate, (rule, period) =>
    callAnswerBit(
      "/geo/base/dashboard",
      {
        brand_id: rule.brandId!,
        begin_date: period.beginDate,
        end_date: period.endDate,
        title_ids: [],
        platforms: [],
        tag_ids: [],
      },
      {
        organizationId: rule.organizationId,
        teamBindingId: rule.teamBindingId,
        requestId: randomUUID(),
        brandId: rule.brandId ?? undefined,
      },
      15_000,
      answerBitDashboardMetricsSchema,
    ),
  );
}

async function recordWorkerHeartbeat() {
  const now = new Date();
  await db
    .insert(runtimeHeartbeats)
    .values({
      component: "worker",
      instanceId: workerInstanceId,
      version: workerVersion,
      startedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [runtimeHeartbeats.component, runtimeHeartbeats.instanceId],
      set: { lastSeenAt: now, version: workerVersion },
    });
}

async function pruneStaleWorkerHeartbeats() {
  await db
    .delete(runtimeHeartbeats)
    .where(
      and(
        eq(runtimeHeartbeats.component, "worker"),
        lt(
          runtimeHeartbeats.lastSeenAt,
          new Date(Date.now() - workerHeartbeatStaleRetentionMs),
        ),
      ),
    );
}

async function recordRuntimeTaskCompletion(input: {
  taskName: RuntimeTaskName;
  runId: string;
  state: "succeeded" | "failed";
  startedAt: Date;
  errorCode?: string;
}) {
  const completedAt = new Date();
  await db
    .update(runtimeTaskStatuses)
    .set({
      state: input.state,
      lastSucceededAt: input.state === "succeeded" ? completedAt : undefined,
      lastFailedAt: input.state === "failed" ? completedAt : undefined,
      lastDurationMs: Math.max(
        0,
        completedAt.getTime() - input.startedAt.getTime(),
      ),
      lastErrorCode: input.errorCode ?? null,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(runtimeTaskStatuses.taskName, input.taskName),
        eq(runtimeTaskStatuses.runId, input.runId),
      ),
    );
}

async function runTrackedTask<T>(
  taskName: RuntimeTaskName,
  execute: () => Promise<T>,
) {
  const definition = runtimeTaskDefinitions[taskName];
  const runId = randomUUID();
  const startedAt = new Date();
  let trackingReady = true;
  try {
    await db
      .insert(runtimeTaskStatuses)
      .values({
        taskName,
        state: "running",
        runId,
        instanceId: workerInstanceId,
        expectedIntervalSeconds: definition.expectedIntervalSeconds,
        timeoutSeconds: definition.timeoutSeconds,
        lastStartedAt: startedAt,
      })
      .onConflictDoUpdate({
        target: runtimeTaskStatuses.taskName,
        set: {
          state: "running",
          runId,
          instanceId: workerInstanceId,
          expectedIntervalSeconds: definition.expectedIntervalSeconds,
          timeoutSeconds: definition.timeoutSeconds,
          lastStartedAt: startedAt,
          lastErrorCode: null,
          updatedAt: startedAt,
        },
      });
  } catch (error) {
    trackingReady = false;
    console.error(
      JSON.stringify({
        event: "runtime-task-tracking.failed",
        phase: "start",
        taskName,
        instanceId: workerInstanceId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }

  try {
    const result = await execute();
    const skippedErrorCode = skippedRuntimeTaskErrorCode(taskName, result);
    if (trackingReady)
      try {
        await recordRuntimeTaskCompletion({
          taskName,
          runId,
          state: skippedErrorCode ? "failed" : "succeeded",
          errorCode: skippedErrorCode ?? undefined,
          startedAt,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "runtime-task-tracking.failed",
            phase: "complete",
            taskName,
            instanceId: workerInstanceId,
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    return result;
  } catch (error) {
    if (trackingReady)
      try {
        await recordRuntimeTaskCompletion({
          taskName,
          runId,
          state: "failed",
          startedAt,
          errorCode: runtimeTaskErrorCode(taskName, error),
        });
      } catch (trackingError) {
        console.error(
          JSON.stringify({
            event: "runtime-task-tracking.failed",
            phase: "fail",
            taskName,
            instanceId: workerInstanceId,
            message:
              trackingError instanceof Error
                ? trackingError.message
                : "unknown",
          }),
        );
      }
    throw error;
  }
}

async function processPublicationReconciliation() {
  const [configuration] = await db
    .select()
    .from(platformFrogCredentials)
    .where(eq(platformFrogCredentials.id, 1))
    .limit(1);
  const client =
    configuration?.status === "active"
      ? new FrogPublicationClient(
          cipher.decrypt(
            configuration.encryptedApiKey,
            platformFrogCredentialAad,
          ),
          configuration.baseUrl,
        )
      : new FrogPublicationClient(
          runtimeEnv.FROG_PUBLICATION_API_KEY,
          runtimeEnv.FROG_PUBLICATION_BASE_URL,
        );
  if (!client.configured) return { skipped: true };
  let channelSyncError: unknown;
  try {
    const [{ latestChannelUpdate }] = await db
      .select({
        latestChannelUpdate: sql<Date | null>`max(${publicationChannels.updatedAt})`,
      })
      .from(publicationChannels)
      .where(eq(publicationChannels.provider, "frog_media"));
    const latestTimestamp = latestChannelUpdate
      ? new Date(latestChannelUpdate).getTime()
      : 0;
    const credentialTimestamp = configuration?.updatedAt
      ? new Date(configuration.updatedAt).getTime()
      : 0;
    if (
      latestTimestamp < credentialTimestamp ||
      Date.now() - latestTimestamp >= 30 * 60_000
    ) {
      const channels = await loadFrogPublicationChannels(client, {
        onFieldError: (mediaType, error) =>
          console.error(
            JSON.stringify({
              level: "warn",
              event: "frog-publication.fields.refresh-failed",
              component: "worker",
              mediaType,
              message: error instanceof Error ? error.message : "unknown",
            }),
          ),
      });
      await upsertProviderPublicationChannels(channels);
      console.info(
        JSON.stringify({
          event: "frog-publication.channels.sync-completed",
          count: channels.length,
        }),
      );
    }
  } catch (error) {
    channelSyncError = error;
    console.error(
      JSON.stringify({
        event: "frog-publication.channels.sync-failed",
        component: "worker",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
  const result = await reconcilePublicationOrders(
    await listPendingProviderPublicationOrders(),
    client,
    {
      updateOrder: updatePublicationOrder,
      recordProviderSnapshot: recordPublicationProviderSnapshot,
    },
  );
  console.info(
    JSON.stringify({
      event: "publication-reconciliation.completed",
      ...result,
    }),
  );
  if (result.errors)
    throw new Error("PUBLICATION_RECONCILIATION_PARTIAL_FAILURE");
  if (channelSyncError) throw channelSyncError;
  return result;
}

async function runMaintenance() {
  const recoveredTracking = await recoverStaleTrackingSubmissions(
    new Date(),
    (record) => {
      const input = traceArticleSchema.parse(
        JSON.parse(
          cipher.decrypt(
            record.requestPayload.ciphertext,
            record.organizationId,
          ),
        ),
      );
      if (
        input.organizationId !== record.organizationId ||
        input.teamBindingId !== record.teamBindingId ||
        input.brandId !== record.brandId
      )
        throw new Error("INVALID_TRACKING_PAYLOAD");
      return input;
    },
  );
  const result = { ...(await runBillingMaintenance()), recoveredTracking };
  if (recoveredTracking.errors)
    throw new Error("ARTICLE_TRACKING_RECOVERY_PARTIAL_FAILURE");
  return result;
}

await boss.start();
await boss.createQueue("article-generation");
await boss.createQueue("report-export");
await boss.createQueue("billing-maintenance");
await boss.createQueue("async-job-reconciliation");
await boss.createQueue("notification-evaluation");
await boss.createQueue("tencent-enterprise-sync");
await boss.createQueue("publication-reconciliation");
const initialMaintenance = await runTrackedTask(
  "billing-maintenance",
  runMaintenance,
);
console.info(
  JSON.stringify({
    event: "billing-maintenance.initial",
    ...initialMaintenance,
  }),
);
await boss.schedule("billing-maintenance", "*/5 * * * *");
await boss.schedule("publication-reconciliation", "*/5 * * * *", null, {
  retryLimit: 0,
  expireInSeconds: 240,
});
await boss.send(
  "publication-reconciliation",
  {},
  { singletonKey: "startup", retryLimit: 0, expireInSeconds: 240 },
);
await boss.work("publication-reconciliation", async () =>
  runTrackedTask(
    "publication-reconciliation",
    processPublicationReconciliation,
  ),
);
await boss.schedule("async-job-reconciliation", "*/5 * * * *", null, {
  retryLimit: 0,
  expireInSeconds: 240,
});
await boss.schedule("notification-evaluation", "*/15 * * * *");
await boss.schedule("tencent-enterprise-sync", "0 3 * * *", null, {
  retryLimit: 0,
  expireInSeconds: 240,
});
await boss.send(
  "async-job-reconciliation",
  {},
  { singletonKey: "startup", retryLimit: 0, expireInSeconds: 240 },
);
await boss.send(
  "notification-evaluation",
  {},
  { singletonKey: "startup", retryLimit: 0 },
);
await boss.send(
  "tencent-enterprise-sync",
  {},
  { singletonKey: "startup", retryLimit: 0, expireInSeconds: 240 },
);
await boss.work<{ organizationId: string; jobId: string }>(
  "article-generation",
  async ([job]: Job<{ organizationId: string; jobId: string }>[]) =>
    processArticleGeneration(job.data),
);
await boss.work<{ organizationId: string; exportId: string }>(
  "report-export",
  async ([job]: Job<{ organizationId: string; exportId: string }>[]) =>
    processReportExport(job.data),
);
await boss.work("billing-maintenance", async () => {
  const result = await runTrackedTask("billing-maintenance", runMaintenance);
  console.info(
    JSON.stringify({ event: "billing-maintenance.completed", ...result }),
  );
});
await boss.work("async-job-reconciliation", async () =>
  runTrackedTask("async-job-reconciliation", processAsyncJobReconciliation),
);
await boss.work("notification-evaluation", async () =>
  runTrackedTask("notification-evaluation", processNotificationEvaluation),
);
await boss.work("tencent-enterprise-sync", async () =>
  runTrackedTask("tencent-enterprise-sync", processTencentEnterpriseSync),
);
await pruneStaleWorkerHeartbeats();
await recordWorkerHeartbeat();
const heartbeatTimer = setInterval(() => {
  void recordWorkerHeartbeat().catch((error) =>
    console.error(
      JSON.stringify({
        event: "runtime-heartbeat.failed",
        component: "worker",
        instanceId: workerInstanceId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    ),
  );
}, workerHeartbeatIntervalMs);
heartbeatTimer.unref();

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  console.info(
    JSON.stringify({
      event: "geo-worker.stopping",
      signal,
      instanceId: workerInstanceId,
    }),
  );
  try {
    await boss.stop({ close: true, graceful: true, timeout: 30_000 });
    await db
      .delete(runtimeHeartbeats)
      .where(
        and(
          eq(runtimeHeartbeats.component, "worker"),
          eq(runtimeHeartbeats.instanceId, workerInstanceId),
        ),
      );
  } finally {
    await pool.end();
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        console.error(
          JSON.stringify({
            event: "geo-worker.stop-failed",
            signal,
            instanceId: workerInstanceId,
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
        process.exitCode = 1;
      });
  });
}
console.info(
  JSON.stringify({
    event: "geo-worker.started",
    instanceId: workerInstanceId,
    version: workerVersion,
    queues: [
      "article-generation",
      "report-export",
      "billing-maintenance",
      "async-job-reconciliation",
      "notification-evaluation",
      "tencent-enterprise-sync",
      "publication-reconciliation",
    ],
  }),
);

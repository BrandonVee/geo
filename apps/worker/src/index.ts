import {
  FrogPublicationClient,
  frogPublicationClient,
  loadFrogPublicationChannels,
  reconcilePublicationOrders,
} from "@geo/publication";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { workerEnvSchema } from "@geo/config";
import {
  answerBitAvailableCredits,
  type AnswerBitOperation,
  type BillableFeatureCode,
  classifyConnectionFailure,
  classifyMetricAnomaly,
  connectionFailureLookbackLimit,
  countConsecutiveFailures,
  decideAsyncJobRecovery,
  hasPermission,
  platformAnswerBitCredentialAad,
  platformFrogCredentialAad,
  platformAnswerBitConnectionSentinel,
  recordsToCsv,
  runtimeTaskDefinitions,
  SecretCipher,
  type Role,
  type QueueJobState,
  type RuntimeTaskName,
} from "@geo/core";
import {
  and,
  desc,
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
  answerbitArticleMappings,
  answerbitBrandMappings,
  answerbitConnections,
  answerbitCredentialAssignments,
  answerbitTeamBindings,
  articleGenerationJobs,
  balanceAccounts,
  balanceTransactions,
  brandAccess,
  commitQuota,
  consumeBalance,
  contentDocuments,
  contentDocumentVersions,
  db,
  getFeaturePointCost,
  memberRoles,
  notificationRules,
  notifications,
  operationLogs,
  organizationMembers,
  organizations,
  platformAnswerbitCredentials,
  platformFrogCredentials,
  platformUserRoles,
  pool,
  restoreBalance,
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
import { runtimeTaskErrorCode } from "./runtime-task";
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
type ArticlePayload = {
  brand_id: string;
  template_type: number;
  prompt_ids: string[];
  knowledge_ids?: string[];
  once_knowledge?: string;
  high_ref?: { url?: string; title?: string; content?: string };
  tag_ids?: string[];
  language: string;
};
type Envelope = { code: number; msg?: string; data: unknown };

async function processTencentEnterpriseSync() {
  const [configuration] = await db
    .select()
    .from(platformAnswerbitCredentials)
    .where(eq(platformAnswerbitCredentials.id, 1))
    .limit(1);
  if (!configuration?.teamId || configuration.status !== "active") {
    console.info(JSON.stringify({ event: "tencent-enterprise-sync.skipped" }));
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
  if (!team) throw new Error("TEAM_BINDING_NOT_FOUND");
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

async function callAnswerBit(
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
) {
  const credential = await resolveWorkerCredential({
    organizationId: context.organizationId,
    teamBindingId: context.teamBindingId,
    operation,
    brandId: context.brandId,
  });
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
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const envelope = (await response.json()) as Envelope;
    answerbitCode = envelope.code;
    if (envelope.code !== 0) throw new Error(`BUSINESS_${envelope.code}`);
    await recordAnswerBitApiCall({
      ...apiCallContext,
      operation,
      answerbitCode,
      httpStatus,
      status: "success",
      durationMs: Math.round(performance.now() - started),
    });
    return envelope.data;
  } catch (error) {
    const timeout =
      error instanceof DOMException && error.name === "TimeoutError";
    await recordAnswerBitApiCall({
      ...apiCallContext,
      operation,
      answerbitCode,
      httpStatus,
      status: timeout ? "timeout" : "failed",
      durationMs: Math.round(performance.now() - started),
      errorCode: timeout ? "ANSWERBIT_TIMEOUT" : "ANSWERBIT_WORKER_ERROR",
    });
    throw error;
  }
}

async function consumeFeaturePoints(
  featureCode: BillableFeatureCode,
  featureName: string,
  context: {
    organizationId: string;
    brandId: string;
    actorUserId?: string;
    referenceId: string;
  },
) {
  const points = await getFeaturePointCost(featureCode);
  if (points <= 0) return 0;
  const consumed = await consumeBalance({
    organizationId: context.organizationId,
    brandId: context.brandId,
    asset: "answerbit_points",
    amount: points,
    referenceType: "feature_usage",
    referenceId: context.referenceId,
    idempotencyKey: `feature:${featureCode}:${context.referenceId}:consume`,
    reason: `${featureName}功能计费`,
    actorUserId: context.actorUserId,
  });
  if (!consumed.ok) throw new Error("ANSWERBIT_POINTS_INSUFFICIENT");
  return "transaction" in consumed ? consumed.transaction.amount : 0;
}

async function restoreFeaturePoints(
  featureCode: BillableFeatureCode,
  featureName: string,
  points: number,
  context: {
    organizationId: string;
    brandId: string;
    actorUserId?: string;
    referenceId: string;
  },
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
      startedAt: new Date(),
      attemptCount: sql`${articleGenerationJobs.attemptCount} + 1`,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(articleGenerationJobs.id, data.jobId),
        eq(articleGenerationJobs.organizationId, data.organizationId),
        eq(articleGenerationJobs.status, "queued"),
      ),
    )
    .returning();
  if (!claimed.length) return;
  const context = await loadJob(data.organizationId, data.jobId);
  let articleId = context.job.answerbitArticleId ?? undefined;
  let chargedPoints = 0;
  const featureContext = {
    organizationId: data.organizationId,
    brandId: context.job.brandId,
    actorUserId: context.job.requestedBy,
    referenceId: context.job.id,
  };
  try {
    chargedPoints = await consumeFeaturePoints(
      "ai_article_generation",
      "AI 文章生成",
      featureContext,
    );
    const storedPayload = context.job.requestPayload as {
      ciphertext?: unknown;
    };
    if (typeof storedPayload.ciphertext !== "string")
      throw new Error("INVALID_ENCRYPTED_JOB_PAYLOAD");
    const requestPayload = JSON.parse(
      cipher.decrypt(storedPayload.ciphertext, data.organizationId),
    ) as ArticlePayload;
    if (!articleId) {
      const created = (await callAnswerBit(
        "/geo/article/create",
        requestPayload,
        {
          organizationId: data.organizationId,
          teamBindingId: context.team.id,
          requestId: randomUUID(),
          brandId: context.job.brandId,
          actorUserId: context.job.requestedBy,
        },
        120_000,
      )) as { id?: string | number };
      if (created.id === undefined) throw new Error("INVALID_CREATE_RESPONSE");
      articleId = String(created.id);
      const [storedArticleId] = await db
        .update(articleGenerationJobs)
        .set({ answerbitArticleId: articleId, updatedAt: new Date() })
        .where(
          and(
            eq(articleGenerationJobs.id, data.jobId),
            eq(articleGenerationJobs.executionId, executionId),
          ),
        )
        .returning({ id: articleGenerationJobs.id });
      if (!storedArticleId) throw new Error("ARTICLE_JOB_SUPERSEDED");
    }
    let content: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        content = (await callAnswerBit(
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
        )) as Record<string, unknown>;
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await delay(500 * 2 ** attempt);
      }
    }
    if (
      !content ||
      typeof content.title !== "string" ||
      typeof content.main_body !== "string"
    )
      throw new Error("INVALID_CONTENT_RESPONSE");
    const upstreamTags = Array.isArray(content.tags)
      ? content.tags.map((tag) => ({
          tagId: String((tag as { tag_id?: unknown }).tag_id ?? ""),
          tagName: String((tag as { tag_name?: unknown }).tag_name ?? ""),
        }))
      : [];
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
          articleTitle: content.title as string,
          articleBody: content.main_body as string,
          articleStatus: Number(content.status),
          templateType: Number(content.template_type),
          source: Number(content.source),
          language: String(content.language),
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
          title: content.title as string,
          status: Number(content.status),
          source: Number(content.source),
          templateType: Number(content.template_type),
          language: String(content.language),
        })
        .onConflictDoUpdate({
          target: [
            answerbitArticleMappings.organizationId,
            answerbitArticleMappings.teamBindingId,
            answerbitArticleMappings.brandId,
            answerbitArticleMappings.articleId,
          ],
          set: {
            title: content.title as string,
            status: Number(content.status),
            source: Number(content.source),
            templateType: Number(content.template_type),
            language: String(content.language),
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
          title: content.title as string,
          body: content.main_body as string,
          status: "ready",
          language: String(content.language),
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
    const transportUncertain =
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "TimeoutError");
    const uncertain = !articleId && transportUncertain;
    const [failed] = await db
      .update(articleGenerationJobs)
      .set({
        status: "failed",
        errorCode: uncertain
          ? "ANSWERBIT_CREATE_UNCERTAIN"
          : articleId
            ? "ARTICLE_CONTENT_FETCH_FAILED"
            : "ARTICLE_CREATE_FAILED",
        completedAt: new Date(),
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
    if (chargedPoints > 0) {
      try {
        await restoreFeaturePoints(
          "ai_article_generation",
          "AI 文章生成",
          chargedPoints,
          featureContext,
        );
      } catch (restoreError) {
        console.error(
          JSON.stringify({
            event: "feature-usage.restore-failed",
            featureCode: "ai_article_generation",
            jobId: data.jobId,
            message:
              restoreError instanceof Error ? restoreError.message : "unknown",
          }),
        );
      }
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

type ExportFilters = {
  beginDate: string;
  endDate: string;
  titleIds?: string[];
  promptIds?: string[];
  platforms?: string[];
  tagIds?: string[];
  keyword?: string;
};
async function processReportExport(data: {
  organizationId: string;
  exportId: string;
}) {
  const executionId = randomUUID();
  const [claimed] = await db
    .update(reportExports)
    .set({
      status: "running",
      executionId,
      startedAt: new Date(),
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reportExports.id, data.exportId),
        eq(reportExports.organizationId, data.organizationId),
        eq(reportExports.status, "queued"),
      ),
    )
    .returning();
  if (!claimed) return;
  try {
    const [membership] = await db
      .select({
        status: organizationMembers.status,
        organizationStatus: organizations.status,
        role: roles.code,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId),
      )
      .leftJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
      .leftJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(
        and(
          eq(organizationMembers.organizationId, data.organizationId),
          eq(organizationMembers.userId, claimed.requestedBy),
        ),
      )
      .limit(1);
    if (
      !membership ||
      membership.status !== "active" ||
      membership.organizationStatus !== "active"
    )
      throw new Error("REPORT_PERMISSION_REVOKED");
    const organizationAllowed =
      membership.role &&
      hasPermission(membership.role as Role, "report.export");
    if (!organizationAllowed) {
      const [access] = await db
        .select({ role: brandAccess.role })
        .from(brandAccess)
        .where(
          and(
            eq(brandAccess.organizationId, data.organizationId),
            eq(brandAccess.teamBindingId, claimed.teamBindingId),
            eq(brandAccess.brandId, claimed.brandId),
            eq(brandAccess.userId, claimed.requestedBy),
          ),
        )
        .limit(1);
      if (!access || !hasPermission(access.role as Role, "report.export"))
        throw new Error("REPORT_PERMISSION_REVOKED");
    }
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
    const filters = claimed.filters as ExportFilters;
    const operation =
      claimed.reportType === "answers"
        ? "/geo/task/get"
        : claimed.reportType === "domain_rank"
          ? "/geo/domain/rank"
          : "/geo/article/rank";
    const rows: Record<string, unknown>[] = [];
    let page = 1;
    let total = 0;
    do {
      const payload = {
        brand_id: claimed.brandId,
        begin_date: filters.beginDate,
        end_date: filters.endDate,
        title_ids: filters.titleIds ?? [],
        prompt_ids: filters.promptIds ?? [],
        platforms: filters.platforms ?? [],
        tag_ids: filters.tagIds ?? [],
        ...(claimed.reportType === "answers"
          ? {
              include: 1,
              mention_brand: -1,
              min_score: 0,
              max_score: 100,
              page,
              page_size: 100,
            }
          : claimed.reportType === "domain_rank"
            ? { domain: filters.keyword, page, page_size: 100 }
            : { keyword: filters.keyword, page, page_size: 100 }),
      };
      const result = (await callAnswerBit(
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
      )) as Record<string, unknown>;
      const chunk = (
        claimed.reportType === "answers"
          ? result.scores
          : result.reference_count
      ) as unknown;
      if (!Array.isArray(chunk)) throw new Error("INVALID_REPORT_RESPONSE");
      rows.push(
        ...chunk.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === "object",
        ),
      );
      total = typeof result.total === "number" ? result.total : rows.length;
      page += 1;
      if (!chunk.length) break;
    } while (rows.length < Math.min(total, 10_000));
    const completedAt = new Date();
    const expiresAt = new Date(completedAt.getTime() + 24 * 60 * 60_000);
    const filename = `geo-${claimed.reportType}-${filters.beginDate}-${filters.endDate}-${claimed.id.slice(0, 8)}.csv`;
    const [completed] = await db
      .update(reportExports)
      .set({
        status: "succeeded",
        filename,
        mimeType: "text/csv",
        fileContent: recordsToCsv(rows.slice(0, 10_000)),
        rowCount: Math.min(rows.length, 10_000),
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
          error instanceof Error
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

async function enqueueRecoveredArticle(input: {
  id: string;
  organizationId: string;
}) {
  const queueJobId = await boss.send(
    "article-generation",
    { organizationId: input.organizationId, jobId: input.id },
    { retryLimit: 0, expireInSeconds: 300 },
  );
  if (!queueJobId) throw new Error("ARTICLE_JOB_REDELIVERY_FAILED");
  await db
    .update(articleGenerationJobs)
    .set({ queueJobId, errorCode: null, updatedAt: new Date() })
    .where(
      and(
        eq(articleGenerationJobs.id, input.id),
        eq(articleGenerationJobs.status, "queued"),
        isNull(articleGenerationJobs.executionId),
      ),
    );
}

async function enqueueRecoveredReport(input: {
  id: string;
  organizationId: string;
}) {
  const queueJobId = await boss.send(
    "report-export",
    { organizationId: input.organizationId, exportId: input.id },
    { retryLimit: 0, expireInSeconds: 600 },
  );
  if (!queueJobId) throw new Error("REPORT_JOB_REDELIVERY_FAILED");
  await db
    .update(reportExports)
    .set({ queueJobId, errorCode: null, updatedAt: new Date() })
    .where(
      and(
        eq(reportExports.id, input.id),
        eq(reportExports.status, "queued"),
        isNull(reportExports.executionId),
      ),
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
        const [charge] =
          candidate.status === "running" && !candidate.answerbitArticleId
            ? await db
                .select({ amount: balanceTransactions.amount })
                .from(balanceTransactions)
                .where(
                  and(
                    eq(
                      balanceTransactions.organizationId,
                      candidate.organizationId,
                    ),
                    eq(
                      balanceTransactions.idempotencyKey,
                      `feature:ai_article_generation:${candidate.id}:consume`,
                    ),
                  ),
                )
                .limit(1)
            : [];
        const action = decideAsyncJobRecovery({
          kind: "article",
          status: candidate.status as "queued" | "running",
          queueState: state,
          hasExternalId: Boolean(candidate.answerbitArticleId),
          hasFeatureCharge: Boolean(charge),
        });
        if (action === "none") {
          result.activeJobs += 1;
          continue;
        }
        const candidateCutoff =
          candidate.status === "queued" ? queuedCutoff : runningCutoff;
        const executionCondition = candidate.executionId
          ? eq(articleGenerationJobs.executionId, candidate.executionId)
          : isNull(articleGenerationJobs.executionId);
        if (action === "fail_uncertain") {
          const [failed] = await db
            .update(articleGenerationJobs)
            .set({
              status: "failed",
              executionId: null,
              errorCode: "ARTICLE_RECOVERY_UNCERTAIN",
              completedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(articleGenerationJobs.id, candidate.id),
                eq(articleGenerationJobs.status, candidate.status),
                executionCondition,
                lte(articleGenerationJobs.updatedAt, candidateCutoff),
              ),
            )
            .returning({ id: articleGenerationJobs.id });
          if (!failed) {
            result.races += 1;
            continue;
          }
          result.uncertainArticles += 1;
          if (charge)
            await restoreFeaturePoints(
              "ai_article_generation",
              "AI 文章生成",
              charge.amount,
              {
                organizationId: candidate.organizationId,
                brandId: candidate.brandId,
                actorUserId: candidate.requestedBy,
                referenceId: candidate.id,
              },
            );
          continue;
        }

        const [reset] = await db
          .update(articleGenerationJobs)
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
              eq(articleGenerationJobs.id, candidate.id),
              eq(articleGenerationJobs.status, candidate.status),
              executionCondition,
              lte(articleGenerationJobs.updatedAt, candidateCutoff),
            ),
          )
          .returning({ id: articleGenerationJobs.id });
        if (!reset) {
          result.races += 1;
          continue;
        }
        await enqueueRecoveredArticle(candidate);
        result.requeuedArticles += 1;
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
        await enqueueRecoveredReport(candidate);
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

type NotificationRule = typeof notificationRules.$inferSelect;
async function publishNotification(
  rule: NotificationRule,
  event: {
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    payload: Record<string, unknown>;
  },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${rule.id}))`);
    const now = new Date();
    const cutoff = new Date(now.getTime() - rule.cooldownMinutes * 60_000);
    const [recent] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.ruleId, rule.id),
          gte(notifications.occurredAt, cutoff),
        ),
      )
      .orderBy(desc(notifications.occurredAt))
      .limit(1);
    if (recent) return false;
    const bucket = Math.floor(now.getTime() / (rule.cooldownMinutes * 60_000));
    const eventKey = createHash("sha256")
      .update(`${rule.id}:${bucket}`)
      .digest("hex");
    const created = await tx
      .insert(notifications)
      .values({
        organizationId: rule.organizationId,
        ruleId: rule.id,
        teamBindingId: rule.teamBindingId,
        brandId: rule.brandId,
        type: rule.type,
        eventKey,
        occurredAt: now,
        ...event,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    return Boolean(created.length);
  });
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
  let evaluated = 0;
  let emitted = 0;
  let failed = 0;
  for (const item of rulesToEvaluate) {
    const { rule, team } = item;
    const context = {
      organizationId: rule.organizationId,
      teamBindingId: team.id,
      requestId: randomUUID(),
      brandId: rule.brandId ?? undefined,
    };
    try {
      if (rule.type === "low_credits") {
        const [account] = await db
          .select({ balance: balanceAccounts.balance })
          .from(balanceAccounts)
          .innerJoin(
            answerbitBrandMappings,
            and(
              eq(
                answerbitBrandMappings.organizationId,
                balanceAccounts.organizationId,
              ),
              eq(answerbitBrandMappings.brandId, balanceAccounts.brandId),
            ),
          )
          .where(
            and(
              eq(balanceAccounts.organizationId, rule.organizationId),
              eq(balanceAccounts.asset, "answerbit_points"),
            ),
          )
          .limit(1);
        const available = answerBitAvailableCredits({
          total_amount: account?.balance ?? 0,
        });
        if (
          available <= rule.threshold &&
          (await publishNotification(rule, {
            severity: available === 0 ? "critical" : "warning",
            title:
              available === 0 ? "AnswerBit 积分已耗尽" : "AnswerBit 积分不足",
            message: `当前品牌可用平台积分 ${available.toLocaleString("zh-CN")}，已达到企业配置的 ${rule.threshold.toLocaleString("zh-CN")} 阈值。`,
            payload: {
              available,
              asset: "answerbit_points",
              scope: "brand",
              threshold: rule.threshold,
            },
          }))
        )
          emitted += 1;
      } else if (rule.type === "connection_failure") {
        let errorCode = "ANSWERBIT_CONNECTION_FAILED";
        try {
          await callAnswerBit(
            "/geo/query/brand",
            { team_id: team.teamId },
            context,
            15_000,
          );
        } catch (error) {
          errorCode =
            error instanceof Error ? error.message.slice(0, 128) : errorCode;
          const selectionFailure = [
            "ANSWERBIT_KEY_NOT_CONFIGURED",
            "ANSWERBIT_KEY_SCOPE_MISMATCH",
            "ANSWERBIT_KEY_PERMISSION_DENIED",
            "ANSWERBIT_TEAM_SCOPE_MISMATCH",
          ].includes(errorCode);
          const teamCredentials = await db
            .select({
              connectionId: answerbitCredentialAssignments.connectionId,
            })
            .from(answerbitCredentialAssignments)
            .where(eq(answerbitCredentialAssignments.teamBindingId, team.id));
          const connectionIds = [
            ...new Set([
              team.connectionId,
              ...teamCredentials.map((credential) => credential.connectionId),
            ]),
          ];
          const checks = connectionIds.length
            ? await db
                .select({ status: answerbitApiCalls.status })
                .from(answerbitApiCalls)
                .where(
                  and(
                    inArray(answerbitApiCalls.connectionId, connectionIds),
                    eq(answerbitApiCalls.operation, "/geo/query/brand"),
                  ),
                )
                .orderBy(desc(answerbitApiCalls.createdAt))
                .limit(connectionFailureLookbackLimit(rule.threshold))
            : [];
          const consecutive = selectionFailure
            ? rule.threshold
            : countConsecutiveFailures(checks);
          const classification = classifyConnectionFailure(
            consecutive,
            rule.threshold,
          );
          if (
            classification.triggered &&
            (await publishNotification(rule, {
              severity: classification.severity,
              title: "AnswerBit 连接连续失败",
              message: `连接测试已连续失败 ${classification.consecutiveFailures} 次，请检查 API Key、TeamID 与上游服务状态。`,
              payload: {
                consecutiveFailures: classification.consecutiveFailures,
                threshold: rule.threshold,
                errorCode,
              },
            }))
          )
            emitted += 1;
        }
      } else {
        if (!rule.brandId || !rule.metric || !rule.windowDays)
          throw new Error("INVALID_METRIC_RULE");
        const end = new Date();
        const begin = new Date(end);
        begin.setUTCDate(begin.getUTCDate() - rule.windowDays + 1);
        const iso = (date: Date) => date.toISOString().slice(0, 10);
        const result = (await callAnswerBit(
          "/geo/base/dashboard",
          {
            brand_id: rule.brandId,
            begin_date: iso(begin),
            end_date: iso(end),
            title_ids: [],
            platforms: [],
            tag_ids: [],
          },
          context,
          15_000,
        )) as Record<string, unknown>;
        const sample = result[rule.metric] as
          | { value?: unknown; fluctuation?: unknown }
          | undefined;
        const value = Number(sample?.value);
        const fluctuation = Number(sample?.fluctuation);
        if (!Number.isFinite(value) || !Number.isFinite(fluctuation))
          throw new Error("INVALID_METRIC_RESPONSE");
        const classification = classifyMetricAnomaly(
          rule.metric,
          fluctuation,
          rule.threshold,
        );
        if (classification.anomalous) {
          const names = {
            exposure: "品牌提及率",
            score: "GEO 得分",
            avg_rank: "平均排名",
          } as const;
          const direction = classification.direction === "up" ? "上升" : "下降";
          if (
            await publishNotification(rule, {
              severity: classification.severity,
              title: `${names[rule.metric]}异常`,
              message: `${names[rule.metric]}${direction} ${Math.abs(fluctuation).toFixed(1)}%，超过 ${rule.threshold}% 阈值。`,
              payload: {
                metric: rule.metric,
                value,
                fluctuation,
                threshold: rule.threshold,
                windowDays: rule.windowDays,
              },
            })
          )
            emitted += 1;
        }
      }
      evaluated += 1;
      await db
        .update(notificationRules)
        .set({
          lastEvaluatedAt: new Date(),
          lastEvaluationError: null,
          updatedAt: new Date(),
        })
        .where(eq(notificationRules.id, rule.id));
    } catch (error) {
      failed += 1;
      await db
        .update(notificationRules)
        .set({
          lastEvaluatedAt: new Date(),
          lastEvaluationError:
            error instanceof Error
              ? error.message.slice(0, 128)
              : "NOTIFICATION_EVALUATION_FAILED",
          updatedAt: new Date(),
        })
        .where(eq(notificationRules.id, rule.id));
    }
  }
  console.info(
    JSON.stringify({
      event: "notification-evaluation.completed",
      evaluated,
      emitted,
      failed,
    }),
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
    if (trackingReady)
      try {
        await recordRuntimeTaskCompletion({
          taskName,
          runId,
          state: "succeeded",
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
      : frogPublicationClient;
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
  return runBillingMaintenance();
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
await boss.schedule("tencent-enterprise-sync", "*/5 * * * *", null, {
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

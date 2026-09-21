import { answerbitApiCalls, db } from "@geo/db";
import type { AnswerBitOperation } from "@geo/core";
import {
  resolveAnswerBitCredential,
  type AnswerBitCredentialSource,
} from "./credential-resolver";
import { AnswerBitError } from "./errors";
import {
  createBrand,
  createBrandBundle,
  getBrandDetail,
  queryBrands,
  updateBrand,
  updateBrandIcon,
} from "./modules/brands";
import {
  createCompetitor,
  deleteCompetitor,
  queryCompetitors,
  updateCompetitor,
} from "./modules/competitors";
import {
  queryDashboardMetrics,
  queryExposureRank,
  queryExposureTrends,
  queryFilterPlatforms,
  queryScoreRank,
  queryScoreTrends,
} from "./modules/dashboard";
import {
  createPrompt,
  createPromptsBatch,
  createTitle,
  deletePrompt,
  deletePromptsBatch,
  deleteTitle,
  movePrompt,
  queryPromptGroups,
  queryTitles,
  updatePrompt,
  updateTitle,
} from "./modules/prompts";
import {
  queryArticleRank,
  queryArticleTags,
  queryDomainRank,
  queryPromptTrends,
  queryTaskDetail,
  queryTasks,
  queryTitleRank,
} from "./modules/insights";
import {
  createArticle,
  getArticleContent,
  queryArticles,
  queryArticleTemplates,
  queryArticleTraceDetail,
  traceArticle,
} from "./modules/articles";
import {
  purchaseQuota,
  queryBillingLogs,
  queryBillingUsage,
  queryCreditBills,
  queryCreditRank,
  queryCreditStatus,
  queryCreditTrend,
  queryCreditUsage,
  queryQuotaOverrides,
  querySubscription,
} from "./modules/billing";

type CallContext = {
  organizationId: string;
  connectionId: string;
  requestId: string;
  actorUserId: string;
  brandId?: string;
};
type CredentialSource = string | AnswerBitCredentialSource;

async function recordApiCall(
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

// @project-doc docs/interfaces/answerbit_integration.md#feature_billing
async function loggedCall<T>(
  operation: AnswerBitOperation,
  context: CallContext,
  execute: () => Promise<T>,
) {
  const startedAt = performance.now();
  const apiCallContext = {
    organizationId: context.organizationId,
    connectionId: context.connectionId,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
  };
  try {
    const result = await execute();
    await recordApiCall({
      ...apiCallContext,
      operation,
      status: "success",
      answerbitCode: 0,
      httpStatus: 200,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    const normalized = error instanceof AnswerBitError ? error : undefined;
    await recordApiCall({
      ...apiCallContext,
      operation,
      status: normalized?.kind === "timeout" ? "timeout" : "failed",
      answerbitCode: normalized?.businessCode,
      httpStatus: normalized?.httpStatus,
      errorCode: normalized
        ? `ANSWERBIT_${normalized.kind.toUpperCase()}`
        : "ANSWERBIT_UNKNOWN",
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}

async function credentialCall<T>(
  operation: AnswerBitOperation,
  source: CredentialSource,
  context: CallContext,
  execute: (apiKey: string) => Promise<T>,
) {
  if (typeof source === "string")
    return loggedCall(operation, context, () => execute(source));
  const credential = await resolveAnswerBitCredential(
    source,
    operation,
    context.brandId,
  );
  return loggedCall(
    operation,
    { ...context, connectionId: credential.connectionId },
    () => execute(credential.apiKey),
  );
}
export const queryBrandsLogged = (
  apiKey: CredentialSource,
  teamId: string,
  context: CallContext,
) =>
  credentialCall("/geo/query/brand", apiKey, context, (resolvedApiKey) =>
    queryBrands(resolvedApiKey, teamId, context.requestId),
  );
export const createBrandLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof createBrand>[1],
  context: CallContext,
) =>
  credentialCall("/geo/brand/create", apiKey, context, (resolvedApiKey) =>
    createBrand(resolvedApiKey, payload, context.requestId),
  );
export const createBrandBundleLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof createBrandBundle>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/brand/bundle/create",
    apiKey,
    context,
    (resolvedApiKey) =>
      createBrandBundle(resolvedApiKey, payload, context.requestId),
  );
export const getBrandDetailLogged = (
  apiKey: CredentialSource,
  brandId: string,
  context: CallContext,
) =>
  credentialCall("/geo/brand/get", apiKey, context, (resolvedApiKey) =>
    getBrandDetail(resolvedApiKey, brandId, context.requestId),
  );
export const updateBrandLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof updateBrand>[1],
  context: CallContext,
) =>
  credentialCall("/geo/brand/update", apiKey, context, (resolvedApiKey) =>
    updateBrand(resolvedApiKey, payload, context.requestId),
  );
export const updateBrandIconLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof updateBrandIcon>[1],
  context: CallContext,
) =>
  credentialCall("/geo/brand/update/icon", apiKey, context, (resolvedApiKey) =>
    updateBrandIcon(resolvedApiKey, payload, context.requestId),
  );
export const queryCompetitorsLogged = (
  apiKey: CredentialSource,
  brandId: string,
  context: CallContext,
) =>
  credentialCall("/geo/competitor/get", apiKey, context, (resolvedApiKey) =>
    queryCompetitors(resolvedApiKey, brandId, context.requestId),
  );
export const createCompetitorLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof createCompetitor>[1],
  context: CallContext,
) =>
  credentialCall("/geo/competitor/create", apiKey, context, (resolvedApiKey) =>
    createCompetitor(resolvedApiKey, payload, context.requestId),
  );
export const updateCompetitorLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof updateCompetitor>[1],
  context: CallContext,
) =>
  credentialCall("/geo/competitor/update", apiKey, context, (resolvedApiKey) =>
    updateCompetitor(resolvedApiKey, payload, context.requestId),
  );
export const deleteCompetitorLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof deleteCompetitor>[1],
  context: CallContext,
) =>
  credentialCall("/geo/competitor/delete", apiKey, context, (resolvedApiKey) =>
    deleteCompetitor(resolvedApiKey, payload, context.requestId),
  );
export const queryDashboardMetricsLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryDashboardMetrics>[1],
  context: CallContext,
) =>
  credentialCall("/geo/base/dashboard", apiKey, context, (resolvedApiKey) =>
    queryDashboardMetrics(resolvedApiKey, payload, context.requestId),
  );
export const queryExposureTrendsLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryExposureTrends>[1],
  context: CallContext,
) =>
  credentialCall("/geo/exposure/trends", apiKey, context, (resolvedApiKey) =>
    queryExposureTrends(resolvedApiKey, payload, context.requestId),
  );
export const queryScoreTrendsLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryScoreTrends>[1],
  context: CallContext,
) =>
  credentialCall("/geo/score/trends", apiKey, context, (resolvedApiKey) =>
    queryScoreTrends(resolvedApiKey, payload, context.requestId),
  );
export const queryExposureRankLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryExposureRank>[1],
  context: CallContext,
) =>
  credentialCall("/geo/exposure/rank", apiKey, context, (resolvedApiKey) =>
    queryExposureRank(resolvedApiKey, payload, context.requestId),
  );
export const queryScoreRankLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryScoreRank>[1],
  context: CallContext,
) =>
  credentialCall("/geo/score/rank", apiKey, context, (resolvedApiKey) =>
    queryScoreRank(resolvedApiKey, payload, context.requestId),
  );
export const queryFilterPlatformsLogged = (
  apiKey: CredentialSource,
  teamId: string,
  context: CallContext,
) =>
  credentialCall(
    "/geo/team/get/filter_platforms",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryFilterPlatforms(resolvedApiKey, teamId, context.requestId),
  );
export const queryTitlesLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryTitles>[1],
  context: CallContext,
) =>
  credentialCall("/geo/title/get", apiKey, context, (resolvedApiKey) =>
    queryTitles(resolvedApiKey, payload, context.requestId),
  );
export const createTitleLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof createTitle>[1],
  context: CallContext,
) =>
  credentialCall("/geo/title/create", apiKey, context, (resolvedApiKey) =>
    createTitle(resolvedApiKey, payload, context.requestId),
  );
export const updateTitleLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof updateTitle>[1],
  context: CallContext,
) =>
  credentialCall("/geo/title/update", apiKey, context, (resolvedApiKey) =>
    updateTitle(resolvedApiKey, payload, context.requestId),
  );
export const deleteTitleLogged = (
  apiKey: CredentialSource,
  id: string,
  context: CallContext,
) =>
  credentialCall("/geo/title/delete", apiKey, context, (resolvedApiKey) =>
    deleteTitle(resolvedApiKey, id, context.requestId),
  );
export const queryPromptGroupsLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryPromptGroups>[1],
  context: CallContext,
) =>
  credentialCall("/geo/prompt/get/group", apiKey, context, (resolvedApiKey) =>
    queryPromptGroups(resolvedApiKey, payload, context.requestId),
  );
export const createPromptLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof createPrompt>[1],
  context: CallContext,
) =>
  credentialCall("/geo/prompt/create", apiKey, context, (resolvedApiKey) =>
    createPrompt(resolvedApiKey, payload, context.requestId),
  );
export const createPromptsBatchLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof createPromptsBatch>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/prompt/create/batch",
    apiKey,
    context,
    (resolvedApiKey) =>
      createPromptsBatch(resolvedApiKey, payload, context.requestId),
  );
export const updatePromptLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof updatePrompt>[1],
  context: CallContext,
) =>
  credentialCall("/geo/prompt/update", apiKey, context, (resolvedApiKey) =>
    updatePrompt(resolvedApiKey, payload, context.requestId),
  );
export const movePromptLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof movePrompt>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/prompt/relation/update",
    apiKey,
    context,
    (resolvedApiKey) => movePrompt(resolvedApiKey, payload, context.requestId),
  );
export const deletePromptLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof deletePrompt>[1],
  context: CallContext,
) =>
  credentialCall("/geo/prompt/delete", apiKey, context, (resolvedApiKey) =>
    deletePrompt(resolvedApiKey, payload, context.requestId),
  );
export const deletePromptsBatchLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof deletePromptsBatch>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/prompt/delete/batch",
    apiKey,
    context,
    (resolvedApiKey) =>
      deletePromptsBatch(resolvedApiKey, payload, context.requestId),
  );
export const queryArticleTagsLogged = (
  apiKey: CredentialSource,
  teamId: string,
  tagType: 1 | 2 | undefined,
  context: CallContext,
) =>
  credentialCall("/geo/article/tag/get", apiKey, context, (resolvedApiKey) =>
    queryArticleTags(resolvedApiKey, teamId, tagType, context.requestId),
  );
export const queryTasksLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryTasks>[1],
  context: CallContext,
) =>
  credentialCall("/geo/task/get", apiKey, context, (resolvedApiKey) =>
    queryTasks(resolvedApiKey, payload, context.requestId),
  );
export const queryTaskDetailLogged = (
  apiKey: CredentialSource,
  brandId: string,
  taskId: string,
  context: CallContext,
) =>
  credentialCall("/geo/task/detail/get", apiKey, context, (resolvedApiKey) =>
    queryTaskDetail(resolvedApiKey, brandId, taskId, context.requestId),
  );
export const queryDomainRankLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryDomainRank>[1],
  context: CallContext,
) =>
  credentialCall("/geo/domain/rank", apiKey, context, (resolvedApiKey) =>
    queryDomainRank(resolvedApiKey, payload, context.requestId),
  );
export const queryArticleRankLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryArticleRank>[1],
  context: CallContext,
) =>
  credentialCall("/geo/article/rank", apiKey, context, (resolvedApiKey) =>
    queryArticleRank(resolvedApiKey, payload, context.requestId),
  );
export const queryPromptTrendsLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryPromptTrends>[1],
  context: CallContext,
) =>
  credentialCall("/geo/prompt/trends", apiKey, context, (resolvedApiKey) =>
    queryPromptTrends(resolvedApiKey, payload, context.requestId),
  );
export const queryTitleRankLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryTitleRank>[1],
  context: CallContext,
) =>
  credentialCall("/geo/title/rank", apiKey, context, (resolvedApiKey) =>
    queryTitleRank(resolvedApiKey, payload, context.requestId),
  );
export const traceArticleLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof traceArticle>[1],
  context: CallContext,
) =>
  credentialCall("/geo/article/trace/save", apiKey, context, (resolvedApiKey) =>
    traceArticle(resolvedApiKey, payload, context.requestId),
  );
export const queryArticlesLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryArticles>[1],
  context: CallContext,
) =>
  credentialCall("/geo/article/query", apiKey, context, (resolvedApiKey) =>
    queryArticles(resolvedApiKey, payload, context.requestId),
  );
export const queryArticleTraceDetailLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryArticleTraceDetail>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/article/trace/detail",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryArticleTraceDetail(resolvedApiKey, payload, context.requestId),
  );
export const queryArticleTemplatesLogged = (
  apiKey: CredentialSource,
  localCode: string,
  context: CallContext,
) =>
  credentialCall(
    "/geo/article/template/get",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryArticleTemplates(resolvedApiKey, localCode, context.requestId),
  );
export const createArticleLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof createArticle>[1],
  context: CallContext,
) =>
  credentialCall("/geo/article/create", apiKey, context, (resolvedApiKey) =>
    createArticle(resolvedApiKey, payload, context.requestId),
  );
export const getArticleContentLogged = (
  apiKey: CredentialSource,
  brandId: string,
  articleId: string,
  context: CallContext,
) =>
  credentialCall("/geo/article/get", apiKey, context, (resolvedApiKey) =>
    getArticleContent(resolvedApiKey, brandId, articleId, context.requestId),
  );
export const queryBillingUsageLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryBillingUsage>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/report/usage",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryBillingUsage(resolvedApiKey, payload, context.requestId),
  );
export const querySubscriptionLogged = (
  apiKey: CredentialSource,
  teamId: string,
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/subscription/get",
    apiKey,
    context,
    (resolvedApiKey) =>
      querySubscription(resolvedApiKey, teamId, context.requestId),
  );
export const queryCreditStatusLogged = (
  apiKey: CredentialSource,
  teamId: string,
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/credit/status",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryCreditStatus(resolvedApiKey, teamId, context.requestId),
  );
export const queryCreditUsageLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryCreditUsage>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/credit/usage",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryCreditUsage(resolvedApiKey, payload, context.requestId),
  );
export const queryCreditTrendLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryCreditTrend>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/credit/trend",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryCreditTrend(resolvedApiKey, payload, context.requestId),
  );
export const queryCreditRankLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryCreditRank>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/credit/rank",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryCreditRank(resolvedApiKey, payload, context.requestId),
  );
export const queryCreditBillsLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryCreditBills>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/credit/bills",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryCreditBills(resolvedApiKey, payload, context.requestId),
  );
export const queryBillingLogsLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryBillingLogs>[1],
  context: CallContext,
) =>
  credentialCall("/geo/billing/logs/list", apiKey, context, (resolvedApiKey) =>
    queryBillingLogs(resolvedApiKey, payload, context.requestId),
  );
export const queryQuotaOverridesLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof queryQuotaOverrides>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/quota/override/list",
    apiKey,
    context,
    (resolvedApiKey) =>
      queryQuotaOverrides(resolvedApiKey, payload, context.requestId),
  );

export const purchaseQuotaLogged = (
  apiKey: CredentialSource,
  payload: Parameters<typeof purchaseQuota>[1],
  context: CallContext,
) =>
  credentialCall(
    "/geo/billing/quota/purchase",
    apiKey,
    context,
    (resolvedApiKey) =>
      purchaseQuota(resolvedApiKey, payload, context.requestId),
  );

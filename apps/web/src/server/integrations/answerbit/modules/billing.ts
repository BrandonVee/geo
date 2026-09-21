import type { AnswerBitOperation } from "@geo/core";
import { z } from "zod";
import { AnswerBitClient } from "../client";
import {
  answerBitBillingLogsSchema,
  answerBitBillingUsageSchema,
  answerBitCreditBillsSchema,
  answerBitCreditRankSchema,
  answerBitCreditStatusSchema,
  answerBitCreditTrendSchema,
  answerBitCreditUsageSchema,
  answerBitQuotaOverridesSchema,
  answerBitSubscriptionSchema,
} from "../schemas";

type ScopePayload = { team_id: string; brand_id?: string };
export type CreditPeriodPayload = ScopePayload & {
  start_unix?: number;
  end_unix?: number;
  quota_types?: string[];
};
export type BillingPagePayload = ScopePayload & {
  page?: number;
  page_size?: number;
  keyword?: string;
  start_time?: number;
  end_time?: number;
  status?: number;
};
export type PurchaseQuotaPayload = {
  team_id: string;
  quota_type: "max_brand";
  quota_amount: number;
};
type BillingCallThrottle = {
  nextCallAt: number;
  queue: Promise<void>;
};
const globalForBillingThrottle = globalThis as typeof globalThis & {
  __geoAnswerBitBillingThrottle?: BillingCallThrottle;
};
const billingCallThrottle =
  globalForBillingThrottle.__geoAnswerBitBillingThrottle ??
  (globalForBillingThrottle.__geoAnswerBitBillingThrottle = {
    nextCallAt: 0,
    queue: Promise.resolve(),
  });
const scheduleBillingCall = <T>(execute: () => Promise<T>) => {
  const current = billingCallThrottle.queue.then(async () => {
    const waitMs = Math.max(0, billingCallThrottle.nextCallAt - Date.now());
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    billingCallThrottle.nextCallAt = Date.now() + 350;
    return execute();
  });
  billingCallThrottle.queue = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
};
const read = <T>(
  apiKey: string,
  operation: AnswerBitOperation,
  payload: unknown,
  schema: z.ZodType<T>,
  requestId: string,
) =>
  scheduleBillingCall(() =>
    new AnswerBitClient(apiKey).post<T>(operation, payload, schema, requestId, {
      retries: 2,
      timeoutMs: 15_000,
      retryRateLimited: true,
    }),
  );

export const queryBillingUsage = (
  apiKey: string,
  payload: ScopePayload,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/report/usage",
    payload,
    answerBitBillingUsageSchema,
    requestId,
  );
export const querySubscription = (
  apiKey: string,
  teamId: string,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/subscription/get",
    { team_id: teamId },
    answerBitSubscriptionSchema,
    requestId,
  );
export const queryCreditStatus = (
  apiKey: string,
  teamId: string,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/credit/status",
    { team_id: teamId },
    answerBitCreditStatusSchema,
    requestId,
  );
export const queryCreditUsage = (
  apiKey: string,
  payload: CreditPeriodPayload,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/credit/usage",
    payload,
    answerBitCreditUsageSchema,
    requestId,
  );
export const queryCreditTrend = (
  apiKey: string,
  payload: CreditPeriodPayload,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/credit/trend",
    payload,
    answerBitCreditTrendSchema,
    requestId,
  );
export const queryCreditRank = (
  apiKey: string,
  payload: Pick<CreditPeriodPayload, "team_id" | "start_unix" | "end_unix">,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/credit/rank",
    payload,
    answerBitCreditRankSchema,
    requestId,
  );
export const queryCreditBills = (
  apiKey: string,
  payload: BillingPagePayload,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/credit/bills",
    payload,
    answerBitCreditBillsSchema,
    requestId,
  );
export const queryBillingLogs = (
  apiKey: string,
  payload: Pick<
    BillingPagePayload,
    "team_id" | "page" | "page_size" | "keyword"
  >,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/logs/list",
    payload,
    answerBitBillingLogsSchema,
    requestId,
  );
export const queryQuotaOverrides = (
  apiKey: string,
  payload: Pick<BillingPagePayload, "team_id" | "page" | "page_size">,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/billing/quota/override/list",
    payload,
    answerBitQuotaOverridesSchema,
    requestId,
  );

export const purchaseQuota = (
  apiKey: string,
  payload: PurchaseQuotaPayload,
  requestId: string,
) =>
  scheduleBillingCall(() =>
    new AnswerBitClient(apiKey).post(
      "/geo/billing/quota/purchase",
      payload,
      z.unknown(),
      requestId,
      // 明确被 429 拒绝时可退避重试；结果不确定的超时和 5xx 不重放。
      {
        retries: 2,
        timeoutMs: 15_000,
        retryRateLimited: true,
        retryTransient: false,
      },
    ),
  );

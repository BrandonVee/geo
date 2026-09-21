import type { AnswerBitOperation } from "@geo/core";
import { AnswerBitClient } from "../client";
import { z } from "zod";
import {
  answerBitDashboardMetricsSchema,
  answerBitExposureRankSchema,
  answerBitExposureTrendsSchema,
  answerBitPlatformMapSchema,
  answerBitScoreRankSchema,
  answerBitScoreTrendsSchema,
} from "../schemas";

export type DashboardPayload = {
  brand_id: string;
  begin_date: string;
  end_date: string;
  title_ids?: string[];
  competitor_ids?: string[];
  platforms?: string[];
  tag_ids?: string[];
};
const read = <T>(
  apiKey: string,
  operation: AnswerBitOperation,
  payload: unknown,
  schema: z.ZodType<T>,
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post<T>(operation, payload, schema, requestId, {
    retries: 2,
    timeoutMs: 4_500,
  });

export const queryDashboardMetrics = (
  apiKey: string,
  payload: Omit<DashboardPayload, "competitor_ids">,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/base/dashboard",
    payload,
    answerBitDashboardMetricsSchema,
    requestId,
  );
export const queryExposureTrends = (
  apiKey: string,
  payload: DashboardPayload,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/exposure/trends",
    payload,
    answerBitExposureTrendsSchema,
    requestId,
  );
export const queryScoreTrends = (
  apiKey: string,
  payload: DashboardPayload,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/score/trends",
    payload,
    answerBitScoreTrendsSchema,
    requestId,
  );
export const queryExposureRank = (
  apiKey: string,
  payload: DashboardPayload,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/exposure/rank",
    payload,
    answerBitExposureRankSchema,
    requestId,
  );
export const queryScoreRank = (
  apiKey: string,
  payload: DashboardPayload,
  requestId: string,
) =>
  read(apiKey, "/geo/score/rank", payload, answerBitScoreRankSchema, requestId);
export const queryFilterPlatforms = (
  apiKey: string,
  teamId: string,
  requestId: string,
) =>
  read<Record<string, string>>(
    apiKey,
    "/geo/team/get/filter_platforms",
    { team_id: teamId },
    answerBitPlatformMapSchema,
    requestId,
  );

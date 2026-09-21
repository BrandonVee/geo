import type { AnswerBitOperation } from "@geo/core";
import { AnswerBitClient } from "../client";
import {
  answerBitArticleRankSchema,
  answerBitArticleTagsSchema,
  answerBitDomainRankSchema,
  answerBitPromptTrendsSchema,
  answerBitTaskDetailSchema,
  answerBitTaskListSchema,
  answerBitTitleRankSchema,
} from "../schemas";

const read = <T>(
  apiKey: string,
  operation: AnswerBitOperation,
  payload: unknown,
  schema: import("zod").ZodType<T>,
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post(operation, payload, schema, requestId, {
    retries: 2,
    timeoutMs: 4_500,
  });
export type InsightFilter = {
  brand_id: string;
  begin_date: string;
  end_date: string;
  title_ids?: string[];
  prompt_ids?: string[];
  platforms?: string[];
  tag_ids?: string[];
};
export const queryArticleTags = (
  apiKey: string,
  teamId: string,
  tagType: 1 | 2 | undefined,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/article/tag/get",
    { team_id: teamId, ...(tagType ? { tag_type: tagType } : {}) },
    answerBitArticleTagsSchema,
    requestId,
  );
export const queryTasks = (
  apiKey: string,
  payload: {
    brand_id: string;
    begin_date: string;
    end_date: string;
    include: number;
    prompt?: string;
    title_id?: string[];
    prompt_ids?: string[];
    tag_ids?: string[];
    task_ids?: string[];
    platforms?: string[];
    language?: string[];
    mention_brand: number;
    min_score: number;
    max_score: number;
    url?: string;
    ref_platform?: string;
    article_id?: string;
    page: number;
    page_size: number;
  },
  requestId: string,
) => read(apiKey, "/geo/task/get", payload, answerBitTaskListSchema, requestId);
export const queryTaskDetail = (
  apiKey: string,
  brandId: string,
  taskId: string,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/task/detail/get",
    { brand_id: brandId, task_id: taskId },
    answerBitTaskDetailSchema,
    requestId,
  );
export const queryDomainRank = (
  apiKey: string,
  payload: InsightFilter & { domain?: string; page: number; page_size: number },
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/domain/rank",
    payload,
    answerBitDomainRankSchema,
    requestId,
  );
export const queryArticleRank = (
  apiKey: string,
  payload: InsightFilter & {
    keyword?: string;
    page: number;
    page_size: number;
  },
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/article/rank",
    payload,
    answerBitArticleRankSchema,
    requestId,
  );
export const queryPromptTrends = (
  apiKey: string,
  payload: Omit<InsightFilter, "prompt_ids" | "platforms">,
  requestId: string,
) =>
  read(
    apiKey,
    "/geo/prompt/trends",
    payload,
    answerBitPromptTrendsSchema,
    requestId,
  );
export const queryTitleRank = (
  apiKey: string,
  payload: Omit<InsightFilter, "prompt_ids">,
  requestId: string,
) =>
  read(apiKey, "/geo/title/rank", payload, answerBitTitleRankSchema, requestId);

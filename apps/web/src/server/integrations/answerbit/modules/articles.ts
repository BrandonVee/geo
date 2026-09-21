import { AnswerBitClient } from "../client";
import {
  answerBitArticleContentSchema,
  answerBitArticleListSchema,
  answerBitArticleTemplateSchema,
  answerBitArticleTraceDetailSchema,
  answerBitIdResultSchema,
  answerBitTraceArticleResultSchema,
} from "../schemas";

export type CreateArticlePayload = {
  brand_id: string;
  template_type: number;
  prompt_ids: string[];
  knowledge_ids?: string[];
  once_knowledge?: string;
  high_ref?: { url?: string; title?: string; content?: string };
  tag_ids?: string[];
  language: string;
};
export const traceArticle = (
  apiKey: string,
  payload: {
    brand_id: string;
    title: string;
    urls: string[];
    tag_ids?: string[];
    language: string;
  },
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post(
    "/geo/article/trace/save",
    payload,
    answerBitTraceArticleResultSchema,
    requestId,
    { timeoutMs: 20_000 },
  );
export const queryArticles = (
  apiKey: string,
  payload: {
    brand_id: string;
    limit: number;
    scroll_id?: string;
    start_time?: number;
    end_time?: number;
    title?: string;
    status?: number[];
    source?: number[];
    template_type?: number[];
    tag_ids?: string[];
    ref_order_type?: 1 | 2;
    language?: string[];
    has_video?: boolean;
    has_video_generating?: boolean;
  },
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post(
    "/geo/article/query",
    payload,
    answerBitArticleListSchema,
    requestId,
    { retries: 2, timeoutMs: 4_500 },
  );
export const queryArticleTraceDetail = (
  apiKey: string,
  payload: { article_id: string; begin_date?: string; end_date?: string },
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post(
    "/geo/article/trace/detail",
    payload,
    answerBitArticleTraceDetailSchema,
    requestId,
    { retries: 2, timeoutMs: 4_500 },
  );
export const queryArticleTemplates = (
  apiKey: string,
  localCode: string,
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post(
    "/geo/article/template/get",
    { local_code: localCode },
    answerBitArticleTemplateSchema,
    requestId,
    { retries: 2, timeoutMs: 4_500 },
  );
export const createArticle = (
  apiKey: string,
  payload: CreateArticlePayload,
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post(
    "/geo/article/create",
    payload,
    answerBitIdResultSchema,
    requestId,
    { timeoutMs: 120_000 },
  );
export const getArticleContent = (
  apiKey: string,
  brandId: string,
  articleId: string,
  requestId: string,
) =>
  new AnswerBitClient(apiKey).post(
    "/geo/article/get",
    { brand_id: brandId, article_id: articleId },
    answerBitArticleContentSchema,
    requestId,
    { retries: 2, timeoutMs: 10_000 },
  );

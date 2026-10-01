import { AnswerBitClient } from "../client";
import {
  answerBitBatchPromptResultSchema,
  answerBitEmptyResultSchema,
  answerBitIdResultSchema,
  answerBitPromptGroupSchema,
  answerBitTitleListSchema,
} from "../schemas";

const client = (apiKey: string) => new AnswerBitClient(apiKey);
export const queryTitles = (
  apiKey: string,
  payload: { brand_id: string; id?: string; title_name?: string },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/title/get",
    payload,
    answerBitTitleListSchema,
    requestId,
    { retries: 2, timeoutMs: 4_500 },
  );
export const createTitle = (
  apiKey: string,
  payload: { brand_id: string; title_name: string; title_desc?: string },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/title/create",
    payload,
    answerBitIdResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
export const updateTitle = (
  apiKey: string,
  payload: {
    id: string;
    brand_id: string;
    title_name: string;
    title_desc?: string;
  },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/title/update",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
export const deleteTitle = (apiKey: string, id: string, requestId: string) =>
  client(apiKey).post(
    "/geo/title/delete",
    { id },
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
export const queryPromptGroups = (
  apiKey: string,
  payload: {
    brand_id: string;
    group_type: 1;
    begin_date?: string;
    end_date?: string;
    page: number;
    page_size: number;
    title_ids?: string[];
    tag_ids?: string[];
    platforms?: string[];
    query_str?: string;
  },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/prompt/get/group",
    payload,
    answerBitPromptGroupSchema,
    requestId,
    { retries: 2, timeoutMs: 4_500 },
  );
export const createPrompt = (
  apiKey: string,
  payload: {
    brand_id: string;
    title_id: string;
    query_str: string;
    recommend_id?: string;
  },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/prompt/create",
    payload,
    answerBitIdResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
// @project-doc docs/interfaces/answerbit_integration.md#response_validation
export const createPromptsBatch = (
  apiKey: string,
  payload: {
    brand_id: string;
    title_id: string;
    prompts: string[];
    recommend_ids?: string[];
  },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/prompt/create/batch",
    payload,
    answerBitBatchPromptResultSchema.refine(
      (result) =>
        result.prompt_ids.length === payload.prompts.length &&
        new Set(result.prompt_ids).size === payload.prompts.length &&
        result.prompt_ids.every((id) => id.trim().length > 0),
      "批量创建必须为每个问题返回唯一且非空的 ID",
    ),
    requestId,
    { timeoutMs: 20_000 },
  );
export const updatePrompt = (
  apiKey: string,
  payload: { id: string; brand_id: string; query_str?: string; status?: 1 | 2 },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/prompt/update",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
export const movePrompt = (
  apiKey: string,
  payload: { brand_id: string; title_id: string; prompt_id: string },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/prompt/relation/update",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
export const deletePrompt = (
  apiKey: string,
  payload: { id: string; brand_id: string },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/prompt/delete",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
export const deletePromptsBatch = (
  apiKey: string,
  payload: { prompt_ids: string[]; brand_id: string },
  requestId: string,
) =>
  client(apiKey).post(
    "/geo/prompt/delete/batch",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 20_000 },
  );

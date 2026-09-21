import { AnswerBitClient } from "../client";
import {
  answerBitCompetitorListSchema,
  answerBitCreateCompetitorResultSchema,
  answerBitEmptyResultSchema,
} from "../schemas";

export async function queryCompetitors(
  apiKey: string,
  brandId: string,
  requestId: string,
) {
  const rows = await new AnswerBitClient(apiKey).post(
    "/geo/competitor/get",
    { brand_id: brandId },
    answerBitCompetitorListSchema,
    requestId,
    { retries: 2, timeoutMs: 4_500 },
  );
  return rows.map((row) => ({
    id: row.competitor_id,
    name: row.competitor_name,
    alias: row.competitor_alias,
  }));
}
export function createCompetitor(
  apiKey: string,
  payload: {
    brand_id: string;
    competitor_name: string;
    competitor_alias?: string;
  },
  requestId: string,
) {
  return new AnswerBitClient(apiKey).post(
    "/geo/competitor/create",
    payload,
    answerBitCreateCompetitorResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
}
export async function updateCompetitor(
  apiKey: string,
  payload: {
    brand_id: string;
    competitor_id: string;
    competitor_name: string;
    competitor_alias: string;
  },
  requestId: string,
) {
  await new AnswerBitClient(apiKey).post(
    "/geo/competitor/update",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
}
export async function deleteCompetitor(
  apiKey: string,
  payload: { brand_id: string; competitor_id: string },
  requestId: string,
) {
  await new AnswerBitClient(apiKey).post(
    "/geo/competitor/delete",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 15_000 },
  );
}

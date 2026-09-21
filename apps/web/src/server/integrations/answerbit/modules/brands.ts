import { AnswerBitClient } from "../client";
import {
  answerBitBrandDetailSchema,
  answerBitBrandListSchema,
  answerBitCreateBrandBundleResultSchema,
  answerBitCreateBrandResultSchema,
  answerBitEmptyResultSchema,
  answerBitUpdateBrandIconResultSchema,
} from "../schemas";
export async function getBrandDetail(
  apiKey: string,
  brandId: string,
  requestId: string,
) {
  return new AnswerBitClient(apiKey).post(
    "/geo/brand/get",
    { id: brandId },
    answerBitBrandDetailSchema,
    requestId,
    { timeoutMs: 20_000 },
  );
}
export async function queryBrands(
  apiKey: string,
  teamId: string,
  requestId: string,
) {
  const client = new AnswerBitClient(apiKey);
  const brands = await client.post(
    "/geo/query/brand",
    { team_id: teamId },
    answerBitBrandListSchema,
    requestId,
    { retries: 2, timeoutMs: 4_500 },
  );
  return brands.map((brand) => ({ id: brand.id, name: brand.brand_name }));
}
export async function createBrand(
  apiKey: string,
  payload: {
    team_id: string;
    brand: string;
    alias?: string;
    website?: string;
    description?: string;
    icon_mime_type?: string;
    icon_data?: string;
    note?: string;
  },
  requestId: string,
) {
  return new AnswerBitClient(apiKey).post(
    "/geo/brand/create",
    payload,
    answerBitCreateBrandResultSchema,
    requestId,
    { timeoutMs: 20_000 },
  );
}

export type CreateBrandBundlePayload = {
  team_id: string;
  brand: {
    brand_name: string;
    alias?: string;
    website?: string;
    description?: string;
    note?: string;
    icon_mime_type?: string;
    icon_data?: string;
  };
  user_prompts: Array<{ question: string }>;
  competitors?: Array<{
    name: string;
    alias?: string;
    description?: string;
    website?: string;
  }>;
};

export async function createBrandBundle(
  apiKey: string,
  payload: CreateBrandBundlePayload,
  requestId: string,
) {
  return new AnswerBitClient(apiKey).post(
    "/geo/brand/bundle/create",
    payload,
    answerBitCreateBrandBundleResultSchema,
    requestId,
    { timeoutMs: 30_000 },
  );
}

export function buildBrandUpdatePayload(input: {
  brandId: string;
  brandName: string;
  brandAlias: string;
  website: string;
  description: string;
  note: string;
  websiteAutoTrace: boolean;
  defaultLanguage: string;
  shopKeyWords: string[];
}) {
  const brandAlias = input.brandAlias.trim();
  const website = input.website.trim();
  const description = input.description.trim();
  const note = input.note.trim();
  return {
    id: input.brandId,
    brand_name: input.brandName.trim(),
    ...(brandAlias ? { brand_alias: brandAlias } : {}),
    default_language: input.defaultLanguage,
    website: website ? [website] : [],
    ...(description ? { description } : {}),
    ...(note ? { note } : {}),
    website_auto_trace: input.websiteAutoTrace,
    ...(input.shopKeyWords.length
      ? { shop_key_words: input.shopKeyWords }
      : {}),
  };
}

export async function updateBrand(
  apiKey: string,
  payload: {
    id: string;
    brand_name: string;
    brand_alias?: string;
    default_language: string;
    website: string[];
    description?: string;
    note?: string;
    website_auto_trace: boolean;
    shop_key_words?: string[];
  },
  requestId: string,
) {
  await new AnswerBitClient(apiKey).post(
    "/geo/brand/update",
    payload,
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 20_000 },
  );
}
export async function updateBrandIcon(
  apiKey: string,
  payload: { brand_id: string; mime_type: string; data: string },
  requestId: string,
) {
  return new AnswerBitClient(apiKey).post(
    "/geo/brand/update/icon",
    payload,
    answerBitUpdateBrandIconResultSchema,
    requestId,
    { timeoutMs: 30_000 },
  );
}
export async function deleteBrand(
  apiKey: string,
  brandId: string,
  requestId: string,
) {
  await new AnswerBitClient(apiKey).post(
    "/geo/brand/delete",
    { id: brandId },
    answerBitEmptyResultSchema,
    requestId,
    { timeoutMs: 20_000 },
  );
}

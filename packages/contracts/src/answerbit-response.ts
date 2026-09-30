import { z } from "zod";

const answerBitIdSchema = z.union([z.string(), z.number()]).transform(String);

export const answerBitBrandSchema = z
  .object({
    id: answerBitIdSchema,
    brand_name: z.string(),
  })
  .passthrough();

export const answerBitBrandListSchema = z.array(answerBitBrandSchema);

const answerBitMetricSchema = z
  .object({ value: z.number(), fluctuation: z.number() })
  .passthrough();

export const answerBitDashboardMetricsSchema = z
  .object({
    exposure: answerBitMetricSchema,
    avg_rank: answerBitMetricSchema,
    score: answerBitMetricSchema,
  })
  .passthrough();

export const answerBitIdResultSchema = z.object({ id: answerBitIdSchema });

const answerBitTagSchema = z
  .object({
    tag_id: answerBitIdSchema,
    tag_name: z.string(),
    tag_type: z.number().int().optional(),
  })
  .passthrough();

export const answerBitTaskListSchema = z
  .object({
    scores: z.array(
      z
        .object({
          task_id: answerBitIdSchema,
          query_id: answerBitIdSchema,
          query_str: z.string(),
          platform: z.string(),
          language: z.string(),
          zone: z.string(),
          date: z.string(),
          exposure: z.number().int(),
          score: z.number().int(),
          avg_rank: z.number().int(),
          title_id: answerBitIdSchema,
          title_name: z.string(),
          trace_article_cnt: z.number().int().optional().default(0),
          tags: z.array(answerBitTagSchema).optional().default([]),
        })
        .passthrough(),
    ),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export const answerBitDomainRankSchema = z
  .object({
    reference_count: z.array(
      z
        .object({
          domain: z.string(),
          count: z.number().int().nonnegative(),
          is_own: z.boolean(),
        })
        .passthrough(),
    ),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export const answerBitArticleRankSchema = z
  .object({
    reference_count: z.array(
      z
        .object({
          article: z.string(),
          url: z.string(),
          domain: z.string(),
          count: z.number().int().nonnegative(),
          source: z.number().int(),
          article_id: answerBitIdSchema,
        })
        .passthrough(),
    ),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export const answerBitArticleContentSchema = z
  .object({
    article_id: answerBitIdSchema,
    brand_id: answerBitIdSchema,
    title: z.string(),
    main_body: z.string(),
    status: z.number().int(),
    template_type: z.number().int(),
    source: z.number().int(),
    language: z.string(),
    tags: z.array(
      z
        .object({
          tag_id: answerBitIdSchema,
          tag_name: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const answerBitArticleProgressSchema = z.union([
  answerBitArticleContentSchema,
  z.object({ status: z.literal(0) }).passthrough(),
]);

import { z } from "zod";
export const answerBitBrandSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    brand_name: z.string(),
  })
  .passthrough();
export const answerBitBrandListSchema = z.array(answerBitBrandSchema);
export const answerBitBrandDetailSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    brand_name: z.string(),
    alias: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    belong_team_id: z.union([z.string(), z.number()]).transform(String),
    website: z
      .union([z.array(z.string()), z.string(), z.null()])
      .transform((value) =>
        Array.isArray(value) ? value : value ? [value] : [],
      ),
    description: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    note: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    website_auto_trace: z
      .boolean()
      .nullish()
      .transform((value) => value ?? false),
    default_language: z
      .string()
      .nullish()
      .transform((value) => value?.trim() || "zh-CN"),
    shop_key_words: z
      .array(z.string())
      .nullish()
      .transform((value) => value ?? []),
  })
  .passthrough();
export const answerBitCreateBrandResultSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
});
export const answerBitCreateBrandBundleResultSchema = z
  .object({
    brand: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String),
        brand_name: z.string(),
      })
      .passthrough(),
    prompts: z
      .array(
        z
          .object({
            prompt_id: z.union([z.string(), z.number()]).transform(String),
            question: z.string(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    competitors: z
      .array(
        z
          .object({
            competitor_id: z.union([z.string(), z.number()]).transform(String),
            name: z.string(),
            alias: z.string().optional().default(""),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
  })
  .passthrough();
export const answerBitUpdateBrandIconResultSchema = z
  .object({ icon_url: z.string().min(1) })
  .passthrough();
export const answerBitEmptyResultSchema = z.object({}).passthrough();
export const answerBitCompetitorSchema = z
  .object({
    competitor_id: z.union([z.string(), z.number()]).transform(String),
    competitor_name: z.string(),
    competitor_alias: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
  })
  .passthrough();
export const answerBitCompetitorListSchema = z.array(answerBitCompetitorSchema);
export const answerBitCreateCompetitorResultSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
});

const valueWithFluctuationSchema = z
  .object({ value: z.number(), fluctuation: z.number() })
  .passthrough();
const answerBitNonnegativeIntegerSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .refine(Number.isSafeInteger, "AnswerBit 整数超出安全范围");
export const answerBitDashboardMetricsSchema = z
  .object({
    exposure: valueWithFluctuationSchema,
    avg_rank: valueWithFluctuationSchema,
    score: valueWithFluctuationSchema,
  })
  .passthrough();
const exposurePointSchema = z
  .object({
    date: z.string(),
    exposure: z.number(),
    avg_rank: z.number(),
    task_count: answerBitNonnegativeIntegerSchema,
    name: z.string().optional(),
  })
  .passthrough();
const scorePointSchema = z
  .object({
    date: z.string(),
    score: z.number(),
    task_count: answerBitNonnegativeIntegerSchema,
    name: z.string().optional(),
  })
  .passthrough();
export const answerBitExposureTrendsSchema = z
  .object({
    brand_statistics: z.array(exposurePointSchema),
    competitor_statistics: z.array(
      z
        .object({
          competitor_id: z.union([z.string(), z.number()]).transform(String),
          name: z.string(),
          statistics: z.array(exposurePointSchema.omit({ name: true })),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const answerBitScoreTrendsSchema = z
  .object({
    brand_statistics: z.array(scorePointSchema),
    competitor_statistics: z.array(
      z
        .object({
          competitor_id: z.union([z.string(), z.number()]).transform(String),
          name: z.string(),
          statistics: z.array(scorePointSchema.omit({ name: true })),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const answerBitExposureRankSchema = z.array(
  z
    .object({
      competitor_id: z.union([z.string(), z.number()]).transform(String),
      competitor_name: z.string(),
      exposure: z.number(),
      fluctuation: z.number(),
      avg_rank: valueWithFluctuationSchema,
    })
    .passthrough(),
);
export const answerBitScoreRankSchema = z.array(
  z
    .object({
      competitor_id: z.union([z.string(), z.number()]).transform(String),
      competitor_name: z.string(),
      score: z.number(),
      fluctuation: z.number(),
    })
    .passthrough(),
);
export const answerBitPlatformMapSchema = z.record(z.string(), z.string());
export const answerBitIdResultSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
});
export const answerBitTitleSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    brand_id: z.union([z.string(), z.number()]).transform(String),
    title_name: z.string(),
    title_desc: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    count: z.number().int().optional().default(0),
    created_time: z.string().optional(),
    updated_time: z.string().optional(),
  })
  .passthrough();
export const answerBitTitleListSchema = z.array(answerBitTitleSchema);
const dailyScoreSchema = z
  .object({
    date: z.string(),
    score: z.number().optional(),
    avg_score: z.number().optional(),
  })
  .passthrough()
  .refine(
    (value) => value.score !== undefined || value.avg_score !== undefined,
    "AnswerBit 每日得分缺少 score 或 avg_score",
  )
  .transform(({ avg_score, ...value }) => ({
    ...value,
    score: value.score ?? avg_score!,
  }));
const tagSchema = z
  .object({
    tag_id: z.union([z.string(), z.number()]).transform(String),
    tag_name: z.string(),
    tag_type: z.number().int().optional(),
  })
  .passthrough();
export const answerBitPromptSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    query_str: z.string(),
    status: z.number().int(),
    exposure: z.number(),
    avg_rank: z.number(),
    daily_avg_score: z.array(dailyScoreSchema),
    title_id: z.union([z.string(), z.number()]).transform(String),
    title_name: z.string(),
    creator_name: z.string().optional().default(""),
    created_time: z
      .union([z.string().min(1), z.number().int().nonnegative()])
      .transform(String)
      .optional()
      .default(""),
    fluctuation: z.number().optional().default(0),
    trace_article_cnt: z.number().int().optional().default(0),
    tags: z.array(tagSchema).optional().default([]),
  })
  .passthrough();
export const answerBitPromptGroupSchema = z
  .object({
    titles: z.array(
      z
        .object({
          title_id: z.union([z.string(), z.number()]).transform(String),
          title_name: z.string(),
          title_desc: z
            .string()
            .nullish()
            .transform((value) => value ?? ""),
          prompt_count: z.number().int(),
          exposure: z.number(),
          fluctuation: z.number(),
          avg_rank: z.number(),
          daily_avg_score: z.array(dailyScoreSchema),
          prompts: z.array(answerBitPromptSchema),
        })
        .passthrough(),
    ),
    total: z.number().int(),
    total_prompts: z.number().int(),
  })
  .passthrough();
export const answerBitBatchPromptResultSchema = z.object({
  prompt_ids: z.array(z.union([z.string(), z.number()]).transform(String)),
});
export const answerBitArticleTagsSchema = z.array(
  z
    .object({
      tag_id: z.union([z.string(), z.number()]).transform(String),
      team_id: z.union([z.string(), z.number()]).transform(String),
      name: z.string(),
      note: z
        .string()
        .nullish()
        .transform((value) => value ?? ""),
      tag_type: z.number().int(),
      status: z.number().int(),
      created_by: z.string().optional().default(""),
      article_count: z.number().int().optional().default(0),
      created_time: z.number().int().optional().default(0),
    })
    .passthrough(),
);
export const answerBitTaskListSchema = z
  .object({
    scores: z.array(
      z
        .object({
          task_id: z.union([z.string(), z.number()]).transform(String),
          query_id: z.union([z.string(), z.number()]).transform(String),
          query_str: z.string(),
          platform: z.string(),
          language: z.string(),
          zone: z.string(),
          date: z.string(),
          exposure: z.number().int(),
          score: z.number().int(),
          avg_rank: z.number().int(),
          title_id: z.union([z.string(), z.number()]).transform(String),
          title_name: z.string(),
          trace_article_cnt: z.number().int().optional().default(0),
          tags: z.array(tagSchema).optional().default([]),
        })
        .passthrough(),
    ),
    total: z.number().int(),
  })
  .passthrough();
const taskLinkSchema = z
  .object({
    index: z.number().int(),
    url: z.string(),
    title: z.string(),
    source: z.number().int(),
    article_id: z.union([z.string(), z.number()]).transform(String),
  })
  .passthrough();
export const answerBitTaskDetailSchema = z
  .object({
    query: z.string(),
    query_id: z.union([z.string(), z.number()]).transform(String),
    score: z.number().int(),
    zone: z.string(),
    language: z.string(),
    exposure: z.number().int(),
    rank: z.number().int(),
    exposure_cnt: z.number().int(),
    llm_output: z.string(),
    platform: z.string(),
    date: z.string(),
    links: z.array(taskLinkSchema),
    pic: z.array(z.string()).optional().default([]),
    fanout: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    recommend_queries: z.array(z.string()).optional().default([]),
    video_cards: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .default([]),
    product_cards: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .default([]),
    title_name: z.string(),
    title_id: z.union([z.string(), z.number()]).transform(String),
    tags: z.array(tagSchema).optional().default([]),
  })
  .passthrough();
export const answerBitDomainRankSchema = z
  .object({
    reference_count: z.array(
      z
        .object({
          domain: z.string(),
          count: z.number().int(),
          is_own: z.boolean(),
        })
        .passthrough(),
    ),
    total: z.number().int(),
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
          count: z.number().int(),
          source: z.number().int(),
          article_id: z.union([z.string(), z.number()]).transform(String),
        })
        .passthrough(),
    ),
    total: z.number().int(),
  })
  .passthrough();
export const answerBitPromptTrendsSchema = z
  .object({
    prompt_count: z.number().int(),
    fluctuation: z.number().int(),
    prompt_trends: z.array(
      z
        .object({ date: z.string(), prompt_count: z.number().int() })
        .passthrough(),
    ),
  })
  .passthrough();
const titleMetricSchema = (key: "exposure" | "avg_rank" | "score") =>
  z
    .object({
      title_id: z.union([z.string(), z.number()]).transform(String),
      title_name: z.string(),
      [key]: z.number(),
      fluctuation: z.number(),
    })
    .passthrough();
export const answerBitTitleRankSchema = z
  .object({
    exposure: z.array(titleMetricSchema("exposure")),
    avg_rank: z.array(titleMetricSchema("avg_rank")),
    score: z.array(titleMetricSchema("score")),
  })
  .passthrough();
const referenceTrendSchema = z
  .object({ date: z.string(), count: answerBitNonnegativeIntegerSchema })
  .passthrough();
export const answerBitTraceArticleResultSchema = z
  .union([z.string(), z.number()])
  .transform(String);
export const answerBitArticleListSchema = z
  .object({
    list: z.array(
      z
        .object({
          id: z.union([z.string(), z.number()]).transform(String),
          brand_id: z.union([z.string(), z.number()]).transform(String),
          title: z.string(),
          status: z.number().int(),
          source: z.number().int(),
          template_type: z.number().int(),
          ref_count: answerBitNonnegativeIntegerSchema,
          fluctuation: z.number(),
          ref_trends: z.array(referenceTrendSchema),
          published_platforms: z.array(
            z
              .object({
                platform: z.string(),
                display_name: z.string(),
                icon_url: z.string(),
                publish_url: z.string(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
    scroll_id: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    total: answerBitNonnegativeIntegerSchema,
    total_links: answerBitNonnegativeIntegerSchema,
  })
  .passthrough();
const referenceCountsSchema = z.record(z.string(), z.number().int());
export const answerBitArticleTraceDetailSchema = z
  .object({
    trace_info: z.array(
      z
        .object({
          trace_id: z.union([z.string(), z.number()]).transform(String),
          article_id: z.union([z.string(), z.number()]).transform(String),
          url: z.string(),
          platform: z.string(),
          icon: z.string(),
          title: z.string(),
          can_edit: z.boolean(),
          stats: z
            .object({
              ref_count: referenceCountsSchema,
              total_count: z.number().int(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
    stats: z
      .object({
        ref_count: referenceCountsSchema,
        total_count: z.number().int(),
        ref_count_increase: z.number().int(),
        ref_trends: z.array(
          z
            .object({
              platform: z.string(),
              ref_trends: z.array(
                z
                  .object({
                    date: z.string(),
                    ref_count: z.number().int(),
                    prompts: z.array(
                      z
                        .object({
                          prompt_id: z
                            .union([z.string(), z.number()])
                            .transform(String),
                          prompt_content: z.string(),
                          title_name: z.string(),
                          ref_count: z.number().int(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();
export const answerBitArticleTemplateSchema = z.array(
  z
    .object({
      template_id: z.number().int(),
      template_name: z.string(),
      description: z.string(),
      is_high_ref: z.number().int(),
    })
    .passthrough(),
);
export const answerBitArticleContentSchema = z
  .object({
    article_id: z.union([z.string(), z.number()]).transform(String),
    brand_id: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    main_body: z.string(),
    status: z.number().int(),
    template_type: z.number().int(),
    source: z.number().int(),
    language: z.string(),
    tags: z.array(
      z
        .object({
          tag_id: z.union([z.string(), z.number()]).transform(String),
          tag_name: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const answerBitUnixSecondsSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .refine(Number.isSafeInteger, "AnswerBit Unix 时间戳超出安全整数范围");
const quotaSummarySchema = z
  .object({
    quota_type: z.string(),
    total_amount: z.number().int(),
    used_amount: z.number().int(),
    reset_time: answerBitUnixSecondsSchema,
  })
  .passthrough();
export const answerBitBillingUsageSchema = z
  .object({
    plan: z
      .object({
        valid_from: answerBitUnixSecondsSchema,
        valid_until: answerBitUnixSecondsSchema,
        quotas: z.array(quotaSummarySchema),
      })
      .passthrough(),
    credit: z
      .object({
        team_id: z.union([z.string(), z.number()]).transform(String),
        total_amount: z.number().int(),
        used_amount: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();
export const answerBitSubscriptionSchema = z
  .object({
    plan_id: z.union([z.string(), z.number()]).transform(String),
    plan_name: z.string(),
    tier: z.string(),
    status: z.number().int(),
    started_at: answerBitUnixSecondsSchema,
    expired_at: answerBitUnixSecondsSchema,
    billing_period: z.number().int(),
    billing_amount: z.number().int(),
    current_cycle_start: answerBitUnixSecondsSchema,
    current_cycle_end: answerBitUnixSecondsSchema,
    is_trial: z.boolean(),
  })
  .passthrough();
export const answerBitCreditStatusSchema = z
  .object({
    team_id: z.union([z.string(), z.number()]).transform(String),
    total_amount: z.number().int(),
    used_amount: z.number().int(),
    credit_details: z.array(
      z
        .object({
          credit_id: z.union([z.string(), z.number()]).transform(String),
          source_type: z.number().int(),
          total_amount: z.number().int(),
          used_amount: z.number().int(),
          expire_time: answerBitUnixSecondsSchema,
          status: z.number().int(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const answerBitCreditUsageSchema = z
  .object({
    period_start: answerBitUnixSecondsSchema,
    period_end: answerBitUnixSecondsSchema,
    total_credit_used: z.number().int(),
    total_quota_amount: z.number().int(),
    usages: z.array(
      z
        .object({
          quota_type: z.string(),
          quota_amount: z.number().int(),
          credit_used: z.number().int(),
          percent: z.number(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const answerBitCreditTrendSchema = z
  .object({
    period_start: answerBitUnixSecondsSchema,
    period_end: answerBitUnixSecondsSchema,
    trends: z.array(
      z
        .object({
          date: z.string(),
          quota_type: z.string(),
          quota_amount: z.number().int(),
          credit_used: z.number().int(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const answerBitCreditRankSchema = z.array(
  z
    .object({
      brand_id: z.union([z.string(), z.number()]).transform(String),
      brand_name: z.string(),
      credit_used: z.number().int(),
    })
    .passthrough(),
);
export const answerBitCreditBillsSchema = z
  .object({
    bills: z.array(
      z
        .object({
          bill_id: z.union([z.string(), z.number()]).transform(String),
          team_id: z.union([z.string(), z.number()]).transform(String),
          bill_type: z.string(),
          credit_change: z.number().int(),
          is_pending: z.boolean(),
          created_time: answerBitUnixSecondsSchema,
          operator_name: z.string(),
          brand_name: z.string(),
        })
        .passthrough(),
    ),
    total: z.number().int(),
  })
  .passthrough();
export const answerBitBillingLogsSchema = z
  .object({
    list: z.array(
      z
        .object({
          log_id: z.union([z.string(), z.number()]).transform(String),
          action: z.string(),
          action_text: z.string(),
          message: z.string(),
          operator_name: z.string(),
          created_at: answerBitUnixSecondsSchema,
        })
        .passthrough(),
    ),
    total: z.number().int(),
  })
  .passthrough();
export const answerBitQuotaOverridesSchema = z
  .object({
    list: z.array(
      z
        .object({
          quota_type: z.string(),
          quota_limit: z.number().int(),
          reason: z.string(),
          created_at: answerBitUnixSecondsSchema,
          is_effective: z.boolean(),
        })
        .passthrough(),
    ),
    total: z.number().int(),
  })
  .passthrough();

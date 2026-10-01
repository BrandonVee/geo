import { isHttpOrigin } from "@geo/core/http-origin";
import { z } from "zod";
export * from "./answerbit-response";
export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,64}$/),
});
export type CreateOrganizationInput = z.infer<typeof organizationSchema>;
export const organizationQuerySchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
export const teamBindingActionSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
export const memberRoleSchema = z.enum([
  "tenant_admin",
  "brand_admin",
  "brand_editor",
  "brand_viewer",
]);
const memberUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{2,31}$/,
    "账号需以字母开头，只能包含小写字母、数字和下划线",
  );
export const addOrganizationMemberSchema = z.union([
  z
    .object({
      username: memberUsernameSchema,
      role: memberRoleSchema,
    })
    .strict(),
  z
    .object({
      name: z.string().trim().min(2).max(80),
      username: memberUsernameSchema,
      password: z
        .string()
        .min(12, "密码至少 12 位")
        .max(128, "密码最多 128 位")
        .refine(
          (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
          "密码必须同时包含字母和数字",
        ),
      role: z.enum(["brand_admin", "brand_editor", "brand_viewer"]),
    })
    .strict(),
]);
export const updateMemberSchema = z
  .object({ status: z.enum(["active", "disabled"]) })
  .strict();
export const createBrandAccessSchema = z
  .object({
    role: z.enum(["brand_admin", "brand_editor", "brand_viewer"]),
  })
  .strict();
export type AddOrganizationMemberInput = z.infer<
  typeof addOrganizationMemberSchema
>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateBrandAccessInput = z.infer<typeof createBrandAccessSchema>;
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().default("");
const answerBitBrandIconMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
const answerBitBrandIconMaxBytes = 2 * 1024 * 1024;
const answerBitBrandIconBase64Schema = z
  .string()
  .min(1)
  .max(2_796_204)
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    "iconData 必须是有效的 Base64",
  )
  .refine((value) => {
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return (value.length * 3) / 4 - padding <= answerBitBrandIconMaxBytes;
  }, "Logo 原始文件不能超过 2MB");
const answerBitBrandCreateFields = {
  brand: z.string().trim().min(1).max(255),
  alias: optionalText(255),
  website: z
    .union([z.literal(""), z.string().url()])
    .optional()
    .default(""),
  description: optionalText(5000),
  note: optionalText(2000),
  iconMimeType: answerBitBrandIconMimeTypeSchema.optional(),
  iconData: answerBitBrandIconBase64Schema.optional(),
};
const validateAnswerBitBrandIcon = (
  value: { iconData?: string; iconMimeType?: string },
  context: z.RefinementCtx,
) => {
  if (Boolean(value.iconData) !== Boolean(value.iconMimeType))
    context.addIssue({
      code: "custom",
      message: "iconData 与 iconMimeType 必须同时提供",
      path: ["iconData"],
    });
};
export const brandListQuerySchema = z.object({
  organizationId: z.string().uuid(),
  teamBindingId: z.string().uuid(),
});
export const createBrandSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    ...answerBitBrandCreateFields,
  })
  .strict()
  .superRefine(validateAnswerBitBrandIcon);
export const adminCreateAnswerBitBrandSchema = z
  .object({
    ...answerBitBrandCreateFields,
    initialPrompts: z
      .array(z.string().trim().min(1).max(2000))
      .optional()
      .default([]),
    competitors: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(255),
            alias: optionalText(255),
            description: optionalText(5000),
            website: z
              .union([z.literal(""), z.string().url()])
              .optional()
              .default(""),
          })
          .strict(),
      )
      .optional()
      .default([]),
  })
  .strict()
  .superRefine(validateAnswerBitBrandIcon);
export const adminUpdateAnswerBitBrandIconSchema = z
  .object({
    iconMimeType: answerBitBrandIconMimeTypeSchema,
    iconData: answerBitBrandIconBase64Schema,
  })
  .strict();
export const adminUpdateAnswerBitBrandSchema = z
  .object({
    brandName: z.string().trim().min(1).max(255),
    brandAlias: z.string().trim().max(255).default(""),
    website: z.union([z.literal(""), z.string().url()]).default(""),
    description: z.string().max(5000).default(""),
    note: z.string().max(2000).default(""),
    websiteAutoTrace: z.boolean().default(false),
  })
  .strict();
export const updateBrandSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandName: z.string().trim().min(1).max(255),
    brandAlias: z.string().trim().max(255),
    website: z.union([z.literal(""), z.string().url()]),
    description: z.string().max(5000),
    note: z.string().max(2000),
    websiteAutoTrace: z.boolean(),
  })
  .strict();
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type AdminCreateAnswerBitBrandInput = z.infer<
  typeof adminCreateAnswerBitBrandSchema
>;
export type AdminUpdateAnswerBitBrandInput = z.infer<
  typeof adminUpdateAnswerBitBrandSchema
>;
export type AdminUpdateAnswerBitBrandIconInput = z.infer<
  typeof adminUpdateAnswerBitBrandIconSchema
>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
export const competitorListQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
  })
  .strict();
export const createCompetitorSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
    competitorName: z.string().trim().min(1).max(255),
    competitorAlias: z.string().trim().max(255).optional().default(""),
  })
  .strict();
export const updateCompetitorSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
    competitorName: z.string().trim().min(1).max(255),
    competitorAlias: z.string().trim().max(255),
  })
  .strict();
export type CreateCompetitorInput = z.infer<typeof createCompetitorSchema>;
export type UpdateCompetitorInput = z.infer<typeof updateCompetitorSchema>;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD")
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "日期无效",
  );
const csvListSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : value,
  z.array(z.string().min(1).max(128)).max(100).optional().default([]),
);
const dashboardQueryShape = {
  organizationId: z.string().uuid(),
  teamBindingId: z.string().uuid(),
  brandId: z.string().trim().min(1).max(128),
  beginDate: dateSchema,
  endDate: dateSchema,
  titleIds: csvListSchema,
  platforms: csvListSchema,
  tagIds: csvListSchema,
};
export const dashboardQuerySchema = z
  .object({ ...dashboardQueryShape, competitorIds: csvListSchema })
  .strict()
  .refine((value) => value.beginDate <= value.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["beginDate"],
  });
export const dashboardBaseQuerySchema = z
  .object(dashboardQueryShape)
  .strict()
  .refine((value) => value.beginDate <= value.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["beginDate"],
  });
export const platformListQuerySchema = competitorListQuerySchema.omit({
  brandId: true,
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardBaseQuery = z.infer<typeof dashboardBaseQuerySchema>;
const brandScopeShape = {
  organizationId: z.string().uuid(),
  teamBindingId: z.string().uuid(),
  brandId: z.string().trim().min(1).max(128),
};
const idListSchema = z.array(z.string().trim().min(1).max(128)).min(1).max(100);
const queryInteger = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : Number(value)),
    z.number().int().min(min).max(max),
  );
export const categoryListQuerySchema = z
  .object({
    ...brandScopeShape,
    id: z.string().trim().max(128).optional(),
    titleName: z.string().trim().max(255).optional(),
  })
  .strict();
export const createCategorySchema = z
  .object({
    ...brandScopeShape,
    titleName: z.string().trim().min(1).max(255),
    titleDescription: z.string().trim().max(2000).optional().default(""),
  })
  .strict();
export const updateCategorySchema = z
  .object({
    ...brandScopeShape,
    titleName: z.string().trim().min(1).max(255),
    titleDescription: z.string().trim().max(2000).optional(),
  })
  .strict();
export const createPromptSchema = z
  .object({
    ...brandScopeShape,
    titleId: z.string().trim().min(1).max(128),
    query: z.string().trim().min(1).max(2000),
    recommendId: z.string().trim().max(128).optional(),
  })
  .strict();
export const createPromptsBatchSchema = z
  .object({
    ...brandScopeShape,
    titleId: z.string().trim().min(1).max(128),
    prompts: z.array(z.string().trim().min(1).max(2000)).min(1).max(100),
    recommendIds: z.array(z.string().trim().max(128)).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.recommendIds &&
      value.recommendIds.length !== value.prompts.length
    )
      context.addIssue({
        code: "custom",
        message: "recommendIds 必须与 prompts 一一对应",
        path: ["recommendIds"],
      });
  });
export const updatePromptSchema = z
  .object({
    ...brandScopeShape,
    query: z.string().trim().min(1).max(2000).optional(),
    status: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .strict()
  .refine(
    (value) => value.query !== undefined || value.status !== undefined,
    "至少提供 query 或 status",
  );
export const movePromptSchema = z
  .object({ ...brandScopeShape, titleId: z.string().trim().min(1).max(128) })
  .strict();
export const brandResourceQuerySchema = z.object(brandScopeShape).strict();
export const deletePromptsBatchSchema = z
  .object({ ...brandScopeShape, promptIds: idListSchema })
  .strict();
export const promptListQuerySchema = z
  .object({
    ...brandScopeShape,
    purpose: z.enum(["content"]).optional(),
    beginDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(20, 1, 100),
    titleIds: csvListSchema,
    tagIds: csvListSchema,
    platforms: csvListSchema,
    query: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.beginDate) !== Boolean(value.endDate))
      context.addIssue({
        code: "custom",
        message: "beginDate 和 endDate 必须同时提供",
        path: ["beginDate"],
      });
    if (value.beginDate && value.endDate && value.beginDate > value.endDate)
      context.addIssue({
        code: "custom",
        message: "开始日期不能晚于结束日期",
        path: ["beginDate"],
      });
  });
export const taskListQuerySchema = z
  .object({
    ...brandScopeShape,
    beginDate: dateSchema,
    endDate: dateSchema,
    include: queryInteger(1, 0, 1),
    prompt: z.string().trim().max(500).optional(),
    titleIds: csvListSchema,
    promptIds: csvListSchema,
    tagIds: csvListSchema,
    taskIds: csvListSchema,
    platforms: csvListSchema,
    languages: csvListSchema,
    mentionBrand: queryInteger(-1, -1, 1),
    minScore: queryInteger(0, 0, 100),
    maxScore: queryInteger(100, 0, 100),
    url: z.string().trim().max(2000).optional(),
    refPlatform: z.string().trim().max(255).optional(),
    articleId: z.string().trim().max(128).optional(),
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(20, 1, 100),
  })
  .strict()
  .refine((value) => value.beginDate <= value.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["beginDate"],
  })
  .refine((value) => value.minScore <= value.maxScore, {
    message: "最低分不能高于最高分",
    path: ["minScore"],
  });
export const citationRankQuerySchema = z
  .object({
    ...brandScopeShape,
    beginDate: dateSchema,
    endDate: dateSchema,
    titleIds: csvListSchema,
    promptIds: csvListSchema,
    platforms: csvListSchema,
    tagIds: csvListSchema,
    keyword: z.string().trim().max(500).optional(),
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(20, 1, 100),
  })
  .strict()
  .refine((value) => value.beginDate <= value.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["beginDate"],
  });
export const tagListQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    tagType: z.preprocess(
      (value) =>
        value === undefined || value === "" ? undefined : Number(value),
      z.union([z.literal(1), z.literal(2)]).optional(),
    ),
  })
  .strict();
export const articleLanguageSchema = z.enum([
  "zh-CN",
  "zh-SG",
  "zh-TW",
  "zh-HK",
  "zh-MO",
  "en-US",
  "en-GB",
  "ja-JP",
  "ko-KR",
  "fr-FR",
  "de-DE",
  "es-ES",
  "pt-BR",
  "pt-PT",
  "it-IT",
  "th-TH",
  "vi-VN",
  "id-ID",
  "ar-SA",
  "ru-RU",
  "ms-MY",
]);
const integerCsvSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value.split(",").filter(Boolean).map(Number)
      : value,
  z.array(z.number().int()).max(100).optional().default([]),
);
const optionalQueryInteger = z.preprocess(
  (value) => (value === undefined || value === "" ? undefined : Number(value)),
  z.number().int().nonnegative().optional(),
);
const optionalQueryBoolean = z.preprocess(
  (value) =>
    value === undefined || value === ""
      ? undefined
      : value === "true"
        ? true
        : value === "false"
          ? false
          : value,
  z.boolean().optional(),
);
export const traceArticleSchema = z
  .object({
    ...brandScopeShape,
    expectedPoints: z.number().int().nonnegative().max(11_000_000),
    title: z.string().trim().min(1).max(500),
    urls: z
      .array(
        z
          .string()
          .trim()
          .url()
          .max(2000)
          .regex(/^https?:\/\//i, "请输入 http:// 或 https:// 公开文章链接"),
      )
      .min(1)
      .max(20),
    tagIds: z
      .array(z.string().trim().min(1).max(128))
      .max(50)
      .optional()
      .default([]),
    language: articleLanguageSchema.optional().default("zh-CN"),
  })
  .strict();
export const articleTrackingQuerySchema = z.object(brandScopeShape).strict();
export const articleListQuerySchema = z
  .object({
    ...brandScopeShape,
    limit: queryInteger(20, 1, 100),
    scrollId: z.string().trim().max(512).optional(),
    startTime: optionalQueryInteger,
    endTime: optionalQueryInteger,
    title: z.string().trim().max(500).optional(),
    statuses: integerCsvSchema,
    sources: integerCsvSchema,
    templateTypes: integerCsvSchema,
    tagIds: csvListSchema,
    refOrderType: z.preprocess(
      (value) =>
        value === undefined || value === "" ? undefined : Number(value),
      z.union([z.literal(1), z.literal(2)]).optional(),
    ),
    languages: z.preprocess(
      (value) =>
        typeof value === "string" ? value.split(",").filter(Boolean) : value,
      z.array(articleLanguageSchema).max(30).optional().default([]),
    ),
    hasVideo: optionalQueryBoolean,
    hasVideoGenerating: optionalQueryBoolean,
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.startTime) !== Boolean(value.endTime))
      context.addIssue({
        code: "custom",
        message: "startTime 和 endTime 必须同时提供",
        path: ["startTime"],
      });
    if (value.startTime && value.endTime && value.startTime > value.endTime)
      context.addIssue({
        code: "custom",
        message: "开始时间不能晚于结束时间",
        path: ["startTime"],
      });
  });
export const articleDetailQuerySchema = z
  .object({
    ...brandScopeShape,
    beginDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.beginDate) !== Boolean(value.endDate))
      context.addIssue({
        code: "custom",
        message: "beginDate 和 endDate 必须同时提供",
        path: ["beginDate"],
      });
    if (value.beginDate && value.endDate && value.beginDate > value.endDate)
      context.addIssue({
        code: "custom",
        message: "开始日期不能晚于结束日期",
        path: ["beginDate"],
      });
  });
export const articleTemplateQuerySchema = z
  .object({
    ...brandScopeShape,
    localCode: articleLanguageSchema.optional().default("zh-CN"),
  })
  .strict();
const highReferenceSchema = z
  .object({
    url: z.string().url().max(2000).optional(),
    title: z.string().trim().max(500).optional(),
    content: z.string().trim().max(50000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const valid = Boolean(value.url) || Boolean(value.title && value.content);
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "高引用模板需提供 URL 或标题与正文",
        path: ["url"],
      });
  });
export const createArticleJobSchema = z
  .object({
    ...brandScopeShape,
    expectedPoints: z.number().int().nonnegative().max(11_000_000),
    templateType: z.number().int().positive(),
    promptIds: idListSchema.max(20),
    knowledgeIds: z
      .array(z.string().trim().min(1).max(128))
      .max(20)
      .optional()
      .default([]),
    supplementalKnowledge: z.string().trim().max(50000).optional(),
    highReference: highReferenceSchema.optional(),
    tagIds: z
      .array(z.string().trim().min(1).max(128))
      .max(50)
      .optional()
      .default([]),
    contentTags: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .refine(
        (tags) =>
          new Set(tags.map((tag) => tag.toLocaleLowerCase())).size ===
          tags.length,
        "内容标签不能重复",
      )
      .optional()
      .default([]),
    language: articleLanguageSchema.optional().default("zh-CN"),
  })
  .strict();
export const answerBitArticleCreatePayloadSchema = z
  .object({
    brand_id: brandScopeShape.brandId,
    template_type: z.number().int().positive(),
    prompt_ids: idListSchema.max(20),
    knowledge_ids: z
      .array(z.string().trim().min(1).max(128))
      .max(20)
      .optional()
      .default([]),
    once_knowledge: z.string().trim().max(50000).optional(),
    high_ref: highReferenceSchema.optional(),
    tag_ids: z
      .array(z.string().trim().min(1).max(128))
      .max(50)
      .optional()
      .default([]),
    language: articleLanguageSchema,
  })
  .strict();
export const articleJobListQuerySchema = z
  .object({ ...brandScopeShape, limit: queryInteger(20, 1, 100) })
  .strict();
export const contentDocumentStatusSchema = z.enum([
  "draft",
  "ready",
  "archived",
]);
export const contentDocumentSourceSchema = z.enum([
  "manual",
  "imported",
  "ai_generated",
]);
const contentDocumentTagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .refine(
    (tags) =>
      new Set(tags.map((tag) => tag.toLocaleLowerCase())).size === tags.length,
    "内容标签不能重复",
  );
export const contentDocumentListQuerySchema = z
  .object({
    ...brandScopeShape,
    q: z.string().trim().max(200).optional(),
    folderId: z.string().uuid().optional(),
    unfiled: optionalQueryBoolean.default(false),
    status: contentDocumentStatusSchema.optional(),
    source: contentDocumentSourceSchema.optional(),
    limit: queryInteger(50, 1, 100),
    offset: queryInteger(0, 0, 100_000),
  })
  .strict()
  .refine((value) => !(value.folderId && value.unfiled), {
    message: "folderId 与 unfiled 不能同时使用",
    path: ["folderId"],
  });
export const createContentDocumentSchema = z
  .object({
    ...brandScopeShape,
    title: z.string().trim().min(1).max(500),
    body: z.string().max(500_000).default(""),
    status: contentDocumentStatusSchema.exclude(["archived"]).default("draft"),
    source: z.enum(["manual", "imported"]).default("manual"),
    sourceUrl: z.string().url().max(2000).optional(),
    folderId: z.string().uuid().nullable().optional(),
    language: articleLanguageSchema.default("zh-CN"),
    tags: contentDocumentTagsSchema.default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === "imported" && !value.sourceUrl)
      context.addIssue({
        code: "custom",
        message: "导入文章需要填写来源链接",
        path: ["sourceUrl"],
      });
    if (value.status === "ready" && !value.body.trim())
      context.addIssue({
        code: "custom",
        message: "定稿文档必须包含正文",
        path: ["body"],
      });
  });
export const updateContentDocumentSchema = z
  .object({
    ...brandScopeShape,
    expectedVersion: z.number().int().positive().max(2_147_483_647),
    title: z.string().trim().min(1).max(500).optional(),
    body: z.string().max(500_000).optional(),
    status: contentDocumentStatusSchema.optional(),
    sourceUrl: z.string().url().max(2000).nullable().optional(),
    folderId: z.string().uuid().nullable().optional(),
    language: articleLanguageSchema.optional(),
    tags: contentDocumentTagsSchema.optional(),
    changeSummary: z.string().trim().max(500).default(""),
  })
  .strict()
  .refine(
    (value) =>
      [
        value.title,
        value.body,
        value.status,
        value.sourceUrl,
        value.folderId,
        value.language,
        value.tags,
      ].some((item) => item !== undefined),
    "至少提交一个需要修改的字段",
  );
export const contentFolderListQuerySchema = z
  .object({ ...brandScopeShape })
  .strict();
export const createContentFolderSchema = z
  .object({
    ...brandScopeShape,
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export const updateContentFolderSchema = createContentFolderSchema;
export const restoreContentDocumentVersionSchema = z
  .object({
    ...brandScopeShape,
    expectedVersion: z.number().int().positive().max(2_147_483_647),
    changeSummary: z.string().trim().max(500).default("恢复历史版本"),
  })
  .strict();
export const archiveContentDocumentQuerySchema = z
  .object({
    ...brandScopeShape,
    expectedVersion: z.coerce.number().int().positive().max(2_147_483_647),
  })
  .strict();
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const meteringScopeShape = {
  organizationId: z.string().uuid(),
  teamBindingId: z.string().uuid(),
  brandId: z.string().trim().min(1).max(128).optional(),
};
export const meteringScopeQuerySchema = z.object(meteringScopeShape).strict();
export const meteringPeriodQuerySchema = z
  .object({
    ...meteringScopeShape,
    startUnix: optionalQueryInteger,
    endUnix: optionalQueryInteger,
    quotaTypes: csvListSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.startUnix !== undefined) !== (value.endUnix !== undefined))
      context.addIssue({
        code: "custom",
        message: "startUnix 和 endUnix 必须同时提供",
        path: ["startUnix"],
      });
    if (
      value.startUnix !== undefined &&
      value.endUnix !== undefined &&
      value.startUnix > value.endUnix
    )
      context.addIssue({
        code: "custom",
        message: "开始时间不能晚于结束时间",
        path: ["startUnix"],
      });
  });
export const meteringPageQuerySchema = z
  .object({
    ...meteringScopeShape,
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(20, 1, 100),
    keyword: z.string().trim().max(200).optional(),
    startTime: optionalQueryInteger,
    endTime: optionalQueryInteger,
    status: z.preprocess(
      (value) =>
        value === undefined || value === "" ? undefined : Number(value),
      z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.startTime !== undefined) !== (value.endTime !== undefined))
      context.addIssue({
        code: "custom",
        message: "startTime 和 endTime 必须同时提供",
        path: ["startTime"],
      });
    if (
      value.startTime !== undefined &&
      value.endTime !== undefined &&
      value.startTime > value.endTime
    )
      context.addIssue({
        code: "custom",
        message: "开始时间不能晚于结束时间",
        path: ["startTime"],
      });
  });
export const purchaseAnswerBitQuotaSchema = z
  .object({
    ...meteringScopeShape,
    quotaType: z.literal("max_brand"),
    quotaAmount: z.number().int().min(1).max(9999),
  })
  .strict();
export const adminPageQuerySchema = z
  .object({
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(20, 1, 100),
    q: z.string().trim().max(200).optional(),
    status: z.string().trim().max(32).optional(),
  })
  .strict();
export const adminUserPageQuerySchema = adminPageQuerySchema
  .extend({ accountType: z.enum(["admin", "agent", "customer"]).optional() })
  .strict();
export const pricingTierSchema = z.enum(["retail", "bronze", "silver", "gold"]);
export const adminUpdateOrganizationSchema = z
  .object({
    status: z.enum(["active", "suspended"]).optional(),
    serviceExpiresAt: z.string().datetime({ offset: true }).optional(),
    pointsExpiresAt: z.string().datetime({ offset: true }).optional(),
    expected: z
      .object({
        status: z.enum(["active", "suspended"]).optional(),
        serviceExpiresAt: z
          .string()
          .datetime({ offset: true })
          .nullable()
          .optional(),
        pointsExpiresAt: z
          .string()
          .datetime({ offset: true })
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const fields = ["status", "serviceExpiresAt", "pointsExpiresAt"] as const;
    if (!fields.some((field) => value[field] !== undefined))
      context.addIssue({ code: "custom", message: "至少提供一个更新字段" });
    if (value.expected)
      for (const field of fields)
        if (value[field] !== undefined && value.expected[field] === undefined)
          context.addIssue({
            code: "custom",
            message: "需提供修改字段的原值以核对最新设置",
            path: ["expected", field],
          });
  });
export type AdminUpdateOrganizationInput = z.infer<
  typeof adminUpdateOrganizationSchema
>;
const agentValidityDateSchema = z.string().datetime({ offset: true });
type AgentValidityInput = {
  accountType?: "admin" | "agent" | "customer";
  agentValidFrom?: string | null;
  agentExpiresAt?: string | null;
};
function validateAgentValidity(
  value: AgentValidityInput,
  context: z.RefinementCtx,
) {
  if (
    value.accountType &&
    value.accountType !== "agent" &&
    (value.agentValidFrom || value.agentExpiresAt)
  )
    context.addIssue({
      code: "custom",
      message: "只有代理商账户可以设置有效期",
      path: ["accountType"],
    });
  if (
    value.agentValidFrom &&
    value.agentExpiresAt &&
    new Date(value.agentValidFrom) >= new Date(value.agentExpiresAt)
  )
    context.addIssue({
      code: "custom",
      message: "代理商生效时间必须早于到期时间",
      path: ["agentExpiresAt"],
    });
}
export const adminUpdateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    accountType: z.enum(["agent", "customer"]).optional(),
    pricingTier: pricingTierSchema.optional(),
    agentValidFrom: agentValidityDateSchema.nullable().optional(),
    agentExpiresAt: agentValidityDateSchema.nullable().optional(),
    agentQuota: z
      .object({
        enterpriseLimit: z.number().int().min(0).max(100_000).nullable(),
        brandLimit: z.number().int().min(0).max(100_000).nullable(),
        answerbitPointsLimit: z
          .number()
          .int()
          .min(0)
          .max(1_000_000_000)
          .nullable(),
      })
      .strict()
      .optional(),
    organizationFeatureScopes: z
      .array(
        z
          .object({
            organizationId: z.string().uuid(),
            features: z
              .array(
                z.enum([
                  "geo_insights",
                  "content",
                  "publication",
                  "balance",
                  "report",
                  "notification",
                  "member_management",
                  "enterprise_settings",
                ]),
              )
              .max(8)
              .refine(
                (features) => new Set(features).size === features.length,
                "企业功能不能重复",
              ),
          })
          .strict(),
      )
      .max(500)
      .refine(
        (scopes) =>
          new Set(scopes.map((scope) => scope.organizationId)).size ===
          scopes.length,
        "目标企业不能重复",
      )
      .optional(),
  })
  .strict()
  .superRefine(validateAgentValidity)
  .superRefine((value, context) => {
    if (value.accountType === "agent" && value.pricingTier === "retail")
      context.addIssue({
        code: "custom",
        message: "代理商请选择金牌、银牌或铜牌价格等级",
        path: ["pricingTier"],
      });
    if (value.accountType === "customer" && value.agentQuota)
      context.addIssue({
        code: "custom",
        message: "只有代理商账户可以设置经营额度",
        path: ["agentQuota"],
      });
    if (
      value.accountType === "customer" &&
      value.pricingTier !== undefined &&
      value.pricingTier !== "retail"
    )
      context.addIssue({
        code: "custom",
        message: "普通客户只能使用普通用户价格等级",
        path: ["pricingTier"],
      });
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段");
const answerBitOperationPermissionSchema = z
  .string()
  .trim()
  .startsWith("/geo/")
  .max(128);
const answerBitOperationPermissionListSchema = z
  .array(answerBitOperationPermissionSchema)
  .min(1)
  .max(64)
  .refine(
    (permissions) => new Set(permissions).size === permissions.length,
    "OpenAPI 权限不能重复",
  );
export const adminSetAnswerBitCredentialSchema = z
  .object({
    teamId: z.string().trim().min(1).max(128),
    apiKey: z.string().trim().min(16).max(512),
  })
  .strict();
export const adminSetFrogCredentialSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine(
        isHttpOrigin,
        "媒体发布接口地址必须是无路径、查询参数、凭证或片段的 HTTP(S) Origin",
      ),
    apiKey: z.string().trim().min(1).max(2048),
  })
  .strict();
export const adminCreateAnswerBitCredentialSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamId: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(128).optional(),
    scopeType: z.enum(["team", "brand"]),
    brandId: z.string().trim().min(1).max(128).optional(),
    brandName: z.string().trim().min(1).max(255).optional(),
    permissions: answerBitOperationPermissionListSchema,
    priority: z.number().int().min(1).max(1000).default(100),
    apiKey: z.string().trim().min(16).max(512),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeType === "brand" && !value.brandId)
      context.addIssue({
        code: "custom",
        message: "品牌级 Key 必须指定 BrandID",
        path: ["brandId"],
      });
    if (value.scopeType === "team" && (value.brandId || value.brandName))
      context.addIssue({
        code: "custom",
        message: "团队级 Key 不应指定品牌",
        path: ["scopeType"],
      });
  });
export const adminUpdateAnswerBitCredentialSchema = z
  .object({
    displayName: z.string().trim().min(1).max(128).nullable().optional(),
    permissions: answerBitOperationPermissionListSchema.optional(),
    priority: z.number().int().min(1).max(1000).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    apiKey: z.string().trim().min(16).max(512).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段");
export type AdminCreateAnswerBitCredentialInput = z.infer<
  typeof adminCreateAnswerBitCredentialSchema
>;
export type AdminUpdateAnswerBitCredentialInput = z.infer<
  typeof adminUpdateAnswerBitCredentialSchema
>;
export const accountUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{2,31}$/,
    "账号需以字母开头，只能包含小写字母、数字和下划线",
  );
export const accountPasswordSchema = z
  .string()
  .min(12, "密码至少 12 位")
  .max(128, "密码最多 128 位")
  .refine(
    (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
    "密码必须同时包含字母和数字",
  );
export const bootstrapAdminSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    username: accountUsernameSchema,
    password: accountPasswordSchema,
  })
  .strict();
export const adminCreateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    username: accountUsernameSchema,
    password: accountPasswordSchema,
    accountType: z.enum(["admin", "agent", "customer"]),
    pricingTier: pricingTierSchema.optional(),
    agentValidFrom: agentValidityDateSchema.nullable().optional(),
    agentExpiresAt: agentValidityDateSchema.nullable().optional(),
  })
  .strict()
  .superRefine(validateAgentValidity)
  .superRefine((value, context) => {
    if (value.accountType === "agent" && value.pricingTier === "retail")
      context.addIssue({
        code: "custom",
        message: "代理商请选择金牌、银牌或铜牌价格等级",
        path: ["pricingTier"],
      });
    if (value.accountType !== "agent" && value.pricingTier !== undefined)
      context.addIssue({
        code: "custom",
        message: "只有代理商账户可以选择代理价格等级",
        path: ["pricingTier"],
      });
  });
export const adminAddOrganizationMemberSchema = z
  .object({
    userId: z.string().uuid(),
    role: memberRoleSchema,
  })
  .strict();
export const balanceAssetSchema = z.enum([
  "answerbit_points",
  "publication_cny",
]);
export const balanceOperationSchema = z.enum([
  "grant",
  "allocate",
  "consume",
  "restore",
  "adjust",
]);
export const balanceTransactionQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    userId: z.string().uuid().optional(),
    asset: balanceAssetSchema.optional(),
    operation: balanceOperationSchema.optional(),
    limit: queryInteger(100, 1, 100),
  })
  .strict();
export const pointUsageQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid().optional(),
    brandId: z.string().trim().min(1).max(128).optional(),
    beginDate: dateSchema,
    endDate: dateSchema,
    operation: z.enum(["consume", "restore"]).optional(),
    page: queryInteger(1, 1, 100_000),
    pageSize: queryInteger(20, 1, 100),
  })
  .strict()
  .refine(
    (value) => Boolean(value.brandId) === Boolean(value.teamBindingId),
    "品牌积分查询范围不完整",
  )
  .refine((value) => value.beginDate <= value.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["beginDate"],
  });
export const adminBalanceTransactionQuerySchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    asset: balanceAssetSchema.optional(),
    operation: balanceOperationSchema.optional(),
    page: queryInteger(1, 1, 100_000),
    pageSize: queryInteger(20, 1, 100),
  })
  .strict();
export const balanceQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128).optional(),
    teamBindingId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.brandId) === Boolean(value.teamBindingId),
    "品牌余额查询范围不完整",
  );
export const adminGrantBalanceSchema = z
  .object({
    organizationId: z.string().uuid(),
    asset: balanceAssetSchema,
    amount: z.number().int().positive().max(1_000_000_000),
    reason: z.string().trim().min(4).max(1000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const adminDeductBalanceSchema = adminGrantBalanceSchema.extend({
  brandId: z.string().trim().min(1).max(128).optional(),
});
export type AdminDeductBalanceInput = z.infer<typeof adminDeductBalanceSchema>;
export const allocateBrandBalanceSchema = z
  .object({
    organizationId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
    asset: balanceAssetSchema,
    amount: z.number().int().positive().max(1_000_000_000),
    reason: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((value) => value || "企业向品牌划拨"),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const featurePointCostSchema = z
  .object({
    featureCode: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(128),
    points: z.number().int().nonnegative().max(1_000_000),
    description: z.string().trim().max(1000).default(""),
  })
  .strict();
export const pricingTierRuleSchema = z
  .object({
    tier: pricingTierSchema,
    displayName: z.string().trim().min(2).max(32),
    publicationMarkupBps: z.number().int().min(0).max(100_000),
    pointMarkupBps: z.number().int().min(-10_000).max(100_000),
  })
  .strict();
const publicationTierPricesSchema = z
  .object({
    retail: z.number().int().nonnegative().max(1_000_000_000).nullable(),
    bronze: z.number().int().nonnegative().max(1_000_000_000).nullable(),
    silver: z.number().int().nonnegative().max(1_000_000_000).nullable(),
    gold: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  })
  .strict();
export const createPublicationChannelSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    category: z.string().trim().min(2).max(64),
    priceAmount: z.number().int().nonnegative().max(1_000_000_000),
    tierPrices: publicationTierPricesSchema.optional(),
  })
  .strict();
export const updatePublicationChannelSchema = createPublicationChannelSchema
  .extend({
    status: z.enum(["active", "inactive"]),
    tierPrices: publicationTierPricesSchema,
  })
  .strict();
export const publicationChannelQuerySchema = z
  .object({
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(12, 1, 100),
    q: z.string().trim().max(200).optional(),
    mediaType: z.enum(["website", "wemedia", "manual"]).optional(),
    maxPriceAmount: queryInteger(0, 0, 1_000_000_000).optional(),
    field1: z.string().trim().max(160).optional(),
    field2: z.string().trim().max(160).optional(),
    field3: z.string().trim().max(160).optional(),
    field4: z.string().trim().max(160).optional(),
    field5: z.string().trim().max(160).optional(),
    field6: z.string().trim().max(160).optional(),
    field7: z.string().trim().max(160).optional(),
    field8: z.string().trim().max(160).optional(),
    field9: z.string().trim().max(160).optional(),
    sort: z
      .enum(["recommended", "priceAsc", "priceDesc", "rateDesc", "speedAsc"])
      .default("recommended"),
  })
  .strict();
export const adminPublicationChannelQuerySchema = publicationChannelQuerySchema
  .omit({ maxPriceAmount: true })
  .extend({
    pageSize: queryInteger(20, 1, 100),
    status: z.enum(["active", "inactive"]).optional(),
    provider: z.enum(["frog_media", "manual"]).optional(),
    category: z.string().trim().max(100).optional(),
  })
  .strict();
export const createPublicationOrderSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
    channelId: z.string().uuid(),
    title: z.string().trim().min(2).max(255),
    contentUrl: z.string().url().max(2000).optional(),
    contentHtml: z.string().trim().min(1).max(500_000).optional(),
    sourceJobId: z.string().uuid().optional(),
    sourceDocumentId: z.string().uuid().optional(),
    note: z.string().trim().max(2000).default(""),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .refine((value) => !(value.sourceJobId && value.sourceDocumentId), {
    message: "生成任务与文档库来源不能同时提交",
    path: ["sourceDocumentId"],
  });
export const publicationOrderQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid().optional(),
    brandId: z.string().trim().min(1).max(128).optional(),
    page: queryInteger(1, 1, 100_000),
    pageSize: queryInteger(20, 1, 100),
    keyword: z.string().trim().max(255).optional().default(""),
    status: z
      .enum(["submitted", "processing", "published", "failed", "cancelled"])
      .optional(),
    beginDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.brandId) === Boolean(value.teamBindingId),
    "品牌订单查询范围不完整",
  )
  .superRefine((value, context) => {
    if (Boolean(value.beginDate) !== Boolean(value.endDate))
      context.addIssue({
        code: "custom",
        message: "开始与结束日期必须同时提供",
        path: ["beginDate"],
      });
    if (value.beginDate && value.endDate && value.beginDate > value.endDate)
      context.addIssue({
        code: "custom",
        message: "开始日期不能晚于结束日期",
        path: ["beginDate"],
      });
  });
export type PublicationOrderQuery = z.infer<typeof publicationOrderQuerySchema>;
export const adminPublicationOrderQuerySchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    page: queryInteger(1, 1, 100_000),
    pageSize: queryInteger(20, 1, 100),
    q: z.string().trim().max(255).optional().default(""),
    status: z
      .enum(["submitted", "processing", "published", "failed", "cancelled"])
      .optional(),
    provider: z.enum(["manual", "frog_media"]).optional(),
    beginDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.beginDate) !== Boolean(value.endDate))
      context.addIssue({
        code: "custom",
        message: "开始与结束日期必须同时提供",
        path: ["beginDate"],
      });
    if (value.beginDate && value.endDate && value.beginDate > value.endDate)
      context.addIssue({
        code: "custom",
        message: "开始日期不能晚于结束日期",
        path: ["beginDate"],
      });
  });
export type AdminPublicationOrderQuery = z.infer<
  typeof adminPublicationOrderQuerySchema
>;
export const publicationOrderIdSchema = z
  .object({ orderId: z.string().uuid() })
  .strict();
export const updatePublicationOrderSchema = z
  .object({
    status: z.enum(["processing", "published", "failed", "cancelled"]),
    resultUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .regex(/^https?:\/\//i, "交付链接须使用 HTTP 或 HTTPS")
      .optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
export const publicationOrderActionSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
  })
  .strict();
export const publicationTrackingSourceQuerySchema = publicationOrderActionSchema
  .extend({ orderId: z.string().uuid() })
  .strict();
export const publicationTrackingSourceSchema = z.object({
  orderId: z.string().uuid(),
  title: z.string().trim().min(2).max(255),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .regex(/^https?:\/\//i),
});
export type PublicationTrackingSource = z.infer<
  typeof publicationTrackingSourceSchema
>;
export const appealPublicationOrderSchema = publicationOrderActionSchema
  .extend({
    reason: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    detail: z.string().trim().max(2000).optional(),
  })
  .strict();
const savedViewPageSchema = z.enum([
  "dashboard",
  "monitoring",
  "answers",
  "content",
  "metering",
]);
const savedViewFiltersSchema = z
  .record(z.string().min(1).max(64), z.unknown())
  .refine((value) => Object.keys(value).length <= 50, "筛选字段过多");
export const answersSavedViewFiltersSchema = z
  .object({
    teamBindingId: z.string().uuid().optional(),
    brandId: z.string().trim().min(1).max(128).optional(),
    beginDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    platforms: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
    platform: z.string().trim().min(1).max(128).optional(),
    keyword: z.string().trim().max(500).optional().default(""),
    mentionBrand: z.enum(["-1", "0", "1"]).optional().default("-1"),
  })
  .strict()
  .refine(
    (value) =>
      !value.beginDate || !value.endDate || value.beginDate <= value.endDate,
    { message: "开始日期不能晚于结束日期", path: ["beginDate"] },
  );
export const savedViewListQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    page: savedViewPageSchema.optional(),
  })
  .strict();
export const createSavedViewSchema = z
  .object({
    organizationId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    page: savedViewPageSchema,
    filters: savedViewFiltersSchema,
    isDefault: z.boolean().optional().default(false),
  })
  .strict();
export const updateSavedViewSchema = z
  .object({
    organizationId: z.string().uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    filters: savedViewFiltersSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, "至少提供一个更新字段");
export const savedViewActionSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
const reportFilterFields = {
  beginDate: dateSchema,
  endDate: dateSchema,
  titleIds: z
    .array(z.string().trim().min(1).max(128))
    .max(100)
    .optional()
    .default([]),
  promptIds: z
    .array(z.string().trim().min(1).max(128))
    .max(100)
    .optional()
    .default([]),
  platforms: z
    .array(z.string().trim().min(1).max(128))
    .max(100)
    .optional()
    .default([]),
  tagIds: z
    .array(z.string().trim().min(1).max(128))
    .max(100)
    .optional()
    .default([]),
  keyword: z.string().trim().max(500).optional(),
  mentionBrand: z
    .union([z.literal(-1), z.literal(0), z.literal(1)])
    .optional()
    .default(-1),
};
export const reportExportFiltersSchema = z
  .object(reportFilterFields)
  .strict()
  .refine((value) => value.beginDate <= value.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["beginDate"],
  });
export const createReportExportSchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
    reportType: z.enum(["answers", "domain_rank", "article_rank"]),
    ...reportFilterFields,
  })
  .strict()
  .refine((value) => value.beginDate <= value.endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["beginDate"],
  });
export const reportExportListQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    teamBindingId: z.string().uuid(),
    brandId: z.string().trim().min(1).max(128),
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(20, 1, 100),
  })
  .strict();
export const reportExportActionSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
const notificationRuleBase = {
  organizationId: z.string().uuid(),
  teamBindingId: z.string().uuid(),
  cooldownMinutes: z.number().int().min(5).max(10080).optional().default(1440),
  enabled: z.boolean().optional().default(true),
};
export const notificationRuleSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...notificationRuleBase,
      type: z.literal("low_credits"),
      threshold: z.number().int().min(0).max(1_000_000_000),
    })
    .strict(),
  z
    .object({
      ...notificationRuleBase,
      type: z.literal("connection_failure"),
      threshold: z.number().int().min(1).max(20),
    })
    .strict(),
  z
    .object({
      ...notificationRuleBase,
      type: z.literal("metric_anomaly"),
      brandId: z.string().trim().min(1).max(128),
      metric: z.enum(["exposure", "score", "avg_rank"]),
      threshold: z.number().int().min(1).max(100),
      windowDays: z.number().int().min(1).max(90).optional().default(7),
    })
    .strict(),
]);
export const notificationRuleListQuerySchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
export const notificationRuleActionSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
export const notificationListQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    page: queryInteger(1, 1, 100000),
    pageSize: queryInteger(20, 1, 100),
    unreadOnly: z.preprocess(
      (value) =>
        value === undefined || value === ""
          ? false
          : value === "true"
            ? true
            : value === "false"
              ? false
              : value,
      z.boolean(),
    ),
  })
  .strict();
export const notificationReadSchema = z
  .object({
    organizationId: z.string().uuid(),
    read: z.boolean().optional().default(true),
  })
  .strict();
export const notificationReadAllSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
export type TraceArticleInput = z.infer<typeof traceArticleSchema>;
export type ArticleListQuery = z.infer<typeof articleListQuerySchema>;
export type ArticleDetailQuery = z.infer<typeof articleDetailQuerySchema>;
export type CreateArticleJobInput = z.infer<typeof createArticleJobSchema>;
export type AnswerBitArticleCreatePayload = z.infer<
  typeof answerBitArticleCreatePayloadSchema
>;
export type ContentDocumentListQuery = z.infer<
  typeof contentDocumentListQuerySchema
>;
export type CreateContentDocumentInput = z.infer<
  typeof createContentDocumentSchema
>;
export type UpdateContentDocumentInput = z.infer<
  typeof updateContentDocumentSchema
>;
export type CreateContentFolderInput = z.infer<
  typeof createContentFolderSchema
>;
export type RestoreContentDocumentVersionInput = z.infer<
  typeof restoreContentDocumentVersionSchema
>;
export type MeteringScopeQuery = z.infer<typeof meteringScopeQuerySchema>;
export type MeteringPeriodQuery = z.infer<typeof meteringPeriodQuerySchema>;
export type MeteringPageQuery = z.infer<typeof meteringPageQuerySchema>;
export type PurchaseAnswerBitQuotaInput = z.infer<
  typeof purchaseAnswerBitQuotaSchema
>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type AdminAddOrganizationMemberInput = z.infer<
  typeof adminAddOrganizationMemberSchema
>;
export type AdminSetAnswerBitCredentialInput = z.infer<
  typeof adminSetAnswerBitCredentialSchema
>;
export type AdminSetFrogCredentialInput = z.infer<
  typeof adminSetFrogCredentialSchema
>;
export type BootstrapAdminInput = z.infer<typeof bootstrapAdminSchema>;
export type BalanceAssetInput = z.infer<typeof balanceAssetSchema>;
export type BalanceOperationInput = z.infer<typeof balanceOperationSchema>;
export type BalanceTransactionQuery = z.infer<
  typeof balanceTransactionQuerySchema
>;
export type PointUsageQuery = z.infer<typeof pointUsageQuerySchema>;
export type AdminBalanceTransactionQuery = z.infer<
  typeof adminBalanceTransactionQuerySchema
>;
export type AdminGrantBalanceInput = z.infer<typeof adminGrantBalanceSchema>;
export type AllocateBrandBalanceInput = z.infer<
  typeof allocateBrandBalanceSchema
>;
export type FeaturePointCostInput = z.infer<typeof featurePointCostSchema>;
export type PricingTier = z.infer<typeof pricingTierSchema>;
export type PricingTierRuleInput = z.infer<typeof pricingTierRuleSchema>;
export type CreatePublicationChannelInput = z.infer<
  typeof createPublicationChannelSchema
>;
export type UpdatePublicationChannelInput = z.infer<
  typeof updatePublicationChannelSchema
>;
export type PublicationChannelQuery = z.infer<
  typeof publicationChannelQuerySchema
>;
export type AdminPublicationChannelQuery = z.infer<
  typeof adminPublicationChannelQuerySchema
>;
export type CreatePublicationOrderInput = z.infer<
  typeof createPublicationOrderSchema
>;
export type UpdatePublicationOrderInput = z.infer<
  typeof updatePublicationOrderSchema
>;
export type PublicationOrderActionInput = z.infer<
  typeof publicationOrderActionSchema
>;
export type AppealPublicationOrderInput = z.infer<
  typeof appealPublicationOrderSchema
>;
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;
export type CreateReportExportInput = z.infer<typeof createReportExportSchema>;
export type ReportExportFilters = z.infer<typeof reportExportFiltersSchema>;
export type ReportExportListQuery = z.infer<typeof reportExportListQuerySchema>;
export type NotificationRuleInput = z.infer<typeof notificationRuleSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreatePromptInput = z.infer<typeof createPromptSchema>;
export type CreatePromptsBatchInput = z.infer<typeof createPromptsBatchSchema>;
export type UpdatePromptInput = z.infer<typeof updatePromptSchema>;
export type MovePromptInput = z.infer<typeof movePromptSchema>;
export type PromptListQuery = z.infer<typeof promptListQuerySchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type CitationRankQuery = z.infer<typeof citationRankQuerySchema>;
export type ApiSuccess<T> = { data: T; requestId: string };
export type ApiFailure = {
  error: { code: string; message: string };
  requestId: string;
};

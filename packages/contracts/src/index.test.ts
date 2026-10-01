import { describe, expect, it } from "vitest";
import {
  addOrganizationMemberSchema,
  adminAddOrganizationMemberSchema,
  adminBalanceTransactionQuerySchema,
  adminCreateAnswerBitBrandSchema,
  adminCreateUserSchema,
  adminSetAnswerBitCredentialSchema,
  adminSetFrogCredentialSchema,
  adminUpdateAnswerBitBrandIconSchema,
  adminUpdateAnswerBitBrandSchema,
  adminUpdateUserSchema,
  adminUpdateOrganizationSchema,
  adminOrganizationPageQuerySchema,
  adminUserPageQuerySchema,
  balanceTransactionQuerySchema,
  balanceTransactionActorQuerySchema,
  pointUsageQuerySchema,
  publicationOrderQuerySchema,
  adminPublicationOrderQuerySchema,
  publicationOrderIdSchema,
  updatePublicationOrderSchema,
} from "./index";

const organizationId = "e17c707b-f07c-4464-a4fa-26d699dad45b";
const teamBindingId = "630dacb0-54b4-464c-acd0-de1079ff2a0b";
const userId = "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8";
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("发布订单查询契约", () => {
  it("平台订单默认分页，企业、渠道、状态与日期可组合", () => {
    expect(adminPublicationOrderQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      q: "",
    });
    expect(
      adminPublicationOrderQuerySchema.parse({
        organizationId,
        provider: "manual",
        q: " 企业 ",
        status: "submitted",
        page: "2",
        pageSize: "50",
        beginDate: "2026-09-01",
        endDate: "2026-09-30",
      }),
    ).toMatchObject({ q: "企业", page: 2, pageSize: 50, provider: "manual" });
  });
  it.each([
    { pageSize: "101" },
    { page: "0" },
    { provider: "unknown" },
    { organizationId: "invalid" },
    { beginDate: "2026-09-01" },
    { beginDate: "2026-09-02", endDate: "2026-09-01" },
    { status: "unknown" },
  ])("平台订单拒绝非法条件 %j", (value) => {
    expect(adminPublicationOrderQuerySchema.safeParse(value).success).toBe(
      false,
    );
  });
  it("单笔核对必须使用 UUID，交付仅允许 HTTP(S) 链接", () => {
    expect(
      publicationOrderIdSchema.safeParse({ orderId: organizationId }).success,
    ).toBe(true);
    expect(publicationOrderIdSchema.safeParse({ orderId: "bad" }).success).toBe(
      false,
    );
    expect(
      updatePublicationOrderSchema.safeParse({
        status: "published",
        resultUrl: "https://example.com/article",
      }).success,
    ).toBe(true);
    expect(
      updatePublicationOrderSchema.safeParse({
        status: "published",
        resultUrl: "ftp://example.com/article",
      }).success,
    ).toBe(false);
  });
  it("默认返回有界分页，完整品牌范围和合法筛选可以组合", () => {
    expect(publicationOrderQuerySchema.parse({ organizationId })).toMatchObject(
      { page: 1, pageSize: 20, keyword: "" },
    );
    expect(
      publicationOrderQuerySchema.parse({
        organizationId,
        teamBindingId,
        brandId: "brand",
        page: "2",
        pageSize: "50",
        keyword: "  100%_文章  ",
        status: "published",
        beginDate: "2026-09-01",
        endDate: "2026-09-30",
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 50,
      keyword: "100%_文章",
      status: "published",
    });
  });
  it.each([
    { page: "0" },
    { pageSize: "101" },
    { status: "unknown" },
    { brandId: "brand" },
    { beginDate: "2026-09-01" },
    { beginDate: "2026-09-02", endDate: "2026-09-01" },
    { endDate: "not-a-date", beginDate: "2026-09-01" },
  ])("拒绝不完整或非法查询 %j", (value) => {
    expect(
      publicationOrderQuerySchema.safeParse({ organizationId, ...value })
        .success,
    ).toBe(false);
  });
});

describe("平台资源管理契约", () => {
  it("企业目录分页、文字搜索和实际服务状态独立于原始状态", () => {
    expect(adminOrganizationPageQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(
      adminOrganizationPageQuerySchema.parse({
        page: "2",
        pageSize: "10",
        q: "  BrandID  ",
        accessState: "expired",
        status: "active",
      }),
    ).toEqual({
      page: 2,
      pageSize: 10,
      q: "BrandID",
      accessState: "expired",
      status: "active",
    });
  });
  it.each([
    { accessState: "closed" },
    { status: "expired" },
    { page: "0" },
    { pageSize: "101" },
    { q: "a".repeat(201) },
    { unexpected: true },
  ])("企业目录拒绝非法筛选 %j", (value) => {
    expect(adminOrganizationPageQuerySchema.safeParse(value).success).toBe(
      false,
    );
  });
  it("企业只更新指定字段，原值支持历史空期限与额外状态校验", () => {
    expect(
      adminUpdateOrganizationSchema.parse({
        serviceExpiresAt: "2027-01-01T00:00:00Z",
        expected: { status: "active", serviceExpiresAt: null },
      }),
    ).toEqual({
      serviceExpiresAt: "2027-01-01T00:00:00Z",
      expected: { status: "active", serviceExpiresAt: null },
    });
    expect(
      adminUpdateOrganizationSchema.safeParse({ status: "suspended" }).success,
    ).toBe(true);
  });
  it.each([
    {},
    { expected: {} },
    { status: "active", expected: {} },
    {
      serviceExpiresAt: "2027-01-01T00:00:00Z",
      expected: { status: "active" },
    },
    { serviceExpiresAt: null },
    { status: "closed" },
    { pointsExpiresAt: "bad" },
    { status: "active", expected: { status: "closed" } },
  ])("企业设置拒绝空修改、非法期限与不完整原值 %j", (value) => {
    expect(adminUpdateOrganizationSchema.safeParse(value).success).toBe(false);
  });
  it("媒体发布配置只接受 HTTP(S) Origin", () => {
    expect(
      adminSetFrogCredentialSchema.safeParse({
        baseUrl: "https://frog.example.com",
        apiKey: "secret",
      }).success,
    ).toBe(true);
    for (const baseUrl of [
      "https://frog.example.com/api",
      "https://frog.example.com?tenant=1",
      "https://user:pass@frog.example.com",
      "ftp://frog.example.com",
    ])
      expect(
        adminSetFrogCredentialSchema.safeParse({ baseUrl, apiKey: "secret" })
          .success,
      ).toBe(false);
  });

  it("余额流水支持按企业、用户、资产和操作筛选", () => {
    expect(
      balanceTransactionQuerySchema.parse({
        organizationId,
        userId,
        asset: "answerbit_points",
        operation: "consume",
      }),
    ).toMatchObject({
      organizationId,
      userId,
      asset: "answerbit_points",
      operation: "consume",
      page: 1,
      pageSize: 20,
    });
    expect(
      adminBalanceTransactionQuerySchema.parse({
        userId,
        page: "2",
        pageSize: "50",
      }),
    ).toMatchObject({ userId, page: 2, pageSize: 50 });
    expect(
      balanceTransactionQuerySchema.safeParse({
        organizationId,
        operation: "refund",
      }).success,
    ).toBe(false);
  });

  it("企业流水支持完整分页和北京时间日期，拒绝错误范围及旧截断参数", () => {
    expect(
      balanceTransactionQuerySchema.parse({
        organizationId,
        page: "6",
        pageSize: "20",
        beginDate: "2026-01-01",
        endDate: "2026-01-31",
      }),
    ).toMatchObject({ page: 6, pageSize: 20, beginDate: "2026-01-01" });
    for (const invalid of [
      { page: "0" },
      { pageSize: "101" },
      { beginDate: "2026-02-30" },
      { beginDate: "2026-02-01", endDate: "2026-01-31" },
      { limit: "100" },
    ])
      expect(
        balanceTransactionQuerySchema.safeParse({ organizationId, ...invalid })
          .success,
      ).toBe(false);
    expect(
      balanceTransactionActorQuerySchema.parse({
        organizationId,
        q: "  历史用户  ",
        userId,
      }),
    ).toEqual({ organizationId, q: "历史用户", userId });
    expect(
      balanceTransactionActorQuerySchema.safeParse({
        organizationId,
        q: "a".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("品牌积分用量支持日期、类型和服务端分页", () => {
    expect(
      pointUsageQuerySchema.parse({
        organizationId,
        teamBindingId,
        brandId: "brand-1",
        beginDate: "2026-08-22",
        endDate: "2026-09-20",
        operation: "consume",
        page: "2",
        pageSize: "50",
      }),
    ).toMatchObject({ operation: "consume", page: 2, pageSize: 50 });
    expect(
      pointUsageQuerySchema.safeParse({
        organizationId,
        teamBindingId,
        brandId: "brand-1",
        beginDate: "2026-09-20",
        endDate: "2026-08-22",
      }).success,
    ).toBe(false);
  });

  it("企业积分汇总不要求品牌；品牌与团队必须成对提交", () => {
    const input = {
      organizationId,
      beginDate: "2026-09-01",
      endDate: "2026-09-30",
    };
    expect(pointUsageQuerySchema.parse(input)).toMatchObject({
      page: 1,
      pageSize: 20,
    });
    expect(
      pointUsageQuerySchema.safeParse({ ...input, brandId: "brand-1" }).success,
    ).toBe(false);
    expect(
      pointUsageQuerySchema.safeParse({ ...input, teamBindingId }).success,
    ).toBe(false);
  });

  it("平台品牌角色由企业自动确定品牌范围", () => {
    expect(
      adminAddOrganizationMemberSchema.safeParse({
        userId,
        role: "brand_editor",
      }).success,
    ).toBe(true);
    expect(
      adminAddOrganizationMemberSchema.safeParse({
        userId,
        role: "brand_editor",
        teamBindingId,
        brandId: "brand-1",
      }).success,
    ).toBe(false);
  });

  it("用户列表支持账号类型、状态和搜索筛选", () => {
    expect(
      adminUserPageQuerySchema.parse({
        accountType: "agent",
        q: "east",
        status: "active",
      }),
    ).toMatchObject({
      page: 1,
      pageSize: 20,
      accountType: "agent",
      q: "east",
      status: "active",
    });
    expect(
      adminUserPageQuerySchema.safeParse({ accountType: "owner" }).success,
    ).toBe(false);
  });

  it("创建和更新代理商时校验有效时间范围", () => {
    expect(
      adminCreateUserSchema.safeParse({
        name: "区域代理",
        username: "region_agent",
        password: "secure-agent-2026",
        accountType: "agent",
        agentValidFrom: "2026-09-13T00:00:00.000Z",
        agentExpiresAt: "2027-09-13T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      adminCreateUserSchema.safeParse({
        name: "普通客户",
        username: "normal_customer",
        password: "secure-user-2026",
        accountType: "customer",
        agentExpiresAt: "2027-09-13T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      adminUpdateUserSchema.safeParse({
        accountType: "agent",
        agentValidFrom: "2027-09-13T00:00:00.000Z",
        agentExpiresAt: "2026-09-13T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(adminUpdateUserSchema.safeParse({}).success).toBe(false);
  });

  it("用户更新支持代理商额度和目标企业功能范围", () => {
    expect(
      adminUpdateUserSchema.safeParse({
        accountType: "agent",
        agentQuota: {
          enterpriseLimit: 20,
          brandLimit: 50,
          answerbitPointsLimit: 100_000,
        },
        organizationFeatureScopes: [
          {
            organizationId,
            features: ["geo_insights", "content", "report"],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      adminUpdateUserSchema.safeParse({
        accountType: "customer",
        agentQuota: {
          enterpriseLimit: 1,
          brandLimit: 1,
          answerbitPointsLimit: 100,
        },
      }).success,
    ).toBe(false);
    expect(
      adminUpdateUserSchema.safeParse({
        organizationFeatureScopes: [
          {
            organizationId,
            features: ["content", "content"],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
describe("成员邀请契约", () => {
  it("接受企业管理员账号", () =>
    expect(
      addOrganizationMemberSchema.safeParse({
        username: "tenant_admin",
        role: "tenant_admin",
      }).success,
    ).toBe(true));
  it("品牌角色由企业自动绑定唯一品牌", () =>
    expect(
      addOrganizationMemberSchema.safeParse({
        username: "brand_editor",
        role: "brand_editor",
      }).success,
    ).toBe(true));
  it("允许创建客户账号并立即授予品牌权限", () =>
    expect(
      addOrganizationMemberSchema.safeParse({
        name: "张三",
        username: "brand_editor",
        password: "safePassword123",
        role: "brand_editor",
      }).success,
    ).toBe(true));
  it("不允许企业端创建企业管理员或代理商账号", () => {
    expect(
      addOrganizationMemberSchema.safeParse({
        name: "代理商",
        username: "new_agent",
        password: "safePassword123",
        role: "tenant_admin",
      }).success,
    ).toBe(false);
    expect(
      addOrganizationMemberSchema.safeParse({
        name: "张三",
        username: "brand_editor",
        password: "safePassword123",
        role: "brand_editor",
        accountType: "agent",
      }).success,
    ).toBe(false);
  });
  it("拒绝不合法账号", () =>
    expect(
      addOrganizationMemberSchema.safeParse({
        username: "12",
        role: "tenant_admin",
      }).success,
    ).toBe(false));
});
describe("平台腾讯凭证契约", () => {
  it("统一配置只要求 TeamID 和 16–512 位 API Key", () => {
    expect(
      adminSetAnswerBitCredentialSchema.safeParse({
        teamId: "team-1",
        apiKey: "platform-api-key-123456",
      }).success,
    ).toBe(true);
    expect(
      adminSetAnswerBitCredentialSchema.safeParse({
        teamId: "team-1",
        apiKey: "too-short",
      }).success,
    ).toBe(false);
    expect(
      adminSetAnswerBitCredentialSchema.safeParse({
        teamId: "team-1",
        apiKey: "platform-api-key-123456",
        permissions: ["/geo/query/brand"],
      }).success,
    ).toBe(false);
  });
  it("平台可提交腾讯官方品牌创建参数", () => {
    expect(
      adminCreateAnswerBitBrandSchema.safeParse({
        brand: "腾讯上游品牌",
        alias: "品牌别名",
        website: "https://example.com",
      }).success,
    ).toBe(true);
    expect(
      adminCreateAnswerBitBrandSchema.safeParse({
        brand: "腾讯上游品牌",
        iconData: "base64",
      }).success,
    ).toBe(false);
    expect(
      adminCreateAnswerBitBrandSchema.parse({
        brand: "腾讯上游品牌",
        initialPrompts: ["这个品牌值得买吗"],
        competitors: [{ name: "测试竞品" }],
      }),
    ).toMatchObject({
      initialPrompts: ["这个品牌值得买吗"],
      competitors: [{ name: "测试竞品" }],
    });
  });
  it("平台更新腾讯品牌 Logo 时校验 MIME 和 Base64 内容", () => {
    expect(
      adminUpdateAnswerBitBrandIconSchema.safeParse({
        iconMimeType: "image/png",
        iconData: pngBase64,
      }).success,
    ).toBe(true);
    expect(
      adminUpdateAnswerBitBrandIconSchema.safeParse({
        iconMimeType: "application/pdf",
        iconData: pngBase64,
      }).success,
    ).toBe(false);
    expect(
      adminUpdateAnswerBitBrandIconSchema.safeParse({
        iconMimeType: "image/png",
        iconData: "not-base64",
      }).success,
    ).toBe(false);
    expect(
      adminUpdateAnswerBitBrandIconSchema.safeParse({
        iconMimeType: "image/png",
        iconData: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
      }).success,
    ).toBe(false);
  });
  it("平台修改腾讯企业时补齐官方接口默认字段", () => {
    expect(
      adminUpdateAnswerBitBrandSchema.parse({ brandName: "修改后的品牌" }),
    ).toEqual({
      brandName: "修改后的品牌",
      brandAlias: "",
      website: "",
      description: "",
      note: "",
      websiteAutoTrace: false,
    });
    expect(adminUpdateAnswerBitBrandSchema.safeParse({}).success).toBe(false);
  });
});
describe("品牌写入契约", () => {
  it("创建品牌时校验 Logo 内容与 MIME 同时存在", async () => {
    const { createBrandSchema } = await import("./index");
    expect(
      createBrandSchema.safeParse({
        organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
        teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
        brand: "品牌",
        iconData: "abc",
      }).success,
    ).toBe(false);
  });
  it("更新品牌要求完整可编辑字段", async () => {
    const { updateBrandSchema } = await import("./index");
    expect(
      updateBrandSchema.safeParse({
        organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
        teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
        brandName: "品牌",
      }).success,
    ).toBe(false);
  });
});
describe("竞品与概览契约", () => {
  const scope = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
    brandId: "brand-1",
  };
  it("竞品更新要求全量名称和别名", async () => {
    const { updateCompetitorSchema } = await import("./index");
    expect(
      updateCompetitorSchema.safeParse({ ...scope, competitorName: "竞品" })
        .success,
    ).toBe(false);
  });
  it("概览查询将逗号分隔筛选转换为数组", async () => {
    const { dashboardQuerySchema } = await import("./index");
    const parsed = dashboardQuerySchema.parse({
      ...scope,
      beginDate: "2026-09-01",
      endDate: "2026-09-08",
      platforms: "deepseek,yuanbao",
    });
    expect(parsed.platforms).toEqual(["deepseek", "yuanbao"]);
  });
  it("拒绝反向日期范围", async () => {
    const { dashboardQuerySchema } = await import("./index");
    expect(
      dashboardQuerySchema.safeParse({
        ...scope,
        beginDate: "2026-09-08",
        endDate: "2026-09-01",
      }).success,
    ).toBe(false);
  });
});
describe("监控问题与回答契约", () => {
  const scope = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
    brandId: "brand-1",
  };
  it("局部更新至少包含问题内容或状态", async () => {
    const { updatePromptSchema } = await import("./index");
    expect(updatePromptSchema.safeParse(scope).success).toBe(false);
    expect(updatePromptSchema.safeParse({ ...scope, status: 2 }).success).toBe(
      true,
    );
  });
  it("分组查询日期必须成对出现", async () => {
    const { promptListQuerySchema } = await import("./index");
    expect(
      promptListQuerySchema.safeParse({ ...scope, beginDate: "2026-09-01" })
        .success,
    ).toBe(false);
    expect(
      promptListQuerySchema.parse({
        ...scope,
        platforms: "deepseek,yuanbao",
      }).platforms,
    ).toEqual(["deepseek", "yuanbao"]);
  });
  it("批量推荐记录与问题一一对应", async () => {
    const { createPromptsBatchSchema } = await import("./index");
    expect(
      createPromptsBatchSchema.safeParse({
        ...scope,
        titleId: "title-1",
        prompts: ["a", "b"],
        recommendIds: ["r1"],
      }).success,
    ).toBe(false);
  });
  it("回答筛选拒绝反向分数范围", async () => {
    const { taskListQuerySchema } = await import("./index");
    expect(
      taskListQuerySchema.safeParse({
        ...scope,
        beginDate: "2026-09-01",
        endDate: "2026-09-08",
        minScore: "90",
        maxScore: "20",
      }).success,
    ).toBe(false);
  });
});
describe("文章追踪与生成契约", () => {
  const scope = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
    brandId: "brand-1",
  };
  it("追踪文章要求公开 URL 和受支持语言", async () => {
    const { traceArticleSchema } = await import("./index");
    expect(
      traceArticleSchema.safeParse({
        ...scope,
        title: "文章",
        urls: ["not-url"],
        expectedPoints: 3,
      }).success,
    ).toBe(false);
    expect(
      traceArticleSchema.safeParse({
        ...scope,
        title: "文章",
        urls: ["https://example.com"],
        expectedPoints: 3,
        language: "zh-CN",
      }).success,
    ).toBe(true);
    for (const url of [
      "ftp://example.com/article",
      "javascript:alert(1)",
      "mailto:a@example.com",
    ]) {
      expect(
        traceArticleSchema.safeParse({
          ...scope,
          title: "文章",
          expectedPoints: 3,
          urls: [url],
        }).success,
      ).toBe(false);
    }
  });
  it("文章列表统计时间必须成对出现", async () => {
    const { articleListQuerySchema } = await import("./index");
    expect(
      articleListQuerySchema.safeParse({ ...scope, startTime: "1" }).success,
    ).toBe(false);
  });
  it("高引用资料要求 URL 或标题正文", async () => {
    const { createArticleJobSchema } = await import("./index");
    expect(
      createArticleJobSchema.safeParse({
        ...scope,
        templateType: 2,
        promptIds: ["p1"],
        highReference: {},
      }).success,
    ).toBe(false);
  });
  it("计费操作必须提交用户看到的积分报价", async () => {
    const { createArticleJobSchema, traceArticleSchema } = await import(
      "./index"
    );
    expect(
      createArticleJobSchema.safeParse({
        ...scope,
        templateType: 2,
        promptIds: ["p1"],
      }).success,
    ).toBe(false);
    expect(
      traceArticleSchema.safeParse({
        ...scope,
        title: "文章",
        urls: ["https://example.com"],
      }).success,
    ).toBe(false);
  });
  it("生成内容支持保存平台自定义标签并拒绝重复", async () => {
    const { createArticleJobSchema } = await import("./index");
    expect(
      createArticleJobSchema.parse({
        ...scope,
        templateType: 2,
        promptIds: ["p1"],
        expectedPoints: 13,
        contentTags: ["品牌故事", "产品指南"],
      }).contentTags,
    ).toEqual(["品牌故事", "产品指南"]);
    expect(
      createArticleJobSchema.safeParse({
        ...scope,
        templateType: 2,
        promptIds: ["p1"],
        expectedPoints: 13,
        contentTags: ["SEO", "seo"],
      }).success,
    ).toBe(false);
  });
});
describe("内容文档库契约", () => {
  const scope = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
    brandId: "brand-1",
  };
  it("支持创建草稿与导入文章", async () => {
    const { createContentDocumentSchema } = await import("./index");
    expect(
      createContentDocumentSchema.parse({
        ...scope,
        title: "品牌文章",
        tags: ["品牌", "案例"],
      }).status,
    ).toBe("draft");
    expect(
      createContentDocumentSchema.safeParse({
        ...scope,
        title: "外部文章",
        source: "imported",
      }).success,
    ).toBe(false);
    expect(
      createContentDocumentSchema.safeParse({
        ...scope,
        title: "空正文",
        status: "ready",
      }).success,
    ).toBe(false);
  });
  it("文档修改必须包含实际字段", async () => {
    const { updateContentDocumentSchema } = await import("./index");
    expect(updateContentDocumentSchema.safeParse({ ...scope }).success).toBe(
      false,
    );
    expect(
      updateContentDocumentSchema.safeParse({
        ...scope,
        expectedVersion: 1,
        body: "更新后的正文",
        changeSummary: "补充案例",
      }).success,
    ).toBe(true);
  });
  it("修改、恢复、归档都必须携带看到的正整数版本", async () => {
    const {
      updateContentDocumentSchema,
      restoreContentDocumentVersionSchema,
      archiveContentDocumentQuerySchema,
    } = await import("./index");
    for (const version of [undefined, 0, -1, 1.5]) {
      expect(
        updateContentDocumentSchema.safeParse({
          ...scope,
          title: "新标题",
          expectedVersion: version,
        }).success,
      ).toBe(false);
      expect(
        restoreContentDocumentVersionSchema.safeParse({
          ...scope,
          expectedVersion: version,
        }).success,
      ).toBe(false);
      expect(
        archiveContentDocumentQuerySchema.safeParse({
          ...scope,
          expectedVersion: version,
        }).success,
      ).toBe(false);
    }
    expect(
      archiveContentDocumentQuerySchema.parse({
        ...scope,
        expectedVersion: "2",
      }).expectedVersion,
    ).toBe(2);
  });
  it("文档列表不允许同时选择文件夹和未归档", async () => {
    const { contentDocumentListQuerySchema } = await import("./index");
    expect(
      contentDocumentListQuerySchema.safeParse({
        ...scope,
        folderId: "02f21a95-6a6d-4240-96dc-d0b5b8777cc8",
        unfiled: "true",
      }).success,
    ).toBe(false);
  });
});
describe("AnswerBit 计量查询契约", () => {
  const scope = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
    brandId: "brand-1",
  };
  it("将用量类型列表解析为数组", async () => {
    const { meteringPeriodQuerySchema } = await import("./index");
    expect(
      meteringPeriodQuerySchema.parse({
        ...scope,
        quotaTypes: "article_generate,prompt_query",
      }).quotaTypes,
    ).toEqual(["article_generate", "prompt_query"]);
  });
  it("计量趋势的 Unix 时间必须成对且正序", async () => {
    const { meteringPeriodQuerySchema } = await import("./index");
    expect(
      meteringPeriodQuerySchema.safeParse({ ...scope, startUnix: "10" })
        .success,
    ).toBe(false);
    expect(
      meteringPeriodQuerySchema.safeParse({
        ...scope,
        startUnix: "20",
        endUnix: "10",
      }).success,
    ).toBe(false);
    expect(
      meteringPeriodQuerySchema.safeParse({
        ...scope,
        startUnix: "0",
      }).success,
    ).toBe(false);
  });
  it("积分流水分页和状态由查询字符串规范化", async () => {
    const { meteringPageQuerySchema } = await import("./index");
    const parsed = meteringPageQuerySchema.parse({
      ...scope,
      page: "2",
      pageSize: "50",
      status: "1",
    });
    expect(parsed).toMatchObject({ page: 2, pageSize: 50, status: 1 });
    expect(
      meteringPageQuerySchema.safeParse({
        ...scope,
        startTime: "0",
      }).success,
    ).toBe(false);
  });
  it("监控品牌扩容只接受官方类型和 1 至 9999 的整数数量", async () => {
    const { purchaseAnswerBitQuotaSchema } = await import("./index");
    expect(
      purchaseAnswerBitQuotaSchema.parse({
        ...scope,
        quotaType: "max_brand",
        quotaAmount: 2,
      }).quotaAmount,
    ).toBe(2);
    expect(
      purchaseAnswerBitQuotaSchema.safeParse({
        ...scope,
        quotaType: "max_member",
        quotaAmount: 1,
      }).success,
    ).toBe(false);
    expect(
      purchaseAnswerBitQuotaSchema.safeParse({
        ...scope,
        quotaType: "max_brand",
        quotaAmount: 10000,
      }).success,
    ).toBe(false);
  });
});
describe("余额与发布契约", () => {
  const organizationId = "e17c707b-f07c-4464-a4fa-26d699dad45b";
  const teamBindingId = "630dacb0-54b4-464c-acd0-de1079ff2a0b";

  it("管理员划拨余额必须指定账本、正整数和幂等键", async () => {
    const { adminGrantBalanceSchema } = await import("./index");
    expect(
      adminGrantBalanceSchema.safeParse({
        organizationId,
        asset: "answerbit_points",
        amount: 1000,
        reason: "管理员季度划拨",
        idempotencyKey: "grant-20260909-1",
      }).success,
    ).toBe(true);
    expect(
      adminGrantBalanceSchema.safeParse({
        organizationId,
        asset: "publication_cny",
        amount: 0,
        reason: "金额错误",
        idempotencyKey: "grant-20260909-2",
      }).success,
    ).toBe(false);
  });

  it("代理商可把企业余额划分到品牌", async () => {
    const { allocateBrandBalanceSchema } = await import("./index");
    expect(
      allocateBrandBalanceSchema.safeParse({
        organizationId,
        brandId: "brand-1",
        asset: "publication_cny",
        amount: 50000,
        reason: "品牌发布预算",
        idempotencyKey: "allocate-20260909-1",
      }).success,
    ).toBe(true);
  });

  it("发布单以人民币分为价格单位并绑定品牌", async () => {
    const { createPublicationOrderSchema } = await import("./index");
    expect(
      createPublicationOrderSchema.safeParse({
        organizationId,
        teamBindingId,
        brandId: "brand-1",
        channelId: "bf96ddaa-b44c-456d-a998-4ef46d5f5688",
        title: "品牌稿件",
        note: "按渠道报价发布",
        idempotencyKey: "publication-20260909-1",
      }).success,
    ).toBe(true);
  });

  it("功能积分规则只接受功能编码", async () => {
    const { featurePointCostSchema } = await import("./index");
    expect(
      featurePointCostSchema.safeParse({
        featureCode: "ai_article_generation",
        points: 10,
        description: "生成文章",
      }).success,
    ).toBe(true);
    expect(
      featurePointCostSchema.safeParse({
        featureCode: "/geo/article/create",
        points: 10,
      }).success,
    ).toBe(false);
  });
});
describe("保存视图与报表导出契约", () => {
  const scope = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
    brandId: "brand-1",
  };
  it("保存视图限制页面类型和筛选字段数量", async () => {
    const { createSavedViewSchema } = await import("./index");
    expect(
      createSavedViewSchema.safeParse({
        organizationId: scope.organizationId,
        name: "近七日",
        page: "answers",
        filters: { beginDate: "2026-09-01" },
      }).success,
    ).toBe(true);
    expect(
      createSavedViewSchema.safeParse({
        organizationId: scope.organizationId,
        name: "视图",
        page: "unknown",
        filters: {},
      }).success,
    ).toBe(false);
  });
  it("导出任务固化品牌与日期筛选并拒绝反向范围", async () => {
    const { createReportExportSchema } = await import("./index");
    expect(
      createReportExportSchema.safeParse({
        ...scope,
        reportType: "answers",
        beginDate: "2026-09-01",
        endDate: "2026-09-08",
      }).success,
    ).toBe(true);
    expect(
      createReportExportSchema.safeParse({
        ...scope,
        reportType: "answers",
        beginDate: "2026-09-08",
        endDate: "2026-09-01",
      }).success,
    ).toBe(false);
  });
});
describe("站内通知契约", () => {
  const scope = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
  };
  it("按规则类型约束范围和阈值", async () => {
    const { notificationRuleSchema } = await import("./index");
    expect(
      notificationRuleSchema.safeParse({
        ...scope,
        type: "low_credits",
        threshold: 1000,
      }).success,
    ).toBe(true);
    expect(
      notificationRuleSchema.safeParse({
        ...scope,
        type: "connection_failure",
        threshold: 21,
      }).success,
    ).toBe(false);
    expect(
      notificationRuleSchema.safeParse({
        ...scope,
        type: "metric_anomaly",
        brandId: "brand-1",
        metric: "score",
        threshold: 20,
        windowDays: 7,
      }).success,
    ).toBe(true);
    expect(
      notificationRuleSchema.safeParse({
        ...scope,
        type: "metric_anomaly",
        metric: "score",
        threshold: 20,
      }).success,
    ).toBe(false);
  });
  it("通知列表安全解析未读筛选和分页", async () => {
    const { notificationListQuerySchema } = await import("./index");
    expect(
      notificationListQuerySchema.parse({
        organizationId: scope.organizationId,
        unreadOnly: "true",
        page: "2",
      }),
    ).toMatchObject({ unreadOnly: true, page: 2, pageSize: 20 });
  });
});
describe("AnswerBit Key 范围契约", () => {
  const base = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamId: "team-1",
    permissions: ["/geo/base/dashboard"],
    apiKey: "answerbit-api-key-123456",
  };
  it("团队级 Key 禁止携带品牌，品牌级 Key 必须携带 BrandID", async () => {
    const { adminCreateAnswerBitCredentialSchema } = await import("./index");
    expect(
      adminCreateAnswerBitCredentialSchema.safeParse({
        ...base,
        scopeType: "team",
      }).success,
    ).toBe(true);
    expect(
      adminCreateAnswerBitCredentialSchema.safeParse({
        ...base,
        scopeType: "team",
        brandId: "brand-1",
      }).success,
    ).toBe(false);
    expect(
      adminCreateAnswerBitCredentialSchema.safeParse({
        ...base,
        scopeType: "brand",
      }).success,
    ).toBe(false);
    expect(
      adminCreateAnswerBitCredentialSchema.safeParse({
        ...base,
        scopeType: "brand",
        brandId: "brand-1",
      }).success,
    ).toBe(true);
  });
});

describe("发布渠道分页契约", () => {
  it("解析租户筛选、排序和分页，并限制单页数量", async () => {
    const { publicationChannelQuerySchema } = await import("./index");
    expect(
      publicationChannelQuerySchema.parse({
        page: "2",
        pageSize: "12",
        mediaType: "wemedia",
        maxPriceAmount: "5000",
        field1: "IT科技",
        field3: "北京",
        field9: "可发GEO排名",
        sort: "priceDesc",
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 12,
      mediaType: "wemedia",
      maxPriceAmount: 5000,
      field1: "IT科技",
      field3: "北京",
      field9: "可发GEO排名",
      sort: "priceDesc",
    });
    expect(
      publicationChannelQuerySchema.safeParse({ pageSize: "200" }).success,
    ).toBe(false);
  });
});

describe("通知筛选与并发保存契约", () => {
  it("规则替换必须携带有效原配置", async () => {
    const { notificationRuleReplaceSchema } = await import("./index");
    const rule = {
      organizationId,
      teamBindingId,
      type: "low_credits",
      threshold: 1000,
    };
    expect(notificationRuleReplaceSchema.safeParse(rule).success).toBe(false);
    expect(
      notificationRuleReplaceSchema.safeParse({ ...rule, expected: rule })
        .success,
    ).toBe(true);
    expect(
      notificationRuleReplaceSchema.safeParse({
        ...rule,
        expected: { ...rule, threshold: -1 },
      }).success,
    ).toBe(false);
  });
  it("查询支持单边日期，拒绝非法日期和反向区间，批量已读不接受页码", async () => {
    const { notificationListQuerySchema, notificationReadAllSchema } =
      await import("./index");
    expect(
      notificationListQuerySchema.parse({
        organizationId,
        type: "low_credits",
        severity: "critical",
        beginDate: "2026-09-01",
      }),
    ).toMatchObject({ page: 1, pageSize: 20, beginDate: "2026-09-01" });
    for (const patch of [
      { beginDate: "2026-02-30" },
      { beginDate: "2026-09-02", endDate: "2026-09-01" },
      { severity: "invalid" },
      { type: "invalid" },
    ]) {
      expect(
        notificationListQuerySchema.safeParse({ organizationId, ...patch })
          .success,
      ).toBe(false);
      expect(
        notificationReadAllSchema.safeParse({ organizationId, ...patch })
          .success,
      ).toBe(false);
    }
    expect(
      notificationReadAllSchema.safeParse({ organizationId, page: 2 }).success,
    ).toBe(false);
  });
});

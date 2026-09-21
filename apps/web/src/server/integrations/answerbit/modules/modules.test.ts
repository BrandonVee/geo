import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBrandUpdatePayload,
  createBrand,
  createBrandBundle,
  deleteBrand,
  getBrandDetail,
  updateBrand,
  updateBrandIcon,
} from "./brands";
import { queryCompetitors } from "./competitors";
import { queryDashboardMetrics, queryExposureTrends } from "./dashboard";
import { queryPromptGroups, queryTitles } from "./prompts";
import { queryTaskDetail } from "./insights";
import { getArticleContent, queryArticles, traceArticle } from "./articles";
import {
  purchaseQuota,
  queryBillingLogs,
  queryBillingUsage,
  queryCreditBills,
  queryCreditRank,
  queryCreditStatus,
  queryCreditTrend,
  queryCreditUsage,
  queryQuotaOverrides,
  querySubscription,
} from "./billing";

afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, msg: "ok", data }), { status: 200 });
describe("AnswerBit 品牌写入模块", () => {
  it("按腾讯更新契约保留官方字段并规范空选填项", () => {
    expect(
      buildBrandUpdatePayload({
        brandId: "brand-1",
        brandName: " 爱家洗地机 ",
        brandAlias: "",
        website: "",
        description: "",
        note: "",
        websiteAutoTrace: false,
        defaultLanguage: "zh-CN",
        shopKeyWords: ["洗地机"],
      }),
    ).toEqual({
      id: "brand-1",
      brand_name: "爱家洗地机",
      default_language: "zh-CN",
      website: [],
      website_auto_trace: false,
      shop_key_words: ["洗地机"],
    });
  });
  it("新建品牌实际请求腾讯官方接口并使用返回 ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ id: 987 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createBrand(
        "key",
        {
          team_id: "team-1",
          brand: "腾讯品牌",
          website: "https://example.com",
        },
        "request",
      ),
    ).resolves.toEqual({ id: "987" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://answerbit.qq.com/geo/brand/create",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      team_id: "team-1",
      brand: "腾讯品牌",
      website: "https://example.com",
    });
  });
  it("批量初始化品牌、问题和竞品时调用 bundle 接口", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        brand: { id: 988, brand_name: "腾讯品牌" },
        prompts: [{ prompt_id: 1, question: "值得买吗" }],
        competitors: [{ competitor_id: 2, name: "竞品" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createBrandBundle(
        "key",
        {
          team_id: "team-1",
          brand: { brand_name: "腾讯品牌" },
          user_prompts: [{ question: "值得买吗" }],
          competitors: [{ name: "竞品" }],
        },
        "request",
      ),
    ).resolves.toMatchObject({
      brand: { id: "988" },
      prompts: [{ prompt_id: "1" }],
      competitors: [{ competitor_id: "2" }],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://answerbit.qq.com/geo/brand/bundle/create",
    );
  });
  it("修改品牌实际请求腾讯官方接口", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    await updateBrand(
      "key",
      {
        id: "brand-1",
        brand_name: "更新名称",
        brand_alias: "别名",
        default_language: "zh-CN",
        website: ["https://example.com"],
        description: "描述",
        note: "备注",
        website_auto_trace: true,
        shop_key_words: ["关键词"],
      },
      "request",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://answerbit.qq.com/geo/brand/update",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      id: "brand-1",
      brand_name: "更新名称",
      brand_alias: "别名",
      default_language: "zh-CN",
      website: ["https://example.com"],
      description: "描述",
      note: "备注",
      website_auto_trace: true,
      shop_key_words: ["关键词"],
    });
  });
  it("读取品牌详情并规范腾讯字段", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        id: 42,
        brand_name: "腾讯品牌",
        alias: null,
        belong_team_id: 7,
        website: ["https://example.com"],
        description: null,
        note: null,
        website_auto_trace: true,
        default_language: "zh-CN",
        shop_key_words: ["关键词"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBrandDetail("key", "42", "request")).resolves.toEqual(
      expect.objectContaining({
        id: "42",
        alias: "",
        belong_team_id: "7",
        website: ["https://example.com"],
        description: "",
        note: "",
        default_language: "zh-CN",
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      id: "42",
    });
  });
  it("更新品牌 Logo 并返回腾讯图片地址", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ icon_url: "https://static.test/logo.png" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      updateBrandIcon(
        "key",
        { brand_id: "brand-1", mime_type: "image/png", data: "base64" },
        "request",
      ),
    ).resolves.toEqual({ icon_url: "https://static.test/logo.png" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://answerbit.qq.com/geo/brand/update/icon",
    );
  });
  it("删除品牌实际请求腾讯官方接口", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    await deleteBrand("key", "brand-1", "request");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://answerbit.qq.com/geo/brand/delete",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      id: "brand-1",
    });
  });
});
describe("AnswerBit 竞品与概览模块", () => {
  it("统一竞品 ID 并补齐空别名", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response([
          {
            competitor_id: 42,
            competitor_name: "示例",
            competitor_alias: null,
          },
        ]),
      ),
    );
    await expect(queryCompetitors("key", "brand", "request")).resolves.toEqual([
      { id: "42", name: "示例", alias: "" },
    ]);
  });
  it("验证核心指标结构", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          exposure: { value: 10, fluctuation: 1 },
          avg_rank: { value: 2, fluctuation: -1 },
          score: { value: 80, fluctuation: 2 },
        }),
      ),
    );
    const data = await queryDashboardMetrics(
      "key",
      { brand_id: "brand", begin_date: "2026-09-01", end_date: "2026-09-08" },
      "request",
    );
    expect(data.exposure.value).toBe(10);
  });
  it("拒绝缺失每日统计字段的趋势响应", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          brand_statistics: [{ date: "2026-09-01", exposure: 10 }],
          competitor_statistics: [],
        }),
      ),
    );
    await expect(
      queryExposureTrends(
        "key",
        { brand_id: "brand", begin_date: "2026-09-01", end_date: "2026-09-08" },
        "request",
      ),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("兼容趋势响应中字符串格式的任务数", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          brand_statistics: [
            {
              date: "2026-09-01",
              exposure: 10,
              avg_rank: 2,
              task_count: "25",
            },
          ],
          competitor_statistics: [
            {
              competitor_id: "competitor",
              name: "竞品",
              statistics: [
                {
                  date: "2026-09-01",
                  exposure: 20,
                  avg_rank: 3,
                  task_count: "30",
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(
      queryExposureTrends(
        "key",
        { brand_id: "brand", begin_date: "2026-09-01", end_date: "2026-09-08" },
        "request",
      ),
    ).resolves.toMatchObject({
      brand_statistics: [{ task_count: 25 }],
      competitor_statistics: [{ statistics: [{ task_count: 30 }] }],
    });
  });
});
describe("AnswerBit 文章模块", () => {
  it("解析追踪接口返回的纯文章 ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(987)));
    await expect(
      traceArticle(
        "key",
        {
          brand_id: "brand",
          title: "文章",
          urls: ["https://example.com"],
          language: "zh-CN",
        },
        "request",
      ),
    ).resolves.toBe("987");
  });
  it("解析滚动分页文章列表", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ list: [], scroll_id: null, total: 0, total_links: 0 }),
        ),
    );
    await expect(
      queryArticles("key", { brand_id: "brand", limit: 20 }, "request"),
    ).resolves.toMatchObject({ scroll_id: "", total: 0 });
  });
  it("兼容文章列表中的字符串计数字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          list: [
            {
              id: "article-1",
              brand_id: "brand",
              title: "文章",
              status: 1,
              source: 1,
              template_type: 2,
              ref_count: "3",
              fluctuation: 0,
              ref_trends: [{ date: "2026-09-17", count: "2" }],
              published_platforms: [],
            },
          ],
          scroll_id: "article-1",
          total: "1",
          total_links: "3",
        }),
      ),
    );
    await expect(
      queryArticles("key", { brand_id: "brand", limit: 20 }, "request"),
    ).resolves.toMatchObject({
      list: [
        {
          ref_count: 3,
          ref_trends: [{ count: 2 }],
        },
      ],
      total: 1,
      total_links: 3,
    });
  });
  it("校验生成文章正文", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          article_id: "a1",
          brand_id: "brand",
          title: "标题",
          main_body: "正文",
          status: 1,
          template_type: 2,
          source: 1,
          language: "zh-CN",
          tags: [],
        }),
      ),
    );
    const data = await getArticleContent("key", "brand", "a1", "request");
    expect(data.main_body).toBe("正文");
  });
});
describe("AnswerBit 问题与回答模块", () => {
  it("解析分类 ID 与空描述", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response([
          {
            id: 9,
            brand_id: 1,
            title_name: "决策",
            title_desc: null,
            count: 2,
          },
        ]),
      ),
    );
    await expect(
      queryTitles("key", { brand_id: "1" }, "request"),
    ).resolves.toMatchObject([{ id: "9", title_desc: "" }]);
  });
  it("校验问题分组分页结构", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ titles: [], total: 0, total_prompts: 0 }),
        ),
    );
    await expect(
      queryPromptGroups(
        "key",
        { brand_id: "1", group_type: 1, page: 1, page_size: 20 },
        "request",
      ),
    ).resolves.toMatchObject({ total_prompts: 0 });
  });
  it("兼容问题分组中的生产日期和平均得分字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          titles: [
            {
              title_id: "title-1",
              title_name: "购买决策",
              title_desc: "",
              prompt_count: 1,
              exposure: 20,
              fluctuation: 1,
              avg_rank: 2,
              daily_avg_score: [{ date: "2026-09-16", avg_score: 78 }],
              prompts: [
                {
                  id: "prompt-1",
                  query_str: "值得买吗",
                  status: 1,
                  exposure: 20,
                  avg_rank: 2,
                  daily_avg_score: [{ date: "2026-09-16", avg_score: 78 }],
                  title_id: "title-1",
                  title_name: "购买决策",
                  created_time: "2026-09-06",
                },
              ],
            },
          ],
          total: 1,
          total_prompts: 1,
        }),
      ),
    );
    const data = await queryPromptGroups(
      "key",
      { brand_id: "1", group_type: 1, page: 1, page_size: 20 },
      "request",
    );
    expect(data.titles[0]?.daily_avg_score[0]).toMatchObject({ score: 78 });
    expect(data.titles[0]?.prompts[0]).toMatchObject({
      created_time: "2026-09-06",
      daily_avg_score: [{ date: "2026-09-16", score: 78 }],
    });
  });
  it("回答详情保留引用证据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          query: "问题",
          query_id: "q1",
          score: 80,
          zone: "CN",
          language: "zh",
          exposure: 1,
          rank: 2,
          exposure_cnt: 1,
          llm_output: "回答",
          platform: "deepseek",
          date: "2026-09-08",
          links: [
            {
              index: 1,
              url: "https://example.com",
              title: "证据",
              source: 0,
              article_id: "",
            },
          ],
          title_name: "分类",
          title_id: "t1",
        }),
      ),
    );
    const data = await queryTaskDetail("key", "brand", "task", "request");
    expect(data.links[0]?.title).toBe("证据");
  });
});
describe("AnswerBit 计量模块", () => {
  it("九个官方计量接口均按文档路径和字段完成适配", async () => {
    const dataByPath: Record<string, unknown> = {
      "/geo/billing/report/usage": {
        plan: { valid_from: "1", valid_until: "2", quotas: [] },
        credit: { team_id: "team", total_amount: 800, used_amount: 200 },
      },
      "/geo/billing/subscription/get": {
        plan_id: "plan",
        plan_name: "专业版",
        tier: "pro",
        status: 1,
        started_at: "1",
        expired_at: "2",
        billing_period: 1,
        billing_amount: 12,
        current_cycle_start: "1",
        current_cycle_end: "2",
        is_trial: false,
      },
      "/geo/billing/credit/status": {
        team_id: "team",
        total_amount: 800,
        used_amount: 200,
        credit_details: [
          {
            credit_id: "credit",
            source_type: 1,
            total_amount: 800,
            used_amount: 200,
            expire_time: "2",
            status: 1,
          },
        ],
      },
      "/geo/billing/credit/usage": {
        period_start: "1",
        period_end: "2",
        total_credit_used: 20,
        total_quota_amount: 10,
        usages: [],
      },
      "/geo/billing/credit/trend": {
        period_start: "1",
        period_end: "2",
        trends: [],
      },
      "/geo/billing/credit/rank": [
        { brand_id: "brand", brand_name: "品牌", credit_used: 20 },
      ],
      "/geo/billing/credit/bills": {
        bills: [
          {
            bill_id: "bill",
            team_id: "team",
            bill_type: "生成文章",
            credit_change: -10,
            is_pending: false,
            created_time: "1",
            operator_name: "用户",
            brand_name: "品牌",
          },
        ],
        total: 1,
      },
      "/geo/billing/logs/list": {
        list: [
          {
            log_id: "log",
            action: "renew",
            action_text: "续费",
            message: "套餐续费",
            operator_name: "管理员",
            created_at: "1",
          },
        ],
        total: 1,
      },
      "/geo/billing/quota/override/list": {
        list: [
          {
            quota_type: "prompt_query",
            quota_limit: 100,
            reason: "临时扩容",
            created_at: "1",
            is_effective: true,
          },
        ],
        total: 1,
      },
    };
    const fetchMock = vi.fn().mockImplementation((url: URL | string) => {
      const path = new URL(String(url)).pathname;
      return Promise.resolve(response(dataByPath[path]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const period = {
      team_id: "team",
      brand_id: "brand",
      start_unix: 1,
      end_unix: 2,
      quota_types: ["prompt_query"],
    };
    const page = {
      team_id: "team",
      brand_id: "brand",
      page: 2,
      page_size: 20,
      keyword: "用户",
      start_time: 1,
      end_time: 2,
      status: 2,
    };
    const results = await Promise.all([
      queryBillingUsage(
        "key",
        { team_id: "team", brand_id: "brand" },
        "request",
      ),
      querySubscription("key", "team", "request"),
      queryCreditStatus("key", "team", "request"),
      queryCreditUsage("key", period, "request"),
      queryCreditTrend("key", period, "request"),
      queryCreditRank(
        "key",
        { team_id: "team", start_unix: 1, end_unix: 2 },
        "request",
      ),
      queryCreditBills("key", page, "request"),
      queryBillingLogs(
        "key",
        { team_id: "team", page: 2, page_size: 20, keyword: "用户" },
        "request",
      ),
      queryQuotaOverrides(
        "key",
        { team_id: "team", page: 2, page_size: 20 },
        "request",
      ),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(results[1]).toMatchObject({ plan_id: "plan", billing_amount: 12 });
    expect(results[1]).toMatchObject({ started_at: 1, expired_at: 2 });
    expect(results[2]).toMatchObject({ total_amount: 800, used_amount: 200 });
    expect(results[5]).toMatchObject([{ brand_id: "brand" }]);
    expect(results[6]).toMatchObject({ total: 1 });
    expect(results[7]).toMatchObject({ total: 1 });
    expect(results[8]).toMatchObject({ total: 1 });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual(
      period,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[6]?.[1]?.body))).toEqual(
      page,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[7]?.[1]?.body))).toEqual({
      team_id: "team",
      page: 2,
      page_size: 20,
      keyword: "用户",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[8]?.[1]?.body))).toEqual({
      team_id: "team",
      page: 2,
      page_size: 20,
    });
  });

  it("校验周期额度与积分概况", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          plan: {
            valid_from: 1,
            valid_until: 2,
            quotas: [
              {
                quota_type: "article_generate",
                total_amount: 100,
                used_amount: 20,
                reset_time: 2,
              },
            ],
          },
          credit: { team_id: 99, total_amount: 1000, used_amount: 120 },
        }),
      ),
    );
    const data = await queryBillingUsage("key", { team_id: "team" }, "request");
    expect(data.credit.team_id).toBe("99");
  });
  it("保留按类型拆分的每日积分趋势", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          period_start: 1,
          period_end: 2,
          trends: [
            {
              date: "2026-09-08",
              quota_type: "prompt_query",
              quota_amount: 8,
              credit_used: 16,
            },
          ],
        }),
      ),
    );
    const data = await queryCreditTrend("key", { team_id: "team" }, "request");
    expect(data.trends[0]?.credit_used).toBe(16);
  });
  it("拒绝缺失流水冻结状态的响应", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          bills: [
            {
              bill_id: "b1",
              team_id: "t1",
              bill_type: "生成",
              credit_change: -10,
              created_time: 1,
              operator_name: "用户",
              brand_name: "品牌",
            },
          ],
          total: 1,
        }),
      ),
    );
    await expect(
      queryCreditBills("key", { team_id: "team" }, "request"),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("监控品牌扩容按官方请求体提交且成功时只调用一次", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    await purchaseQuota(
      "key",
      {
        team_id: "team",
        quota_type: "max_brand",
        quota_amount: 2,
      },
      "request",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://answerbit.qq.com/geo/billing/quota/purchase",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      team_id: "team",
      quota_type: "max_brand",
      quota_amount: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

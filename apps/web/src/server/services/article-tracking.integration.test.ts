import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { traceArticleSchema } from "@geo/contracts";
import {
  answerbitConnections,
  answerbitTeamBindings,
  articleTrackingSubmissions,
  answerbitArticleMappings,
  balanceAccounts,
  balanceTransactions,
  db,
  operationLogs,
  organizations,
  pool,
  recoverStaleTrackingSubmissions,
  users,
  withTenantDbContext,
} from "@geo/db";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  trace: vi.fn(),
  auditFailure: "",
  detail: vi.fn(),
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: vi.fn(),
}));
vi.mock("@/server/integrations/answerbit/context", () => ({
  loadAnswerBitTeamContext: mocks.context,
}));
vi.mock("@/server/integrations/answerbit/gateway", () => ({
  traceArticleLogged: mocks.trace,
  queryArticleTraceDetailLogged: mocks.detail,
}));
vi.mock("@/server/audit/write-audit", async (original) => {
  const actual = await original<typeof import("@/server/audit/write-audit")>();
  return {
    ...actual,
    writeAudit: async (...args: Parameters<typeof actual.writeAudit>) => {
      if (args[1].operation === mocks.auditFailure)
        throw new Error("QA audit failure");
      return actual.writeAudit(...args);
    },
  };
});
import { AnswerBitError } from "@/server/integrations/answerbit/errors";
import { getPointBilledFeatureQuote } from "./feature-billing";
import { articleTrackingService } from "./article-tracking";
import { articleService } from "./articles";
import { getSecretCipher } from "@/server/security/secret-cipher";

describe.skipIf(process.env.ARTICLE_TRACKING_DB_TESTS !== "1")(
  "效果追踪真实 PostgreSQL 提交恢复",
  () => {
    const userId = randomUUID();
    let input: ReturnType<typeof traceArticleSchema.parse>;
    const audit = () => ({
      organizationId: input.organizationId,
      actorUserId: userId,
      requestId: randomUUID(),
    });
    const create = (key: string, next = input, actor = userId) =>
      articleTrackingService.create(next, key, actor, randomUUID(), audit());
    const records = () =>
      db
        .select()
        .from(articleTrackingSubmissions)
        .where(
          eq(articleTrackingSubmissions.organizationId, input.organizationId),
        );
    const ledger = () =>
      db
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.organizationId, input.organizationId));
    const balance = async () =>
      (
        await db
          .select()
          .from(balanceAccounts)
          .where(
            and(
              eq(balanceAccounts.organizationId, input.organizationId),
              eq(balanceAccounts.brandId, input.brandId),
            ),
          )
      )[0].balance;
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Tracking QA requires disposable workflow database");
      await db.insert(users).values({
        id: userId,
        name: "tracking-qa",
        email: `${userId}@test.invalid`,
      });
    });
    beforeEach(async () => {
      mocks.auditFailure = "";
      mocks.trace.mockReset();
      mocks.trace.mockResolvedValue("article-qa");
      const organizationId = randomUUID(),
        teamBindingId = randomUUID(),
        brandId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "tracking-qa",
        slug: organizationId,
      });
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "qa",
          apiKeyFingerprint: randomUUID(),
          apiKeyHint: "qa",
          createdBy: userId,
        })
        .returning();
      await db.insert(answerbitTeamBindings).values({
        id: teamBindingId,
        organizationId,
        connectionId: connection.id,
        teamId: randomUUID(),
      });
      await db.insert(balanceAccounts).values({
        organizationId,
        brandId,
        asset: "answerbit_points",
        balance: 100,
      });
      mocks.context.mockResolvedValue({ connection, apiKey: "qa" });
      const pricing = await getPointBilledFeatureQuote(
        "effect_tracking",
        userId,
      );
      input = traceArticleSchema.parse({
        organizationId,
        teamBindingId,
        brandId,
        title: "公开文章",
        urls: ["https://example.com/article"],
        expectedPoints: pricing.points,
      });
    });
    afterAll(async () => {
      await pool.end();
    });

    it("成功响应丢失后同键返回原 ArticleID，只调用一次、扣一次且审计不重复", async () => {
      const key = randomUUID();
      const first = await create(key);
      const replay = await create(key, { ...input, expectedPoints: 999 });
      expect(first).toMatchObject({
        status: "succeeded",
        articleId: "article-qa",
        replayed: false,
        refunded: false,
      });
      expect(replay).toMatchObject({
        id: first.id,
        articleId: first.articleId,
        replayed: true,
        points: input.expectedPoints,
      });
      expect(mocks.trace).toHaveBeenCalledTimes(1);
      expect(await balance()).toBe(100 - input.expectedPoints);
      expect(await ledger()).toHaveLength(1);
      expect(await records()).toHaveLength(1);
      const audits = await db
        .select()
        .from(operationLogs)
        .where(eq(operationLogs.organizationId, input.organizationId));
      expect(audits.map((item) => item.operation).sort()).toEqual([
        "answerbit.article.trace",
        "answerbit.article.trace.submit",
      ]);
      expect((await records())[0].requestPayload.ciphertext).not.toContain(
        input.urls[0],
      );
    });
    it("并发同键在上游尚未返回时看到正在处理，不创建第二个上游请求", async () => {
      let release!: (articleId: string) => void, entered!: () => void;
      const ready = new Promise<void>((resolve) => (entered = resolve));
      mocks.trace.mockImplementation(() => {
        entered();
        return new Promise<string>((resolve) => (release = resolve));
      });
      const key = randomUUID(),
        first = create(key);
      await ready;
      try {
        const second = await create(key);
        expect(second.status).toBe("submitting");
        expect(await ledger()).toHaveLength(1);
        expect(mocks.trace).toHaveBeenCalledTimes(1);
      } finally {
        release("article-concurrent");
      }
      expect((await first).status).toBe("succeeded");
    });
    it.each([
      { title: "另一篇文章" },
      { brandId: "other" },
      { teamBindingId: randomUUID() },
      { language: "en-US" as const },
    ])("不同内容和范围不能复用原键 %j", async (change) => {
      const key = randomUUID();
      await create(key);
      await expect(create(key, { ...input, ...change })).rejects.toMatchObject({
        code: "ARTICLE_TRACKING_IDEMPOTENCY_CONFLICT",
      });
      expect(mocks.trace).toHaveBeenCalledTimes(1);
    });
    it("另一操作者不能确认原请求，也看不到原操作者的提交列表", async () => {
      const key = randomUUID();
      await create(key);
      await expect(create(key, input, randomUUID())).rejects.toMatchObject({
        code: "ARTICLE_TRACKING_IDEMPOTENCY_CONFLICT",
      });
      expect(
        await articleTrackingService.list(input, randomUUID(), audit()),
      ).toEqual([]);
    });
    it("报价变化和余额不足在调用上游前拒绝，事务不留下半成品", async () => {
      await expect(
        create(randomUUID(), {
          ...input,
          expectedPoints: input.expectedPoints + 1,
        }),
      ).rejects.toMatchObject({ code: "FEATURE_PRICE_CHANGED" });
      await db
        .update(balanceAccounts)
        .set({ balance: 0 })
        .where(eq(balanceAccounts.organizationId, input.organizationId));
      await expect(create(randomUUID())).rejects.toMatchObject({
        code: "ANSWERBIT_POINTS_INSUFFICIENT",
      });
      expect(await records()).toEqual([]);
      expect(await ledger()).toEqual([]);
      expect(mocks.trace).not.toHaveBeenCalled();
    });
    it("提交审计失败连同预扣一起回滚，原键可继续提交", async () => {
      mocks.auditFailure = "answerbit.article.trace.submit";
      const key = randomUUID();
      await expect(create(key)).rejects.toThrow("QA audit failure");
      expect(await records()).toEqual([]);
      expect(await ledger()).toEqual([]);
      expect(await balance()).toBe(100);
      mocks.auditFailure = "";
      expect((await create(key)).status).toBe("succeeded");
    });
    it("已获得 ArticleID 后映射审计失败，原键恢复本地结果且不退款或再次创建", async () => {
      mocks.auditFailure = "answerbit.article.trace";
      const key = randomUUID();
      await expect(create(key)).rejects.toThrow("QA audit failure");
      expect((await records())[0]).toMatchObject({
        articleId: "article-qa",
        status: "submitting",
      });
      expect(
        await db
          .select()
          .from(answerbitArticleMappings)
          .where(
            eq(answerbitArticleMappings.organizationId, input.organizationId),
          ),
      ).toEqual([]);
      mocks.auditFailure = "";
      const recovered = await recoverStaleTrackingSubmissions(
        new Date(),
        (record) =>
          traceArticleSchema.parse(
            JSON.parse(
              getSecretCipher().decrypt(
                record.requestPayload.ciphertext,
                record.organizationId,
              ),
            ),
          ),
      );
      expect(recovered.completed).toBe(1);
      expect((await create(key)).status).toBe("succeeded");
      expect(mocks.trace).toHaveBeenCalledTimes(1);
      expect(await ledger()).toHaveLength(1);
    });
    it.each(["business", "timeout", "invalid_response"] as const)(
      "上游 %s 返还原积分；同键重放不重新执行",
      async (kind) => {
        mocks.trace.mockRejectedValue(
          new AnswerBitError(kind, "/geo/article/trace/save"),
        );
        const key = randomUUID(),
          first = await create(key);
        expect(first).toMatchObject({
          status: kind === "business" ? "failed" : "uncertain",
          refunded: true,
          articleId: null,
        });
        expect((await create(key)).id).toBe(first.id);
        expect(mocks.trace).toHaveBeenCalledTimes(1);
        expect(await balance()).toBe(100);
        expect((await ledger()).map((item) => item.operation).sort()).toEqual([
          "consume",
          "restore",
        ]);
      },
    );
    it("中断恢复与迟到成功互斥，返还只一次；迟到结果保留原 ArticleID", async () => {
      let release!: (articleId: string) => void, entered!: () => void;
      const ready = new Promise<void>((resolve) => (entered = resolve));
      mocks.trace.mockImplementation(() => {
        entered();
        return new Promise<string>((resolve) => (release = resolve));
      });
      const key = randomUUID(),
        first = create(key);
      await ready;
      try {
        await db
          .update(articleTrackingSubmissions)
          .set({ updatedAt: new Date(Date.now() - 120_000) })
          .where(
            eq(articleTrackingSubmissions.organizationId, input.organizationId),
          );
        await Promise.all([
          recoverStaleTrackingSubmissions(),
          recoverStaleTrackingSubmissions(),
        ]);
        expect(await balance()).toBe(100);
        expect(await ledger()).toHaveLength(2);
      } finally {
        release("late-article");
      }
      expect(await first).toMatchObject({
        status: "succeeded",
        articleId: "late-article",
        refunded: true,
      });
      expect(await create(key)).toMatchObject({
        status: "succeeded",
        articleId: "late-article",
      });
      expect(mocks.trace).toHaveBeenCalledTimes(1);
    });
    it("文章详情必须属于当前品牌目录，不能通过共享 TeamID 查询其他品牌的 ArticleID", async () => {
      await create(randomUUID());
      mocks.detail.mockResolvedValue({
        stats: { total_count: 1 },
        trace_info: [],
      });
      await expect(
        articleService.traceDetail(
          "article-qa",
          { ...input, brandId: "other" },
          userId,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
      expect(mocks.detail).not.toHaveBeenCalled();
      expect(
        await articleService.traceDetail(
          "article-qa",
          input,
          userId,
          randomUUID(),
        ),
      ).toMatchObject({ stats: { total_count: 1 } });
      expect(mocks.detail).toHaveBeenCalledTimes(1);
    });
    it("新表租户 RLS 隔离读取和写入，平台角色授权由迁移提供", async () => {
      await create(randomUUID());
      const scope = { organizationId: input.organizationId, userId };
      const own = await withTenantDbContext(scope, (tx) =>
        tx.execute(sql`select id from article_tracking_submissions`),
      );
      expect(own.rows).toHaveLength(1);
      const other = await withTenantDbContext(
        { ...scope, organizationId: randomUUID() },
        (tx) => tx.execute(sql`select id from article_tracking_submissions`),
      );
      expect(other.rows).toEqual([]);
      const changed = await withTenantDbContext(
        { ...scope, organizationId: randomUUID() },
        (tx) =>
          tx.execute(
            sql`update article_tracking_submissions set error_code = 'qa' returning id`,
          ),
      );
      expect(changed.rows).toEqual([]);
    });
  },
);

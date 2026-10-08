import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  answerbitBrandMappings,
  answerbitConnections,
  answerbitTeamBindings,
  articleGenerationJobs,
  balanceAccounts,
  balanceTransactions,
  contentDocuments,
  db,
  operationLogs,
  organizationMembers,
  organizations,
  publicationChannels,
  publicationOrderContents,
  publicationOrders,
  users,
  withTenantDbContext,
} from "@geo/db";
import { publicationManuscriptSchema } from "@geo/contracts";
import { FrogPublicationError } from "@geo/publication";

const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  platform: vi.fn(),
  auditFailure: false,
  submit: vi.fn(),
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: m.authorize,
}));
vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: m.platform,
}));
vi.mock("@/server/integrations/frog-publication/configuration", () => ({
  resolveFrogPublicationClient: async () => ({
    configured: true,
    getBalance: async () => ({ money: "100000.00", power_count: 100 }),
    submit: m.submit,
  }),
}));
vi.mock("@/server/audit/write-audit", async (load) => {
  const actual = await load<typeof import("@/server/audit/write-audit")>();
  return {
    ...actual,
    writeAudit: (...args: Parameters<typeof actual.writeAudit>) => {
      if (m.auditFailure) throw new Error("AUDIT_UNAVAILABLE");
      return actual.writeAudit(...args);
    },
  };
});
import { publicationService } from "./publications";
import { publicationRepository } from "@/server/repositories/publications";

describe.skipIf(process.env.PUBLICATION_MANUSCRIPT_DB_TESTS !== "1")(
  "投稿原稿 PostgreSQL 原子事务回归",
  () => {
    const userId = randomUUID();
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-z0-9_]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Disposable QA database required");
      await db.insert(users).values({
        id: userId,
        name: "Manuscript QA",
        email: `${userId}@test.invalid`,
      });
    });
    beforeEach(() => {
      vi.clearAllMocks();
      m.auditFailure = false;
      m.submit.mockResolvedValue({ order_nid: "qa-order" });
    });
    async function fixture(provider: "manual" | "frog_media" = "manual") {
      const organizationId = randomUUID(),
        teamBindingId = randomUUID(),
        connectionId = randomUUID(),
        channelId = randomUUID(),
        brandId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "Manuscript QA",
        slug: organizationId,
      });
      await db.insert(organizationMembers).values({ organizationId, userId });
      await db.insert(answerbitConnections).values({
        id: connectionId,
        organizationId,
        encryptedApiKey: "unused",
        apiKeyFingerprint: "qa",
        apiKeyHint: "qa",
        createdBy: userId,
      });
      await db.insert(answerbitTeamBindings).values({
        id: teamBindingId,
        organizationId,
        connectionId,
        teamId: brandId,
      });
      await db.insert(answerbitBrandMappings).values({
        organizationId,
        teamBindingId,
        brandId,
        brandName: "Manuscript QA",
      });
      await db.insert(publicationChannels).values({
        id: channelId,
        name: "Manuscript QA",
        category: "test",
        priceAmount: 100,
        providerCostAmount: 100,
        provider,
        ...(provider === "frog_media"
          ? { providerResourceId: channelId, providerMediaType: "website" }
          : {}),
      });
      await db.insert(balanceAccounts).values({
        organizationId,
        brandId,
        asset: "publication_cny",
        balance: 1000,
      });
      return {
        organizationId,
        teamBindingId,
        brandId,
        channelId,
        title: "原始投稿标题",
        contentHtml: "<p>原始正文</p>",
        note: "原始投稿备注",
        idempotencyKey: randomUUID(),
      };
    }
    type Input = Awaited<ReturnType<typeof fixture>>;
    const audit = (input: Input) => ({
      organizationId: input.organizationId,
      actorUserId: userId,
      requestId: randomUUID(),
    });
    const create = (input: Input) =>
      publicationService.create(input, userId, audit(input));
    const read = (
      orderId: string,
      input: { organizationId: string; teamBindingId: string; brandId: string },
    ) => publicationService.manuscript(orderId, input, userId);
    async function evidence(input: Input) {
      const [orders, manuscripts, charges, logs, account] = await Promise.all([
        db
          .select()
          .from(publicationOrders)
          .where(eq(publicationOrders.organizationId, input.organizationId)),
        db
          .select()
          .from(publicationOrderContents)
          .where(
            eq(publicationOrderContents.organizationId, input.organizationId),
          ),
        db
          .select()
          .from(balanceTransactions)
          .where(eq(balanceTransactions.organizationId, input.organizationId)),
        db
          .select()
          .from(operationLogs)
          .where(eq(operationLogs.organizationId, input.organizationId)),
        db
          .select()
          .from(balanceAccounts)
          .where(eq(balanceAccounts.organizationId, input.organizationId)),
      ]);
      return {
        orders: orders.length,
        manuscripts: manuscripts.length,
        charges: charges.length,
        audits: logs.length,
        balance: account[0].balance,
      };
    }
    async function document(
      input: Input,
      body = "原稿 <内容>\n第二行",
      status: "ready" | "draft" = "ready",
    ) {
      const [doc] = await db
        .insert(contentDocuments)
        .values({
          organizationId: input.organizationId,
          teamBindingId: input.teamBindingId,
          brandId: input.brandId,
          createdBy: userId,
          updatedBy: userId,
          title: "文档标题",
          body,
          status,
          currentVersion: 3,
        })
        .returning();
      return doc;
    }

    it("并发同键只有一单、一份原稿、一次扣款和创建审计；接口不暴露内部指纹", async () => {
      const input = await fixture();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => create(input)),
      );
      expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(await evidence(input)).toEqual({
        orders: 1,
        manuscripts: 1,
        charges: 1,
        audits: 1,
        balance: 900,
      });
      const manuscript = await read(results[0].order.id, input);
      expect(publicationManuscriptSchema.safeParse(manuscript).success).toBe(
        true,
      );
      expect(manuscript).toMatchObject({
        snapshotStatus: "available",
        contentHtml: input.contentHtml,
        submissionNote: input.note,
        title: input.title,
        source: { kind: "inline_html" },
      });
      expect(manuscript).not.toHaveProperty("creationFingerprint");
      expect(results[0]).not.toHaveProperty("manuscript");
      const page = await publicationRepository.orderPage({
        ...input,
        userId,
        page: 1,
        pageSize: 20,
      });
      expect(page.list[0].order).not.toHaveProperty("contentHtml");
      expect(page.list[0].order).not.toHaveProperty("creationFingerprint");
      expect(
        await publicationService.adminManuscript(results[0].order.id, userId),
      ).toEqual(manuscript);
    });
    it.each(["contentHtml", "note", "title"] as const)(
      "相同键变更 %s 返回冲突且不再扣款",
      async (field) => {
        const input = await fixture();
        await create(input);
        await expect(
          create({ ...input, [field]: "已改变" }),
        ).rejects.toMatchObject({ code: "PUBLICATION_IDEMPOTENCY_CONFLICT" });
        expect((await evidence(input)).charges).toBe(1);
      },
    );
    it("审计失败回滚扣款、订单和原稿；同一原键可重新提交", async () => {
      const input = await fixture("frog_media");
      m.auditFailure = true;
      await expect(create(input)).rejects.toThrow("AUDIT_UNAVAILABLE");
      expect(await evidence(input)).toEqual({
        orders: 0,
        manuscripts: 0,
        charges: 0,
        audits: 0,
        balance: 1000,
      });
      expect(m.submit).not.toHaveBeenCalled();
      m.auditFailure = false;
      await create(input);
      expect(m.submit).toHaveBeenCalledTimes(1);
    });
    it("原稿约束拒绝写入时，已执行的扣款和订单插入整体回滚", async () => {
      const input = await fixture("frog_media");
      // Bypass the HTTP contract to exercise a database constraint after the debit.
      await expect(
        create({ ...input, note: "x".repeat(2001) }),
      ).rejects.toThrow();
      expect(await evidence(input)).toEqual({
        orders: 0,
        manuscripts: 0,
        charges: 0,
        audits: 0,
        balance: 1000,
      });
      expect(m.submit).not.toHaveBeenCalled();
      expect(await create(input)).toMatchObject({ replayed: false });
    });
    it("来源文档在投稿事务内保存版本和正文；修改归档与履约说明均不改变原稿或幂等确认", async () => {
      const base = await fixture(),
        doc = await document(base);
      const input = {
        ...base,
        contentHtml: undefined,
        sourceDocumentId: doc.id,
      };
      const result = await publicationService.create(
        input,
        userId,
        audit(base),
      );
      await db
        .update(contentDocuments)
        .set({ body: "后续新内容", currentVersion: 4, status: "archived" })
        .where(eq(contentDocuments.id, doc.id));
      await publicationRepository.updateOrder({
        orderId: result.order.id,
        status: "processing",
        note: "运营处理备注",
        processedBy: userId,
      });
      await db
        .update(publicationOrders)
        .set({
          title: "后续订单标题",
          contentUrl: "https://example.test/later",
        })
        .where(eq(publicationOrders.id, result.order.id));
      await db
        .update(publicationChannels)
        .set({ status: "inactive" })
        .where(eq(publicationChannels.id, base.channelId));
      expect(
        await publicationService.create(input, userId, audit(base)),
      ).toMatchObject({ replayed: true, order: { id: result.order.id } });
      expect(await read(result.order.id, base)).toMatchObject({
        title: base.title,
        contentUrl: null,
        contentHtml: "<p>原稿 &lt;内容&gt;<br />第二行</p>",
        submissionNote: base.note,
        source: { kind: "document", documentId: doc.id, documentVersion: 3 },
      });
      expect((await evidence(base)).charges).toBe(1);
    });
    it("成功生成任务按完整范围保存正文；未完成任务不能下单", async () => {
      const base = await fixture();
      const [job] = await db
        .insert(articleGenerationJobs)
        .values({
          organizationId: base.organizationId,
          teamBindingId: base.teamBindingId,
          brandId: base.brandId,
          requestedBy: userId,
          idempotencyKey: randomUUID(),
          status: "succeeded",
          articleBody: "生成正文",
        })
        .returning();
      const result = await publicationService.create(
        { ...base, contentHtml: undefined, sourceJobId: job.id },
        userId,
        audit(base),
      );
      expect(await read(result.order.id, base)).toMatchObject({
        contentHtml: "<p>生成正文</p>",
        source: { kind: "generated", jobId: job.id },
      });
      await db
        .update(articleGenerationJobs)
        .set({ status: "queued" })
        .where(eq(articleGenerationJobs.id, job.id));
      await expect(
        publicationService.create(
          {
            ...base,
            idempotencyKey: randomUUID(),
            contentHtml: undefined,
            sourceJobId: job.id,
          },
          userId,
          audit(base),
        ),
      ).rejects.toMatchObject({ code: "PUBLICATION_SOURCE_NOT_READY" });
    });
    it("正文缺失、非法链接、超长正文及未定稿或其他企业来源不留下半成品", async () => {
      const base = await fixture(),
        other = await fixture(),
        doc = await document(other),
        draft = await document(base, "draft", "draft");
      for (const variant of [
        { contentHtml: undefined },
        { contentHtml: undefined, contentUrl: "javascript:alert(1)" },
        { contentHtml: "x".repeat(500001) },
        { contentHtml: undefined, sourceDocumentId: doc.id },
        { contentHtml: undefined, sourceDocumentId: draft.id },
      ])
        await expect(
          publicationService.create(
            { ...base, ...variant },
            userId,
            audit(base),
          ),
        ).rejects.toMatchObject({ status: 422 });
      expect(await evidence(base)).toEqual({
        orders: 0,
        manuscripts: 0,
        charges: 0,
        audits: 0,
        balance: 1000,
      });
    });
    it("人工链接稿可读，聚合渠道拒绝仅链接；零元订单也保存原稿", async () => {
      const base = await fixture();
      await db
        .update(publicationChannels)
        .set({ priceAmount: 0 })
        .where(eq(publicationChannels.id, base.channelId));
      const result = await publicationService.create(
        {
          ...base,
          contentHtml: undefined,
          contentUrl: "https://example.test/original",
        },
        userId,
        audit(base),
      );
      expect(await read(result.order.id, base)).toMatchObject({
        source: { kind: "url" },
        contentHtml: null,
        contentUrl: "https://example.test/original",
      });
      expect(await evidence(base)).toEqual({
        orders: 1,
        manuscripts: 1,
        charges: 0,
        audits: 1,
        balance: 1000,
      });
      const frog = await fixture("frog_media");
      await expect(
        publicationService.create(
          {
            ...frog,
            contentHtml: undefined,
            contentUrl: "https://example.test/original",
          },
          userId,
          audit(frog),
        ),
      ).rejects.toMatchObject({ code: "PUBLICATION_CONTENT_REQUIRED" });
    });
    it("聚合投稿正文等于已保存原稿；响应超时后确认不再投稿", async () => {
      const input = await fixture("frog_media");
      m.submit.mockRejectedValue(
        new FrogPublicationError("timeout", "send", "timeout"),
      );
      await expect(create(input)).rejects.toMatchObject({
        code: "FROG_PUBLICATION_RESULT_UNCERTAIN",
      });
      const result = await create(input);
      const manuscript = await read(result.order.id, input);
      expect(m.submit).toHaveBeenCalledTimes(1);
      expect(m.submit).toHaveBeenCalledWith(
        "website",
        expect.objectContaining({
          content: manuscript.contentHtml,
          title: manuscript.title,
          remark: manuscript.submissionNote,
        }),
      );
      expect(result.replayed).toBe(true);
      expect((await evidence(input)).charges).toBe(1);
    });
    it("租户RLS与品牌、绑定条件阻止越界读取，权限拒绝不读取稿件", async () => {
      const input = await fixture(),
        other = await fixture(),
        result = await create(input);
      await expect(read(result.order.id, other)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        read(result.order.id, { ...input, brandId: "other" }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        read(result.order.id, { ...input, teamBindingId: other.teamBindingId }),
      ).rejects.toMatchObject({ status: 404 });
      const foreign = await withTenantDbContext({ ...other, userId }, (tx) =>
        tx
          .select()
          .from(publicationOrderContents)
          .where(eq(publicationOrderContents.orderId, result.order.id)),
      );
      expect(foreign).toHaveLength(0);
      m.authorize.mockRejectedValueOnce(new Error("DENIED"));
      await expect(read(result.order.id, input)).rejects.toThrow("DENIED");
    });
    it("历史订单明确缺失快照，不返回当前文档或覆盖后的运营备注", async () => {
      const input = await fixture(),
        doc = await document(input);
      const [legacy] = await db
        .insert(publicationOrders)
        .values({
          organizationId: input.organizationId,
          brandId: input.brandId,
          channelId: input.channelId,
          title: input.title,
          note: "已改运营备注",
          contentUrl: "javascript:alert(1)",
          sourceDocumentId: doc.id,
          priceAmount: 100,
          createdBy: userId,
          idempotencyKey: randomUUID(),
        })
        .returning();
      expect(await read(legacy.id, input)).toMatchObject({
        snapshotStatus: "legacy_unavailable",
        contentHtml: null,
        contentUrl: null,
        submissionNote: null,
        source: { kind: "document", documentId: doc.id },
      });
    });
    it("数据库禁止改写和删除原稿证据", async () => {
      const input = await fixture(),
        result = await create(input);
      await expect(
        db
          .update(publicationOrderContents)
          .set({ contentHtml: "changed" })
          .where(eq(publicationOrderContents.orderId, result.order.id)),
      ).rejects.toThrow();
      await expect(
        db
          .delete(publicationOrderContents)
          .where(eq(publicationOrderContents.orderId, result.order.id)),
      ).rejects.toThrow();
      expect(await read(result.order.id, input)).toMatchObject({
        contentHtml: input.contentHtml,
      });
    });
    it("数据库 INSERT 拒绝错配订单范围、标题和来源；文档版本必须存在", async () => {
      const input = await fixture(),
        other = await fixture(),
        doc = await document(input);
      const [order] = await db
        .insert(publicationOrders)
        .values({
          organizationId: input.organizationId,
          brandId: input.brandId,
          channelId: input.channelId,
          title: input.title,
          note: input.note,
          sourceDocumentId: doc.id,
          priceAmount: 100,
          createdBy: userId,
          idempotencyKey: randomUUID(),
        })
        .returning();
      const snapshot: typeof publicationOrderContents.$inferInsert = {
        orderId: order.id,
        organizationId: input.organizationId,
        teamBindingId: input.teamBindingId,
        brandId: input.brandId,
        title: input.title,
        submissionNote: input.note,
        sourceKind: "document",
        sourceDocumentId: doc.id,
        sourceDocumentVersion: 3,
        contentHtml: "<p>原稿</p>",
        creationFingerprint: "a".repeat(64),
      };
      for (const mismatch of [
        { orderId: randomUUID() },
        { organizationId: other.organizationId },
        { teamBindingId: other.teamBindingId },
        { brandId: other.brandId },
        { title: "另一篇原稿" },
        { sourceDocumentId: randomUUID() },
      ]) {
        const error = await db
          .insert(publicationOrderContents)
          .values({ ...snapshot, ...mismatch })
          .then(
            () => null,
            (cause: unknown) => cause as { cause: { message: string } },
          );
        expect(error?.cause.message).toBe("PUBLICATION_CONTENT_SCOPE_MISMATCH");
      }
      await expect(
        db.insert(publicationOrderContents).values({
          ...snapshot,
          sourceDocumentVersion: null,
        }),
      ).rejects.toThrow();
      await db.insert(publicationOrderContents).values(snapshot);
      await expect(
        db.delete(publicationOrders).where(eq(publicationOrders.id, order.id)),
      ).rejects.toThrow();
    });
    it("余额不足不保存原稿、订单与审计", async () => {
      const input = await fixture();
      await db
        .update(balanceAccounts)
        .set({ balance: 0 })
        .where(
          and(
            eq(balanceAccounts.organizationId, input.organizationId),
            eq(balanceAccounts.asset, "publication_cny"),
          ),
        );
      await expect(create(input)).rejects.toMatchObject({
        code: "PUBLICATION_BALANCE_INSUFFICIENT",
      });
      expect(await evidence(input)).toEqual({
        orders: 0,
        manuscripts: 0,
        charges: 0,
        audits: 0,
        balance: 0,
      });
    });
  },
);

import { randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  users,
  organizations,
  publicationChannels,
  publicationOrders,
  balanceAccounts,
  balanceTransactions,
  operationLogs,
  beginPublicationAction,
  recordPublicationProviderSnapshot,
  updatePublicationOrder,
  listPendingProviderPublicationOrders,
} from "@geo/db";
import {
  FrogPublicationError,
  reconcilePublicationOrders,
} from "@geo/publication";
const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  appeal: vi.fn(),
  client: vi.fn(),
  auditFailure: "",
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: vi.fn(),
}));
vi.mock("@/server/integrations/frog-publication/configuration", () => ({
  resolveFrogPublicationClient: mocks.client,
}));
vi.mock("@/server/audit/write-audit", async (load) => {
  const actual = await load<typeof import("@/server/audit/write-audit")>();
  return {
    ...actual,
    writeAudit: (...args: Parameters<typeof actual.writeAudit>) => {
      if (args[1].operation === mocks.auditFailure)
        throw new Error("audit unavailable");
      return actual.writeAudit(...args);
    },
  };
});
import { publicationService } from "./publications";
import { publicationRepository } from "@/server/repositories/publications";

describe.skipIf(process.env.PUBLICATION_ACTION_DB_TESTS !== "1")(
  "发布取消与申诉的多人 PostgreSQL 闭环",
  () => {
    const org = randomUUID(),
      other = randomUUID(),
      user = randomUUID(),
      second = randomUUID(),
      channel = randomUUID();
    const scope = {
      organizationId: org,
      teamBindingId: randomUUID(),
      brandId: "action-brand",
    };
    const audit = {
      organizationId: org,
      actorUserId: user,
      requestId: randomUUID(),
    };
    let orderId: string;
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error(
          "Publication action QA requires disposable workflow database",
        );
      await db.insert(users).values(
        [user, second].map((id) => ({
          id,
          name: "publication-action-qa",
          email: `${id}@test.invalid`,
        })),
      );
      await db.insert(organizations).values(
        [org, other].map((id) => ({
          id,
          slug: id,
          name: "publication-action-qa",
        })),
      );
      await db.insert(publicationChannels).values({
        id: channel,
        name: "action-channel",
        category: "test",
        priceAmount: 100,
        provider: "frog_media",
        providerMediaType: "website",
        providerResourceId: "resource",
      });
      await db.insert(balanceAccounts).values({
        organizationId: org,
        brandId: scope.brandId,
        asset: "publication_cny",
        balance: 900,
      });
    });
    beforeEach(async () => {
      vi.clearAllMocks();
      mocks.auditFailure = "";
      mocks.cancel.mockResolvedValue(null);
      mocks.appeal.mockResolvedValue(null);
      mocks.client.mockResolvedValue({
        configured: true,
        cancel: mocks.cancel,
        appeal: mocks.appeal,
      });
      orderId = randomUUID();
      await db.insert(publicationOrders).values({
        id: orderId,
        organizationId: org,
        brandId: scope.brandId,
        channelId: channel,
        title: "多人发布核对",
        createdBy: user,
        idempotencyKey: orderId,
        priceAmount: 100,
        status: "processing",
        providerOrderId: orderId,
        providerStatus: 1,
      });
      await db
        .update(balanceAccounts)
        .set({ balance: 900 })
        .where(eq(balanceAccounts.organizationId, org));
    });
    afterAll(async () => {
      await pool.end();
    });
    const read = async () =>
      (
        await db
          .select()
          .from(publicationOrders)
          .where(eq(publicationOrders.id, orderId))
      )[0];
    const refunds = () =>
      db
        .select()
        .from(balanceTransactions)
        .where(
          and(
            eq(balanceTransactions.referenceId, orderId),
            eq(balanceTransactions.operation, "restore"),
          ),
        );
    const logs = () =>
      db
        .select()
        .from(operationLogs)
        .where(eq(operationLogs.resourceId, orderId));

    it("两位管理员的取消/申诉竞争只有一个上游请求，确认与返还只发生一次", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.cancel.mockImplementation(() => held);
      const first = publicationService.cancel(orderId, scope, user, audit);
      await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
      await expect(
        publicationService.cancel(orderId, scope, second, {
          ...audit,
          actorUserId: second,
        }),
      ).rejects.toMatchObject({
        code: "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      });
      await expect(
        publicationService.appeal(orderId, { ...scope, reason: 4 }, second, {
          ...audit,
          actorUserId: second,
        }),
      ).rejects.toMatchObject({
        code: "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      });
      expect(mocks.appeal).not.toHaveBeenCalled();
      release();
      await expect(first).resolves.toMatchObject({
        status: "cancelled",
        providerAction: { state: "completed", actorUserId: user },
      });
      await expect(
        publicationService.cancel(orderId, scope, second, {
          ...audit,
          actorUserId: second,
        }),
      ).resolves.toMatchObject({ status: "cancelled" });
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
      expect(await refunds()).toHaveLength(1);
      expect((await logs()).map((row) => row.operation).sort()).toEqual([
        "publication.order.action.started",
        "publication.order.cancelled",
      ]);
    });
    it("并发申诉只提交一次，售后重试返回原结果且不退款", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.appeal.mockImplementation(() => held);
      const first = publicationService.appeal(
        orderId,
        { ...scope, reason: 4, detail: "原申诉说明" },
        user,
        audit,
      );
      await vi.waitFor(() => expect(mocks.appeal).toHaveBeenCalledTimes(1));
      await expect(
        publicationService.appeal(orderId, { ...scope, reason: 2 }, second, {
          ...audit,
          actorUserId: second,
        }),
      ).rejects.toMatchObject({
        code: "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      });
      release();
      await first;
      await expect(
        publicationService.appeal(orderId, { ...scope, reason: 4 }, second, {
          ...audit,
          actorUserId: second,
        }),
      ).resolves.toMatchObject({
        providerStatus: 9,
        providerAction: { detail: "原申诉说明", state: "completed" },
      });
      expect(mocks.appeal).toHaveBeenCalledTimes(1);
      expect(await refunds()).toHaveLength(0);
    });
    it("超时跨管理员仍不重发，核对解除不退款，新的明确取消才返还", async () => {
      mocks.cancel.mockRejectedValueOnce(
        new FrogPublicationError("timeout", "cancel", "timeout"),
      );
      await expect(
        publicationService.cancel(orderId, scope, user, audit),
      ).rejects.toMatchObject({ status: 504 });
      const action = (await read()).providerAction!;
      expect(action.state).toBe("uncertain");
      await expect(
        publicationService.cancel(orderId, scope, second, {
          ...audit,
          actorUserId: second,
        }),
      ).rejects.toMatchObject({
        code: "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      });
      await publicationService.resolveAction(
        orderId,
        { ...scope, actionId: action.id, note: "已核对上游尚未取消" },
        second,
        { ...audit, actorUserId: second },
      );
      expect(await refunds()).toHaveLength(0);
      expect((await read()).providerAction).toMatchObject({
        state: "released",
        resolvedBy: second,
      });
      await publicationService.cancel(orderId, scope, second, {
        ...audit,
        actorUserId: second,
      });
      expect(mocks.cancel).toHaveBeenCalledTimes(2);
      expect(await refunds()).toHaveLength(1);
      await expect(
        updatePublicationOrder({
          orderId,
          expectedActionId: action.id,
          status: "cancelled",
          processedBy: user,
        }),
      ).resolves.toBeNull();
      expect((await read()).providerAction?.id).not.toBe(action.id);
    });
    it("明确拒绝结束原操作，修改申诉说明后可提交新的操作", async () => {
      mocks.appeal.mockRejectedValueOnce(
        new FrogPublicationError("business", "appeal", "rejected"),
      );
      await expect(
        publicationService.appeal(
          orderId,
          { ...scope, reason: 4, detail: "原说明" },
          user,
          audit,
        ),
      ).rejects.toMatchObject({ status: 422 });
      const action = (await read()).providerAction!;
      expect(action.state).toBe("rejected");
      await publicationService.appeal(
        orderId,
        { ...scope, reason: 4, detail: "补充说明" },
        user,
        audit,
      );
      expect((await read()).providerAction).toMatchObject({
        state: "completed",
        detail: "补充说明",
      });
      expect((await read()).providerAction?.id).not.toBe(action.id);
      expect(mocks.appeal).toHaveBeenCalledTimes(2);
    });
    it("执行中的操作不能提前解除，超期记录保留到明确核对", async () => {
      const action = {
        id: randomUUID(),
        operation: "appeal" as const,
        state: "pending" as const,
        actorUserId: user,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        reason: 4 as const,
      };
      await beginPublicationAction({ ...scope, userId: user, orderId, action });
      await expect(
        publicationService.resolveAction(
          orderId,
          { ...scope, actionId: action.id, note: "未确认" },
          user,
          audit,
        ),
      ).rejects.toMatchObject({ code: "PUBLICATION_ACTION_IN_PROGRESS" });
      await db
        .update(publicationOrders)
        .set({
          providerAction: {
            ...action,
            expiresAt: new Date(Date.now() - 1).toISOString(),
          },
        })
        .where(eq(publicationOrders.id, orderId));
      await expect(
        publicationService.appeal(orderId, { ...scope, reason: 4 }, second, {
          ...audit,
          actorUserId: second,
        }),
      ).rejects.toMatchObject({
        code: "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      });
      await publicationService.resolveAction(
        orderId,
        { ...scope, actionId: action.id, note: "已核对上游记录" },
        user,
        audit,
      );
      expect(mocks.appeal).not.toHaveBeenCalled();
      expect((await read()).providerAction?.state).toBe("released");
    });
    it("旧核对记录与迟到响应不能改动新的操作", async () => {
      mocks.appeal.mockRejectedValueOnce(
        new FrogPublicationError("timeout", "appeal", "timeout"),
      );
      await expect(
        publicationService.appeal(
          orderId,
          { ...scope, reason: 4 },
          user,
          audit,
        ),
      ).rejects.toMatchObject({ status: 504 });
      const old = (await read()).providerAction!;
      await publicationService.resolveAction(
        orderId,
        { ...scope, actionId: old.id, note: "已核对" },
        user,
        audit,
      );
      const action = { ...old, id: randomUUID(), state: "pending" as const };
      await beginPublicationAction({ ...scope, userId: user, orderId, action });
      await expect(
        publicationService.resolveAction(
          orderId,
          { ...scope, actionId: old.id, note: "过期核对" },
          user,
          audit,
        ),
      ).rejects.toMatchObject({ code: "PUBLICATION_ACTION_CONFLICT" });
      await expect(
        recordPublicationProviderSnapshot({
          orderId,
          expectedActionId: old.id,
          providerStatus: 9,
        }),
      ).resolves.toBeUndefined();
      expect((await read()).providerAction?.id).toBe(action.id);
      expect((await read()).providerStatus).toBe(1);
    });
    it("准备阶段延迟后原操作已解除，旧执行不得再调用上游", async () => {
      let release!: (value: unknown) => void;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      mocks.client.mockReturnValueOnce(held);
      const first = publicationService.cancel(orderId, scope, user, audit);
      const rejected = expect(first).rejects.toMatchObject({
        code: "FROG_PUBLICATION_CANCEL_FAILED",
      });
      await vi.waitFor(() => expect(mocks.client).toHaveBeenCalledTimes(1));
      const action = (await read()).providerAction!;
      await db
        .update(publicationOrders)
        .set({
          providerAction: {
            ...action,
            expiresAt: new Date(Date.now() - 1).toISOString(),
          },
        })
        .where(eq(publicationOrders.id, orderId));
      await publicationService.resolveAction(
        orderId,
        { ...scope, actionId: action.id, note: "核对上游无取消记录" },
        second,
        { ...audit, actorUserId: second },
      );
      await publicationService.cancel(orderId, scope, second, {
        ...audit,
        actorUserId: second,
      });
      release({ configured: true, cancel: mocks.cancel, appeal: mocks.appeal });
      await rejected;
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
      expect(await refunds()).toHaveLength(1);
      expect((await read()).providerAction?.id).not.toBe(action.id);
    });
    it("发布已完成但申诉响应丢失时仍进入同步候选，售后状态只读确认", async () => {
      await db
        .update(publicationOrders)
        .set({
          status: "published",
          providerStatus: 2,
          resultUrl: "https://example.test/article",
        })
        .where(eq(publicationOrders.id, orderId));
      mocks.appeal.mockRejectedValueOnce(
        new FrogPublicationError("timeout", "appeal", "timeout"),
      );
      await expect(
        publicationService.appeal(
          orderId,
          { ...scope, reason: 4 },
          user,
          audit,
        ),
      ).rejects.toMatchObject({ status: 504 });
      const candidates = await listPendingProviderPublicationOrders();
      expect(candidates.some((row) => row.order.id === orderId)).toBe(true);
      await reconcilePublicationOrders(
        candidates.filter((row) => row.order.id === orderId),
        {
          configured: true,
          orderInfo: async () => [
            { order_nid: orderId, resource_id: "resource", status: 9 },
          ],
        },
        publicationRepository,
      );
      expect((await read()).providerAction?.state).toBe("completed");
      expect((await read()).status).toBe("published");
      expect(await refunds()).toHaveLength(0);
    });
    it("认领审计失败整体回滚且不调用上游", async () => {
      mocks.auditFailure = "publication.order.action.started";
      await expect(
        publicationService.cancel(orderId, scope, user, audit),
      ).rejects.toThrow("audit unavailable");
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect((await read()).providerAction).toBeNull();
    });
    it("确认审计失败回滚退款且保留待核对操作，重试不重复上游请求", async () => {
      mocks.auditFailure = "publication.order.cancelled";
      await expect(
        publicationService.cancel(orderId, scope, user, audit),
      ).rejects.toMatchObject({ code: "FROG_PUBLICATION_CANCEL_FAILED" });
      expect((await read()).status).toBe("processing");
      expect((await read()).providerAction?.state).toBe("uncertain");
      expect(await refunds()).toHaveLength(0);
      await expect(
        publicationService.cancel(orderId, scope, user, audit),
      ).rejects.toMatchObject({
        code: "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      });
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
    });
    it("核对与解除按企业和品牌隔离，解除审计失败保留原记录", async () => {
      mocks.cancel.mockRejectedValueOnce(
        new FrogPublicationError("timeout", "cancel", "timeout"),
      );
      await expect(
        publicationService.cancel(orderId, scope, user, audit),
      ).rejects.toMatchObject({ status: 504 });
      const action = (await read()).providerAction!;
      for (const wrong of [
        { ...scope, organizationId: other },
        { ...scope, brandId: "other-brand" },
      ])
        await expect(
          publicationService.resolveAction(
            orderId,
            { ...wrong, actionId: action.id, note: "隔离核对" },
            user,
            audit,
          ),
        ).rejects.toMatchObject({ code: "PUBLICATION_ORDER_NOT_FOUND" });
      mocks.auditFailure = "publication.order.action.resolved";
      await expect(
        publicationService.resolveAction(
          orderId,
          { ...scope, actionId: action.id, note: "审计失败" },
          user,
          audit,
        ),
      ).rejects.toThrow("audit unavailable");
      expect((await read()).providerAction?.state).toBe("uncertain");
    });
  },
);

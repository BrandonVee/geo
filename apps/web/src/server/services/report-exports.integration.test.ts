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
import { createReportExportSchema } from "@geo/contracts";
import {
  answerbitConnections,
  answerbitTeamBindings,
  billingPlanVersions,
  claimReportExport,
  commitQuota,
  db,
  operationLogs,
  organizations,
  platformSubscriptions,
  pool,
  quotaLedgers,
  releaseQuota,
  redeliverReportExport,
  reportExports,
  reserveQuota,
  subscriptionEntitlements,
  users,
} from "@geo/db";

// Keep the real repository, quota transactions, audit and pg-boss SQL.
// Permission policy has separate tests; this fixture isolates submission atomicity.
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: vi.fn(),
}));
const controls = vi.hoisted(() => ({
  afterEnqueue: undefined as undefined | ((id: string) => Promise<void>),
}));
vi.mock("@/server/jobs/boss", async (original) => {
  const actual = await original<typeof import("@/server/jobs/boss")>();
  return {
    ...actual,
    prepareReportExportQueue: async () => {
      const enqueue = await actual.prepareReportExportQueue();
      return async (...args: Parameters<typeof enqueue>) => {
        const id = await enqueue(...args);
        await controls.afterEnqueue?.(args[0].exportId);
        return id;
      };
    },
  };
});
import { getBoss, prepareReportExportQueue } from "@/server/jobs/boss";
import { reportExportService } from "./report-exports";

describe.skipIf(process.env.REPORT_EXPORT_DB_TESTS !== "1")(
  "报告提交 PostgreSQL / pg-boss 回归",
  () => {
    const userId = randomUUID();
    let input: ReturnType<typeof createReportExportSchema.parse>;
    let entitlementId: string;
    const audit = () => ({
      organizationId: input.organizationId,
      actorUserId: userId,
      requestId: randomUUID(),
    });
    const create = (key: string = randomUUID()) =>
      reportExportService.create(input, key, userId, audit());
    const counts = async () => {
      const [jobs, ledgers, audits, queue, [entitlement]] = await Promise.all([
        db
          .select()
          .from(reportExports)
          .where(eq(reportExports.organizationId, input.organizationId)),
        db
          .select()
          .from(quotaLedgers)
          .where(eq(quotaLedgers.organizationId, input.organizationId)),
        db
          .select()
          .from(operationLogs)
          .where(eq(operationLogs.organizationId, input.organizationId)),
        pool.query<{ count: number }>(
          "select count(*)::int as count from pgboss.job where name = 'report-export' and data->>'organizationId' = $1",
          [input.organizationId],
        ),
        db
          .select()
          .from(subscriptionEntitlements)
          .where(eq(subscriptionEntitlements.id, entitlementId)),
      ]);
      return {
        jobs: jobs.length,
        ledgers: ledgers.length,
        audits: audits.length,
        queue: queue.rows[0].count,
        reserved: entitlement?.reservedAmount ?? 0,
        used: entitlement?.usedAmount ?? 0,
      };
    };
    const legacy = async (key = randomUUID()) => {
      const { organizationId, teamBindingId, brandId, reportType, ...filters } =
        input;
      const [job] = await db
        .insert(reportExports)
        .values({
          organizationId,
          teamBindingId,
          brandId,
          reportType,
          filters,
          requestedBy: userId,
          idempotencyKey: key,
        })
        .returning();
      return job;
    };
    const reservation = (id: string) => ({
      organizationId: input.organizationId,
      entitlementKey: "report_exports",
      amount: 1,
      reference: { type: "report_export", id },
      idempotencyKey: `report:${id}:reserve`,
      actorUserId: userId,
    });

    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error(
          "Report QA requires scripts/test-operator-workflows.mjs and its disposable database",
        );
      await db.insert(users).values({
        id: userId,
        name: "report-qa",
        email: `${userId}@test.invalid`,
      });
      await prepareReportExportQueue();
    });
    beforeEach(async () => {
      controls.afterEnqueue = undefined;
      const organizationId = randomUUID(),
        teamBindingId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "report-qa",
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
      input = createReportExportSchema.parse({
        organizationId,
        teamBindingId,
        brandId: randomUUID(),
        reportType: "answers",
        beginDate: "2026-09-01",
        endDate: "2026-09-30",
        keyword: "报告",
        mentionBrand: 0,
      });
      const [version] = await db.select().from(billingPlanVersions).limit(1);
      const periodStart = new Date(Date.now() - 86_400_000),
        periodEnd = new Date(Date.now() + 86_400_000);
      const [subscription] = await db
        .insert(platformSubscriptions)
        .values({
          organizationId,
          planVersionId: version.id,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        })
        .returning();
      const [entitlement] = await db
        .insert(subscriptionEntitlements)
        .values({
          organizationId,
          subscriptionId: subscription.id,
          entitlementKey: "report_exports",
          limitAmount: 3,
          unit: "次",
          periodStart,
          periodEnd,
        })
        .returning();
      entitlementId = entitlement.id;
    });
    afterAll(async () => {
      controls.afterEnqueue = undefined;
      await getBoss().stop();
      const global = globalThis as typeof globalThis & {
        geoBoss?: unknown;
        geoBossStart?: unknown;
      };
      delete global.geoBoss;
      delete global.geoBossStart;
      await pool.end();
      // Audit and quota history are preserved until the runner drops the QA database.
    });

    it("队列初始化临时失败后下一次提交可恢复，无需重启应用", async () => {
      const global = globalThis as typeof globalThis & {
        geoBossStart?: unknown;
      };
      delete global.geoBossStart;
      const failure = vi
        .spyOn(getBoss(), "createQueue")
        .mockRejectedValueOnce(new Error("QA_QUEUE_TEMPORARILY_UNAVAILABLE"));
      try {
        await expect(prepareReportExportQueue()).rejects.toThrow(
          "QA_QUEUE_TEMPORARILY_UNAVAILABLE",
        );
      } finally {
        failure.mockRestore();
      }
      expect(await prepareReportExportQueue()).toBeTypeOf("function");
      expect(await create()).toMatchObject({
        status: "queued",
        replayed: false,
      });
    });

    it("提交完成前任务、额度、队列均不可见；并发同键只写一次", async () => {
      const key = randomUUID();
      let signal!: () => void, release!: () => void;
      const enqueued = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      controls.afterEnqueue = async () => {
        signal();
        await held;
      };
      const first = create(key);
      await enqueued;
      const second = create(key);
      try {
        expect(await counts()).toEqual({
          jobs: 0,
          ledgers: 0,
          audits: 0,
          queue: 0,
          reserved: 0,
          used: 0,
        });
        const fetched = await getBoss().fetch<{ organizationId: string }>(
          "report-export",
          { batchSize: 100 },
        );
        expect(
          fetched.some(
            (job) => job.data.organizationId === input.organizationId,
          ),
        ).toBe(false);
      } finally {
        release();
      }
      const results = await Promise.all([first, second]);
      expect(new Set(results.map((row) => row.id)).size).toBe(1);
      expect(results.filter((row) => !row.replayed)).toHaveLength(1);
      expect(await counts()).toEqual({
        jobs: 1,
        ledgers: 1,
        audits: 1,
        queue: 1,
        reserved: 1,
        used: 0,
      });
      expect(results[0]).not.toHaveProperty("fileContent");
      await expect(
        reportExportService.create(
          { ...input, keyword: "其他条件" },
          key,
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({ code: "REPORT_EXPORT_IDEMPOTENCY_CONFLICT" });
      await expect(
        reportExportService.create(input, key, randomUUID(), audit()),
      ).rejects.toMatchObject({ code: "REPORT_EXPORT_IDEMPOTENCY_CONFLICT" });
    });
    it("入队 SQL 成功后抛错也全部回滚；原键可以重新提交", async () => {
      const key = randomUUID();
      controls.afterEnqueue = async () => {
        throw new Error("QA_AFTER_ENQUEUE");
      };
      await expect(create(key)).rejects.toThrow("QA_AFTER_ENQUEUE");
      expect(await counts()).toEqual({
        jobs: 0,
        ledgers: 0,
        audits: 0,
        queue: 0,
        reserved: 0,
        used: 0,
      });
      controls.afterEnqueue = undefined;
      expect(await create(key)).toMatchObject({
        replayed: false,
        status: "queued",
      });
      expect(await counts()).toMatchObject({
        jobs: 1,
        ledgers: 1,
        queue: 1,
        reserved: 1,
      });
    });
    it("审计失败回滚报告、额度和真实队列，同键重试不重复占用", async () => {
      const key = randomUUID();
      await expect(
        reportExportService.create(input, key, userId, {
          ...audit(),
          requestId: "x".repeat(500),
        }),
      ).rejects.toThrow();
      expect(await counts()).toEqual({
        jobs: 0,
        ledgers: 0,
        audits: 0,
        queue: 0,
        reserved: 0,
        used: 0,
      });
      await create(key);
      expect(await counts()).toMatchObject({
        jobs: 1,
        ledgers: 1,
        audits: 1,
        queue: 1,
        reserved: 1,
      });
    });
    it("额度不足无半成品；补充额度后原键可重试", async () => {
      const key = randomUUID();
      await db
        .update(subscriptionEntitlements)
        .set({ limitAmount: 0 })
        .where(eq(subscriptionEntitlements.id, entitlementId));
      await expect(create(key)).rejects.toMatchObject({
        status: 402,
        code: "QUOTA_EXHAUSTED",
      });
      expect(await counts()).toMatchObject({
        jobs: 0,
        ledgers: 0,
        audits: 0,
        queue: 0,
        reserved: 0,
      });
      await db
        .update(subscriptionEntitlements)
        .set({ limitAmount: 1 })
        .where(eq(subscriptionEntitlements.id, entitlementId));
      await create(key);
      expect(await counts()).toMatchObject({ jobs: 1, reserved: 1 });
    });
    it("未配置报告权益时不创建任务，补配后同键可继续", async () => {
      const key = randomUUID();
      const [original] = await db
        .select()
        .from(subscriptionEntitlements)
        .where(eq(subscriptionEntitlements.id, entitlementId));
      await db
        .delete(subscriptionEntitlements)
        .where(eq(subscriptionEntitlements.id, entitlementId));
      await expect(create(key)).rejects.toMatchObject({
        status: 402,
        code: "ENTITLEMENT_NOT_FOUND",
      });
      expect(await counts()).toMatchObject({
        jobs: 0,
        ledgers: 0,
        audits: 0,
        queue: 0,
      });
      await db.insert(subscriptionEntitlements).values(original);
      expect(await create(key)).toMatchObject({
        status: "queued",
        replayed: false,
      });
    });

    it("不同键并发争用最后一个名额不能超额或留下空任务", async () => {
      await db
        .update(subscriptionEntitlements)
        .set({ limitAmount: 1 })
        .where(eq(subscriptionEntitlements.id, entitlementId));
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => create()),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({
            status: 402,
            code: "QUOTA_EXHAUSTED",
          });
      expect(await counts()).toEqual({
        jobs: 1,
        ledgers: 1,
        audits: 1,
        queue: 1,
        reserved: 1,
        used: 0,
      });
    });
    it("旧任务已有预占但缺少关联时，重试补全同一任务而不重复预占", async () => {
      const job = await legacy();
      await reserveQuota(reservation(job.id));
      const result = await create(job.idempotencyKey);
      expect(result).toMatchObject({
        id: job.id,
        replayed: true,
        quotaReservationKey: `report:${job.id}:reserve`,
      });
      expect(result.queueJobId).toBeTruthy();
      expect(await counts()).toEqual({
        jobs: 1,
        ledgers: 1,
        audits: 1,
        queue: 1,
        reserved: 1,
        used: 0,
      });
    });
    it("自动补投入队失败回滚预占；下次恢复只投递一次", async () => {
      const job = await legacy();
      const candidate = {
        organizationId: input.organizationId,
        exportId: job.id,
        expectedQueueJobId: null,
      };
      const enqueue = await prepareReportExportQueue();
      controls.afterEnqueue = async () => {
        throw new Error("RECOVERY_QUEUE_WRITE_FAILED");
      };
      await expect(redeliverReportExport(candidate, enqueue)).rejects.toThrow(
        "RECOVERY_QUEUE_WRITE_FAILED",
      );
      expect(await counts()).toMatchObject({
        jobs: 1,
        ledgers: 0,
        queue: 0,
        reserved: 0,
      });
      const [unchanged] = await db
        .select()
        .from(reportExports)
        .where(eq(reportExports.id, job.id));
      expect(unchanged).toMatchObject({
        status: "queued",
        quotaReservationKey: null,
        queueJobId: null,
      });
      controls.afterEnqueue = undefined;
      expect(await redeliverReportExport(candidate, enqueue)).toBe(true);
      expect(await redeliverReportExport(candidate, enqueue)).toBe(false);
      expect(await counts()).toMatchObject({
        jobs: 1,
        ledgers: 1,
        queue: 1,
        reserved: 1,
      });
    });
    it("并发补投已预占的旧任务只更换一次队列编号", async () => {
      const job = await legacy();
      const oldQueueJobId = randomUUID();
      await reserveQuota(reservation(job.id));
      await db
        .update(reportExports)
        .set({ queueJobId: oldQueueJobId })
        .where(eq(reportExports.id, job.id));
      const candidate = {
        organizationId: input.organizationId,
        exportId: job.id,
        expectedQueueJobId: oldQueueJobId,
      };
      const enqueue = await prepareReportExportQueue();
      const results = await Promise.all([
        redeliverReportExport(candidate, enqueue),
        redeliverReportExport(candidate, enqueue),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await counts()).toMatchObject({
        jobs: 1,
        ledgers: 1,
        queue: 1,
        reserved: 1,
      });
    });
    it("自动补投没有额度的旧任务明确失败而不入队", async () => {
      const job = await legacy();
      await db
        .update(subscriptionEntitlements)
        .set({ limitAmount: 0 })
        .where(eq(subscriptionEntitlements.id, entitlementId));
      expect(
        await redeliverReportExport(
          {
            organizationId: input.organizationId,
            exportId: job.id,
            expectedQueueJobId: null,
          },
          await prepareReportExportQueue(),
        ),
      ).toBe(false);
      expect(
        await reportExportService.get(job.id, input.organizationId, userId),
      ).toMatchObject({ status: "failed", errorCode: "QUOTA_EXHAUSTED" });
      expect(await counts()).toMatchObject({
        jobs: 1,
        ledgers: 0,
        queue: 0,
        reserved: 0,
      });
    });
    it("Worker 恢复旧预占关联并只领取一次；历史空操作人可恢复", async () => {
      const job = await legacy();
      await reserveQuota({ ...reservation(job.id), actorUserId: undefined });
      const claims = await Promise.all(
        [1, 2].map(() =>
          claimReportExport(
            { organizationId: input.organizationId, exportId: job.id },
            randomUUID(),
          ),
        ),
      );
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)).toMatchObject({
        status: "running",
        quotaReservationKey: `report:${job.id}:reserve`,
      });
      expect(await counts()).toMatchObject({
        jobs: 1,
        ledgers: 1,
        reserved: 1,
      });
    });
    it("旧任务根本没有预占流水时，领取与新预占在同一事务完成", async () => {
      const job = await legacy();
      const claimed = await claimReportExport(
        { organizationId: input.organizationId, exportId: job.id },
        randomUUID(),
      );
      expect(claimed).toMatchObject({
        status: "running",
        quotaReservationKey: `report:${job.id}:reserve`,
      });
      expect(await counts()).toMatchObject({
        reserved: 1,
        used: 0,
        ledgers: 1,
      });
    });

    it("旧任务没有额度时不会被 Worker 执行；页面可重新导出", async () => {
      const job = await legacy();
      await db
        .update(subscriptionEntitlements)
        .set({ limitAmount: 0 })
        .where(eq(subscriptionEntitlements.id, entitlementId));
      expect(
        await claimReportExport(
          { organizationId: input.organizationId, exportId: job.id },
          randomUUID(),
        ),
      ).toBeUndefined();
      const failed = await reportExportService.get(
        job.id,
        input.organizationId,
        userId,
      );
      expect(failed).toMatchObject({
        status: "failed",
        errorCode: "QUOTA_EXHAUSTED",
      });
      expect(failed.errorMessage).toContain("额度已用完");
      expect(await counts()).toMatchObject({
        queue: 0,
        ledgers: 0,
        reserved: 0,
      });
    });
    it("旧任务的预占已经释放时，不重复执行或抢占其他任务额度", async () => {
      const job = await legacy();
      await reserveQuota(reservation(job.id));
      await releaseQuota(input.organizationId, `report:${job.id}:reserve`);
      expect(
        await claimReportExport(
          { organizationId: input.organizationId, exportId: job.id },
          randomUUID(),
        ),
      ).toBeUndefined();
      expect(await create(job.idempotencyKey)).toMatchObject({
        status: "failed",
        errorCode: "RESERVATION_ALREADY_SETTLED",
        replayed: true,
      });
      expect(await counts()).toMatchObject({ reserved: 0, used: 0, queue: 0 });
    });
    it("同一次预占的确认和释放互斥，不消耗另一个任务的预占", async () => {
      const first = await create(),
        second = await create();
      const key = `report:${first.id}:reserve`;
      const results = await Promise.all([
        commitQuota(input.organizationId, key),
        releaseQuota(input.organizationId, key),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)).toMatchObject({
        code: "RESERVATION_ALREADY_SETTLED",
      });
      expect(await counts()).toMatchObject({
        reserved: 1,
        used: results[0].ok ? 1 : 0,
        ledgers: 3,
      });
      expect(await reserveQuota(reservation(first.id))).toMatchObject({
        ok: false,
        code: "RESERVATION_ALREADY_SETTLED",
      });
      expect(
        await reserveQuota({ ...reservation(second.id), amount: 2 }),
      ).toMatchObject({ ok: false, code: "QUOTA_IDEMPOTENCY_CONFLICT" });
      await releaseQuota(input.organizationId, `report:${second.id}:reserve`);
      expect(await counts()).toMatchObject({ reserved: 0, ledgers: 4 });
      const settled = await db
        .select()
        .from(quotaLedgers)
        .where(
          and(
            eq(quotaLedgers.organizationId, input.organizationId),
            sql`${quotaLedgers.operation} in ('commit', 'release')`,
          ),
        );
      expect(settled).toHaveLength(2);
    });
  },
);

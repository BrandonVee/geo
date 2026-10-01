import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, organizations, users, operationLogs } from "@geo/db";
import { adminRepository } from "@/server/repositories/admin";
import { adminService } from "./admin";

vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: vi.fn(),
}));

describe.skipIf(process.env.ENTERPRISE_LIFECYCLE_DB_TESTS !== "1")(
  "企业冻结与续期 PostgreSQL 回归",
  () => {
    const userId = randomUUID();
    const future = new Date("2038-01-01T00:00:00.123Z");
    const later = new Date("2039-01-01T00:00:00.123Z");
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Disposable QA database required");
      await db.insert(users).values({
        id: userId,
        name: "Enterprise lifecycle QA",
        email: `${userId}@test.invalid`,
      });
    });
    async function fixture(
      status: "active" | "suspended" | "closed" = "active",
      serviceExpiresAt: Date | null = future,
      pointsExpiresAt: Date | null = null,
    ) {
      const [row] = await db
        .insert(organizations)
        .values({
          id: randomUUID(),
          name: "Enterprise lifecycle QA",
          slug: randomUUID(),
          status,
          serviceExpiresAt,
          pointsExpiresAt,
        })
        .returning();
      return row;
    }
    const audit = () => ({ actorUserId: userId, requestId: randomUUID() });
    const saved = async (id: string) =>
      (
        await db.select().from(organizations).where(eq(organizations.id, id))
      )[0];
    const logs = (id: string) =>
      db
        .select()
        .from(operationLogs)
        .where(
          and(
            eq(operationLogs.organizationId, id),
            eq(operationLogs.operation, "platform.organization.update"),
          ),
        );

    it("并发续期只有一个提交成功，旧日期不能覆盖最新期限或重复审计", async () => {
      const row = await fixture();
      const input = {
        serviceExpiresAt: later.toISOString(),
        expected: {
          status: "active" as const,
          serviceExpiresAt: future.toISOString(),
        },
      };
      const results = await Promise.allSettled([
        adminService.updateOrganization(row.id, input, userId, audit()),
        adminService.updateOrganization(row.id, input, userId, audit()),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const failure = results.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({
        status: 409,
        code: "ORGANIZATION_SETTINGS_CONFLICT",
      });
      expect((await saved(row.id)).serviceExpiresAt).toEqual(later);
      expect(await logs(row.id)).toHaveLength(1);
    });
    it("服务与积分可独立续期，历史空积分期限与未修改字段保持原值", async () => {
      const row = await fixture();
      await adminService.updateOrganization(
        row.id,
        {
          serviceExpiresAt: later.toISOString(),
          expected: {
            status: "active",
            serviceExpiresAt: future.toISOString(),
          },
        },
        userId,
        audit(),
      );
      expect((await saved(row.id)).pointsExpiresAt).toBeNull();
      await adminService.updateOrganization(
        row.id,
        {
          pointsExpiresAt: future.toISOString(),
          expected: { status: "active", pointsExpiresAt: null },
        },
        userId,
        audit(),
      );
      expect(await saved(row.id)).toMatchObject({
        serviceExpiresAt: later,
        pointsExpiresAt: future,
      });
    });
    it("到期恢复被拒绝，续期与恢复原子完成并保留积分期限", async () => {
      const expired = new Date("2020-01-01T00:00:00Z");
      const row = await fixture("suspended", expired, expired);
      await expect(
        adminService.updateOrganization(
          row.id,
          { status: "active" },
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({
        status: 422,
        code: "ORGANIZATION_SERVICE_EXPIRED",
      });
      expect((await saved(row.id)).status).toBe("suspended");
      expect(await logs(row.id)).toHaveLength(0);
      await adminService.updateOrganization(
        row.id,
        {
          status: "active",
          serviceExpiresAt: future.toISOString(),
          expected: {
            status: "suspended",
            serviceExpiresAt: expired.toISOString(),
          },
        },
        userId,
        audit(),
      );
      expect(await saved(row.id)).toMatchObject({
        status: "active",
        serviceExpiresAt: future,
        pointsExpiresAt: expired,
      });
      expect(await logs(row.id)).toHaveLength(1);
    });
    it("单独续期不解除手动冻结，并发冻结使旧续期表单冲突", async () => {
      const suspended = await fixture("suspended");
      await adminService.updateOrganization(
        suspended.id,
        { serviceExpiresAt: later.toISOString() },
        userId,
        audit(),
      );
      expect((await saved(suspended.id)).status).toBe("suspended");
      const row = await fixture();
      await adminService.updateOrganization(
        row.id,
        { status: "suspended", expected: { status: "active" } },
        userId,
        audit(),
      );
      await expect(
        adminService.updateOrganization(
          row.id,
          {
            serviceExpiresAt: later.toISOString(),
            expected: {
              status: "active",
              serviceExpiresAt: future.toISOString(),
            },
          },
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({ code: "ORGANIZATION_SETTINGS_CONFLICT" });
      expect(await saved(row.id)).toMatchObject({
        status: "suspended",
        serviceExpiresAt: future,
      });
      expect(await logs(row.id)).toHaveLength(1);
    });
    it("已关闭企业不能被旧表单恢复或续期", async () => {
      const row = await fixture("closed");
      await expect(
        adminService.updateOrganization(
          row.id,
          { status: "active", serviceExpiresAt: later.toISOString() },
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(await saved(row.id)).toMatchObject({
        status: "closed",
        serviceExpiresAt: future,
      });
      expect(await logs(row.id)).toHaveLength(0);
    });
    it("审计失败回滚企业状态和期限", async () => {
      const row = await fixture();
      await expect(
        adminRepository.updateOrganization(
          row.id,
          { status: "suspended", serviceExpiresAt: later },
          async (tx) => {
            await tx.insert(operationLogs).values({
              actorUserId: userId,
              organizationId: row.id,
              requestId: randomUUID(),
              operation: "platform.organization.update",
              resourceType: "organization",
              result: "success",
            });
            throw new Error("Audit transaction interrupted");
          },
        ),
      ).rejects.toThrow("Audit transaction interrupted");
      expect(await saved(row.id)).toMatchObject({
        status: "active",
        serviceExpiresAt: future,
      });
      expect(await logs(row.id)).toHaveLength(0);
    });
  },
);

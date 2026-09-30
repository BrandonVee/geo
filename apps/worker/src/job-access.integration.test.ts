import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";
import {
  db,
  pool,
  users,
  organizations,
  organizationMembers,
  organizationUserFeatureScopes,
  answerbitConnections,
  answerbitTeamBindings,
  answerbitBrandMappings,
  brandAccess,
  memberRoles,
  roles,
} from "@geo/db";
import { eq } from "drizzle-orm";
import { assertWorkerJobAccess } from "./job-access";

describe.runIf(process.env.WORKER_ACCESS_DB_TESTS === "1")(
  "等待任务重新检查当前权限（PostgreSQL）",
  () => {
    let userId: string,
      organizationId: string,
      teamBindingId: string,
      memberId: string;
    const brandId = "qa-brand";
    const check = (
      permission: "resource.create" | "report.export" = "resource.create",
    ) =>
      assertWorkerJobAccess({
        organizationId,
        teamBindingId,
        brandId,
        userId,
        permission,
      });
    beforeEach(async () => {
      userId = randomUUID();
      organizationId = randomUUID();
      teamBindingId = randomUUID();
      await db.insert(users).values({
        id: userId,
        name: "异步权限测试",
        email: `${userId}@worker.invalid`,
      });
      await db.insert(organizations).values({
        id: organizationId,
        name: "异步权限测试",
        slug: organizationId,
      });
      const [member] = await db
        .insert(organizationMembers)
        .values({ organizationId, userId, status: "active" })
        .returning();
      memberId = member.id;
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "unused-test-key",
          apiKeyFingerprint: randomUUID(),
          apiKeyHint: "qa",
          createdBy: userId,
        })
        .returning();
      await db.insert(answerbitTeamBindings).values({
        id: teamBindingId,
        organizationId,
        connectionId: connection.id,
        teamId: `qa-${randomUUID()}`,
        status: "active",
      });
      await db.insert(answerbitBrandMappings).values({
        organizationId,
        teamBindingId,
        brandId,
        brandName: "测试品牌",
      });
      await db.insert(brandAccess).values({
        organizationId,
        teamBindingId,
        brandId,
        userId,
        role: "brand_admin",
      });
    });
    afterEach(async () => {
      await db
        .delete(brandAccess)
        .where(eq(brandAccess.organizationId, organizationId));
      await db
        .delete(answerbitBrandMappings)
        .where(eq(answerbitBrandMappings.organizationId, organizationId));
      await db
        .delete(answerbitTeamBindings)
        .where(eq(answerbitTeamBindings.organizationId, organizationId));
      await db
        .delete(answerbitConnections)
        .where(eq(answerbitConnections.organizationId, organizationId));
      await db.delete(memberRoles).where(eq(memberRoles.memberId, memberId));
      await db
        .delete(organizationMembers)
        .where(eq(organizationMembers.organizationId, organizationId));
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db.delete(users).where(eq(users.id, userId));
    });
    afterAll(async () => {
      await pool.end();
    });
    it("仅有品牌管理员角色的有效成员可以执行文章和报告", async () => {
      await expect(check()).resolves.toBeUndefined();
      await expect(check("report.export")).resolves.toBeUndefined();
    });
    it("成员停用或用户停用立即阻止尚未执行的任务", async () => {
      await db
        .update(organizationMembers)
        .set({ status: "disabled" })
        .where(eq(organizationMembers.id, memberId));
      await expect(check()).rejects.toMatchObject({
        code: "JOB_PERMISSION_REVOKED",
      });
      await db
        .update(organizationMembers)
        .set({ status: "active" })
        .where(eq(organizationMembers.id, memberId));
      await db
        .update(users)
        .set({ status: "disabled" })
        .where(eq(users.id, userId));
      await expect(check("report.export")).rejects.toMatchObject({
        code: "JOB_PERMISSION_REVOKED",
      });
    });
    it("角色降为编辑不能导出，降为查看者不能生成", async () => {
      await db
        .update(brandAccess)
        .set({ role: "brand_editor" })
        .where(eq(brandAccess.userId, userId));
      await expect(check()).resolves.toBeUndefined();
      await expect(check("report.export")).rejects.toMatchObject({
        code: "JOB_PERMISSION_REVOKED",
      });
      await db
        .update(brandAccess)
        .set({ role: "brand_viewer" })
        .where(eq(brandAccess.userId, userId));
      await expect(check()).rejects.toMatchObject({
        code: "JOB_PERMISSION_REVOKED",
      });
    });
    it("功能范围可以单独关闭报告或内容，恢复后重新允许", async () => {
      await db
        .insert(organizationUserFeatureScopes)
        .values({ organizationId, userId, features: ["content"] });
      await expect(check()).resolves.toBeUndefined();
      await expect(check("report.export")).rejects.toMatchObject({
        code: "ORGANIZATION_FEATURE_DISABLED",
      });
      await db
        .update(organizationUserFeatureScopes)
        .set({ features: ["report"] })
        .where(eq(organizationUserFeatureScopes.userId, userId));
      await expect(check()).rejects.toMatchObject({
        code: "ORGANIZATION_FEATURE_DISABLED",
      });
      await expect(check("report.export")).resolves.toBeUndefined();
    });
    it("代理商到期即使仍有品牌角色也拒绝执行", async () => {
      await db
        .update(users)
        .set({ accountType: "agent", agentExpiresAt: new Date(0) })
        .where(eq(users.id, userId));
      await expect(check()).rejects.toMatchObject({
        code: "JOB_PERMISSION_REVOKED",
      });
    });
    it("企业管理员同样不能绕过品牌归属或停用的绑定", async () => {
      const [role] = await db
        .select()
        .from(roles)
        .where(eq(roles.code, "tenant_admin"));
      await db.insert(memberRoles).values({ memberId, roleId: role.id });
      await expect(check()).resolves.toBeUndefined();
      await expect(
        assertWorkerJobAccess({
          organizationId,
          teamBindingId,
          brandId: "foreign-brand",
          userId,
          permission: "resource.create",
        }),
      ).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
      await db
        .update(answerbitTeamBindings)
        .set({ status: "disabled" })
        .where(eq(answerbitTeamBindings.id, teamBindingId));
      await expect(check()).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
    });
  },
);

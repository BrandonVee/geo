import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  users,
  organizations,
  answerbitConnections,
  answerbitTeamBindings,
  operationLogs,
  type DatabaseTransaction,
} from "@geo/db";
import {
  createContentDocumentSchema,
  updateContentDocumentSchema,
} from "@geo/contracts";

// Keep the real repository, RLS, audit writer and database; replace only authorization.
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/permissions/platform", () => ({
  isPlatformAdministrator: vi.fn().mockResolvedValue(false),
  requirePlatformPermission: vi.fn(),
}));
import { contentDocumentRepository as repository } from "@/server/repositories/content-documents";
import { contentDocumentService as service } from "./content-documents";
import { writeAudit } from "@/server/audit/write-audit";

describe.skipIf(process.env.CONTENT_DOCUMENT_WRITE_DB_TESTS !== "1")(
  "文档写入与审计 PostgreSQL 原子事务",
  () => {
    const userId = randomUUID(),
      organizationId = randomUUID(),
      connectionId = randomUUID(),
      teamBindingId = randomUUID();
    const scope = { organizationId, teamBindingId, brandId: randomUUID() };
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error(
          "Document write QA requires disposable workflow database",
        );
      await db.insert(users).values({
        id: userId,
        name: "document-write-qa",
        email: `${userId}@test.invalid`,
      });
      await db.insert(organizations).values({
        id: organizationId,
        name: "document-write-qa",
        slug: organizationId,
      });
      await db.insert(answerbitConnections).values({
        id: connectionId,
        organizationId,
        encryptedApiKey: "fixture",
        apiKeyFingerprint: randomUUID(),
        apiKeyHint: "fixture",
        createdBy: userId,
      });
      await db.insert(answerbitTeamBindings).values({
        id: teamBindingId,
        organizationId,
        connectionId,
        teamId: randomUUID(),
      });
    });
    afterAll(async () => {
      await pool.end();
    });
    const audit = (invalid = false) => ({
      organizationId,
      actorUserId: userId,
      requestId: invalid ? "x".repeat(500) : randomUUID(),
    });
    const fixture = async () => {
      const created = await repository.create(
        createContentDocumentSchema.parse({
          ...scope,
          title: "原标题",
          body: "原正文",
          status: "ready",
          tags: ["原标签"],
          source: "imported",
          sourceUrl: "https://example.com/original",
        }),
        userId,
        randomUUID(),
      );
      if (!created.ok) throw new Error("Fixture create failed");
      await repository.update(
        scope,
        created.document.id,
        updateContentDocumentSchema.parse({
          ...scope,
          expectedVersion: 1,
          title: "最新标题",
          body: "最新正文",
          tags: ["新标签"],
        }),
        userId,
      );
      return created.document.id;
    };
    const logs = (id: string) =>
      db.select().from(operationLogs).where(eq(operationLogs.resourceId, id));
    for (const operation of ["update", "archive", "restore"] as const) {
      it(`${operation} 审计失败整笔回滚，原版本可直接重试且只保存一个新版本`, async () => {
        const id = await fixture();
        const before = await repository.find(scope, id);
        const input = updateContentDocumentSchema.parse({
          ...scope,
          expectedVersion: 2,
          body: "编辑正文",
          title: "编辑标题",
        });
        const action = (invalid: boolean) =>
          operation === "update"
            ? service.update(scope, id, input, userId, audit(invalid))
            : operation === "archive"
              ? service.archive(
                  { ...scope, expectedVersion: 2 },
                  id,
                  userId,
                  audit(invalid),
                )
              : service.restoreVersion(
                  scope,
                  id,
                  1,
                  { ...scope, expectedVersion: 2, changeSummary: "恢复初版" },
                  userId,
                  audit(invalid),
                );
        await expect(action(true)).rejects.toThrow();
        expect(await repository.find(scope, id)).toEqual(before);
        expect(await logs(id)).toHaveLength(0);
        const saved = await action(false);
        expect(saved).toMatchObject({
          id,
          currentVersion: 3,
          sourceUrl: "https://example.com/original",
        });
        expect(saved).not.toHaveProperty("creationKey");
        expect(saved).not.toHaveProperty("creationFingerprint");
        expect(await repository.find(scope, id)).toMatchObject({
          currentVersion: 3,
          versions: [{ version: 3 }, { version: 2 }, { version: 1 }],
        });
        expect(await logs(id)).toMatchObject([
          {
            operation:
              operation === "restore"
                ? "content.document.version.restore"
                : `content.document.${operation}`,
            actorUserId: userId,
          },
        ]);
        if (operation === "restore")
          expect(saved).toMatchObject({
            title: "原标题",
            body: "原正文",
            status: "ready",
            tags: ["原标签"],
          });
        else if (operation === "archive")
          expect(saved).toMatchObject({
            title: "最新标题",
            body: "最新正文",
            status: "archived",
            tags: ["新标签"],
          });
        else
          expect(saved).toMatchObject({
            title: "编辑标题",
            body: "编辑正文",
            status: "ready",
          });
      });
    }
    it("提交前其他连接看不到新版本或审计，中断后两者都回滚", async () => {
      const id = await fixture();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const attempt = repository.update(
        scope,
        id,
        updateContentDocumentSchema.parse({
          ...scope,
          expectedVersion: 2,
          body: "尚未提交正文",
        }),
        userId,
        async (tx: DatabaseTransaction, document) => {
          await writeAudit(
            audit(),
            {
              operation: "content.document.update",
              resourceType: "content_document",
              resourceId: document.id,
            },
            tx,
          );
          entered();
          await gate;
          throw new Error("interrupted before commit");
        },
      );
      const observed = attempt.catch((error) => error as Error);
      try {
        await Promise.race([started, attempt]);
        expect(await repository.find(scope, id)).toMatchObject({
          currentVersion: 2,
          body: "最新正文",
          versions: [{ version: 2 }, { version: 1 }],
        });
        expect(await logs(id)).toHaveLength(0);
      } finally {
        release();
      }
      expect(await observed).toMatchObject({
        message: "interrupted before commit",
      });
      expect(await repository.find(scope, id)).toMatchObject({
        currentVersion: 2,
        body: "最新正文",
        versions: [{ version: 2 }, { version: 1 }],
      });
      expect(await logs(id)).toHaveLength(0);
    });
    it("同一旧版本并发编辑只接受一次，新内容、版本和审计对应同一赢家", async () => {
      const id = await fixture();
      const results = await Promise.allSettled(
        ["编辑甲", "编辑乙"].map((body) =>
          service.update(
            scope,
            id,
            updateContentDocumentSchema.parse({
              ...scope,
              expectedVersion: 2,
              body,
            }),
            userId,
            audit(),
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const winner = results.find((r) => r.status === "fulfilled")!;
      if (winner.status !== "fulfilled") throw new Error("No winner");
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected).toMatchObject({
        reason: { code: "CONTENT_DOCUMENT_VERSION_CONFLICT", status: 409 },
      });
      expect(await repository.find(scope, id)).toMatchObject({
        body: winner.value.body,
        currentVersion: 3,
        versions: [{ version: 3 }, { version: 2 }, { version: 1 }],
      });
      expect(await logs(id)).toMatchObject([
        {
          operation: "content.document.update",
          summary: "更新文档版本 v3：最新标题",
        },
      ]);
    });
    it("错误品牌不能修改或恢复历史，过期归档和历史恢复不增加版本及审计", async () => {
      const id = await fixture(),
        before = await repository.find(scope, id);
      const hidden = { ...scope, brandId: "other-brand" };
      await expect(
        service.update(
          hidden,
          id,
          updateContentDocumentSchema.parse({
            ...hidden,
            expectedVersion: 2,
            body: "越界",
          }),
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.restoreVersion(
          hidden,
          id,
          1,
          { ...hidden, expectedVersion: 2, changeSummary: "越界恢复" },
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.archive({ ...scope, expectedVersion: 1 }, id, userId, audit()),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.restoreVersion(
          scope,
          id,
          1,
          { ...scope, expectedVersion: 1, changeSummary: "过期恢复" },
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await repository.find(scope, id)).toEqual(before);
      expect(await logs(id)).toHaveLength(0);
    });
  },
);

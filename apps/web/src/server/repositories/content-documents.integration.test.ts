import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createContentDocumentSchema,
  updateContentDocumentSchema,
} from "@geo/contracts";
import {
  answerbitConnections,
  answerbitTeamBindings,
  contentDocuments,
  contentDocumentVersions,
  contentFolders,
  db,
  organizations,
  pool,
  users,
} from "@geo/db";
import { contentDocumentRepository } from "./content-documents";

// Opt in only after a database release; every fixture uses fresh IDs and is removed.
describe.skipIf(process.env.CONTENT_DOCUMENT_DB_TESTS !== "1")(
  "内容文档 PostgreSQL 回归",
  () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const teamBindingId = randomUUID();
    const brandId = `fixture-${randomUUID()}`;
    const scope = { organizationId, teamBindingId, brandId };
    let documentId: string;
    let folderId: string;

    beforeAll(async () => {
      await db.insert(users).values({
        id: userId,
        name: "Content document test",
        email: `${userId}@test.invalid`,
      });
      await db.insert(organizations).values({
        id: organizationId,
        name: "Content document test",
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
        teamId: `fixture-${randomUUID()}`,
      });
    });

    afterAll(async () => {
      try {
        await db
          .delete(contentDocuments)
          .where(eq(contentDocuments.organizationId, organizationId));
        await db
          .delete(contentFolders)
          .where(eq(contentFolders.organizationId, organizationId));
        await db
          .delete(answerbitTeamBindings)
          .where(eq(answerbitTeamBindings.id, teamBindingId));
        await db
          .delete(answerbitConnections)
          .where(eq(answerbitConnections.id, connectionId));
        await db
          .delete(organizations)
          .where(eq(organizations.id, organizationId));
        await db.delete(users).where(eq(users.id, userId));
      } finally {
        await pool.end();
      }
    });

    it("创建文档与首个不可变版本，按品牌范围读取", async () => {
      const created = await contentDocumentRepository.create(
        createContentDocumentSchema.parse({
          ...scope,
          title: "初稿",
          body: "第一版正文",
          tags: ["案例"],
        }),
        userId,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("create failed");
      documentId = created.document.id;
      expect(created.document.currentVersion).toBe(1);
      expect(
        await contentDocumentRepository.find(scope, documentId),
      ).toMatchObject({
        body: "第一版正文",
        versions: [{ version: 1 }],
      });
      expect(
        await contentDocumentRepository.find(
          { ...scope, brandId: "other-brand" },
          documentId,
        ),
      ).toBeUndefined();
    });

    it("新建并发重放只产生一份文档与首版，后续编辑不会改变原始创建校验", async () => {
      const key = randomUUID();
      const input = createContentDocumentSchema.parse({
        ...scope,
        title: "幂等稿",
        body: "提交正文",
      });
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          contentDocumentRepository.create(input, userId, key),
        ),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      const successes = results.filter((result) => result.ok);
      expect(new Set(successes.map((result) => result.document.id)).size).toBe(
        1,
      );
      expect(successes.filter((result) => !result.replayed)).toHaveLength(1);
      const id = successes[0]!.document.id;
      expect(
        (await contentDocumentRepository.find(scope, id))?.versions,
      ).toHaveLength(1);
      for (const [changed, actor] of [
        [{ ...input, body: "不同正文" }, userId],
        [{ ...input, brandId: "另一个品牌" }, userId],
        [input, randomUUID()],
      ] as const) {
        expect(
          await contentDocumentRepository.create(changed, actor, key),
        ).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
      }
      await contentDocumentRepository.update(
        scope,
        id,
        updateContentDocumentSchema.parse({
          ...scope,
          expectedVersion: 1,
          body: "保存后的新版",
        }),
        userId,
      );
      expect(
        await contentDocumentRepository.create(
          { ...input, folderId: null },
          userId,
          key,
        ),
      ).toMatchObject({
        ok: true,
        replayed: true,
        document: { id, body: "保存后的新版", currentVersion: 2 },
      });
      expect(
        (await contentDocumentRepository.find(scope, id))?.versions,
      ).toHaveLength(2);
      const second = await contentDocumentRepository.create(
        input,
        userId,
        randomUUID(),
      );
      expect(second).toMatchObject({ ok: true, replayed: false });
      if (second.ok) expect(second.document.id).not.toBe(id);
    });

    it("创建审计失败时文档与首版一并回滚，同一键可以重新提交", async () => {
      const creationKey = randomUUID();
      const input = createContentDocumentSchema.parse({
        ...scope,
        title: "审计回滚稿",
      });
      await expect(
        contentDocumentRepository.create(input, userId, creationKey, {
          context: {
            organizationId,
            actorUserId: userId,
            requestId: "x".repeat(500),
          },
          input: {
            operation: "content.document.create",
            resourceType: "content_document",
          },
        }),
      ).rejects.toThrow();
      const committed = await db
        .select()
        .from(contentDocuments)
        .where(eq(contentDocuments.creationKey, creationKey));
      expect(committed).toHaveLength(0);
      expect(
        await contentDocumentRepository.create(input, userId, creationKey),
      ).toMatchObject({ ok: true, replayed: false });
    });

    it("同一旧版并发保存只接受一次，历史恢复也校验当前版本", async () => {
      const updates = await Promise.all(
        ["第二版", "第三版"].map((body) =>
          contentDocumentRepository.update(
            scope,
            documentId,
            updateContentDocumentSchema.parse({
              ...scope,
              expectedVersion: 1,
              body,
              changeSummary: body,
            }),
            userId,
          ),
        ),
      );
      expect(updates.filter((result) => result.ok)).toHaveLength(1);
      expect(updates.find((result) => !result.ok)).toMatchObject({
        ok: false,
        code: "VERSION_CONFLICT",
        currentVersion: 2,
      });
      const beforeRestore = await contentDocumentRepository.find(
        scope,
        documentId,
      );
      expect(beforeRestore?.currentVersion).toBe(2);
      expect(beforeRestore?.versions.map((version) => version.version)).toEqual(
        [2, 1],
      );

      expect(
        await contentDocumentRepository.restore(
          scope,
          documentId,
          1,
          "过期恢复",
          userId,
          1,
        ),
      ).toMatchObject({
        ok: false,
        code: "VERSION_CONFLICT",
        currentVersion: 2,
      });
      expect(
        await contentDocumentRepository.update(
          scope,
          documentId,
          updateContentDocumentSchema.parse({
            ...scope,
            expectedVersion: 1,
            status: "archived",
          }),
          userId,
        ),
      ).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
      expect(
        await contentDocumentRepository.find(scope, documentId),
      ).toMatchObject({ currentVersion: 2, status: "draft" });

      const restored = await contentDocumentRepository.restore(
        scope,
        documentId,
        1,
        "恢复初稿",
        userId,
        2,
      );
      expect(restored).toMatchObject({
        ok: true,
        document: { currentVersion: 3, body: "第一版正文" },
      });
      const afterRestore = await contentDocumentRepository.find(
        scope,
        documentId,
      );
      expect(afterRestore?.versions.map((version) => version.version)).toEqual([
        3, 2, 1,
      ]);
      expect(afterRestore?.versions[0]?.changeSummary).toBe("恢复初稿");
      const snapshots = await db
        .select({
          version: contentDocumentVersions.version,
          body: contentDocumentVersions.body,
        })
        .from(contentDocumentVersions)
        .where(eq(contentDocumentVersions.documentId, documentId));
      expect(snapshots.find((item) => item.version === 1)?.body).toBe(
        "第一版正文",
      );
      expect(snapshots.find((item) => item.version === 3)?.body).toBe(
        "第一版正文",
      );
    });

    it("文件夹删除后文档回到未归档，且别的品牌不能使用该文件夹", async () => {
      const folder = await contentDocumentRepository.createFolder(
        scope,
        "资料",
        userId,
      );
      if (!folder) throw new Error("create folder failed");
      folderId = folder.id;
      expect(
        await contentDocumentRepository.update(
          scope,
          documentId,
          updateContentDocumentSchema.parse({
            ...scope,
            expectedVersion: 3,
            folderId,
          }),
          userId,
        ),
      ).toMatchObject({ ok: true });
      const crossBrand = await contentDocumentRepository.create(
        createContentDocumentSchema.parse({
          ...scope,
          brandId: "other-brand",
          folderId,
          title: "跨品牌文档",
        }),
        userId,
      );
      expect(crossBrand).toMatchObject({ ok: false, code: "FOLDER_NOT_FOUND" });

      expect(
        await contentDocumentRepository.deleteFolder(scope, folderId),
      ).toBe(true);
      expect(
        await contentDocumentRepository.find(scope, documentId),
      ).toMatchObject({ folderId: null });
    });
  },
);

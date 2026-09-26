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

    it("并发修改递增版本，恢复历史时追加新版本而不覆盖旧快照", async () => {
      const updates = await Promise.all(
        ["第二版", "第三版"].map((body) =>
          contentDocumentRepository.update(
            scope,
            documentId,
            updateContentDocumentSchema.parse({
              ...scope,
              body,
              changeSummary: body,
            }),
            userId,
          ),
        ),
      );
      expect(updates.every((result) => result.ok)).toBe(true);
      const beforeRestore = await contentDocumentRepository.find(
        scope,
        documentId,
      );
      expect(beforeRestore?.currentVersion).toBe(3);
      expect(beforeRestore?.versions.map((version) => version.version)).toEqual(
        [3, 2, 1],
      );

      const restored = await contentDocumentRepository.restore(
        scope,
        documentId,
        1,
        "恢复初稿",
        userId,
      );
      expect(restored).toMatchObject({
        ok: true,
        document: { currentVersion: 4, body: "第一版正文" },
      });
      const afterRestore = await contentDocumentRepository.find(
        scope,
        documentId,
      );
      expect(afterRestore?.versions.map((version) => version.version)).toEqual([
        4, 3, 2, 1,
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
      expect(snapshots.find((item) => item.version === 4)?.body).toBe(
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
          updateContentDocumentSchema.parse({ ...scope, folderId }),
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

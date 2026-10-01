import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createContentDocumentSchema,
  updateContentDocumentSchema,
} from "@geo/contracts";
import {
  db,
  pool,
  users,
  organizations,
  answerbitConnections,
  answerbitTeamBindings,
  contentFolders,
  contentDocumentVersions,
  contentDocuments,
  operationLogs,
  type DatabaseTransaction,
} from "@geo/db";
import { contentDocumentRepository as repository } from "./content-documents";

describe.skipIf(process.env.CONTENT_FOLDER_DB_TESTS !== "1")(
  "文件夹 PostgreSQL 工作流",
  () => {
    const user = randomUUID(),
      second = randomUUID(),
      org = randomUUID(),
      otherOrg = randomUUID();
    const connection = randomUUID(),
      binding = randomUUID();
    const scope = {
      organizationId: org,
      teamBindingId: binding,
      brandId: randomUUID(),
    };
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Folder QA requires disposable workflow database");
      await db.insert(users).values(
        [user, second].map((id) => ({
          id,
          name: "folder-qa",
          email: `${id}@test.invalid`,
        })),
      );
      await db
        .insert(organizations)
        .values(
          [org, otherOrg].map((id) => ({ id, name: "folder-qa", slug: id })),
        );
      await db.insert(answerbitConnections).values({
        id: connection,
        organizationId: org,
        encryptedApiKey: "fixture",
        apiKeyFingerprint: randomUUID(),
        apiKeyHint: "fixture",
        createdBy: user,
      });
      await db.insert(answerbitTeamBindings).values({
        id: binding,
        organizationId: org,
        connectionId: connection,
        teamId: randomUUID(),
      });
    });
    afterAll(async () => {
      await pool.end();
    });
    const audit =
      (operation: string, fail = false) =>
      async (
        tx: DatabaseTransaction,
        row: typeof contentFolders.$inferSelect,
      ) => {
        await tx.insert(operationLogs).values({
          organizationId: org,
          actorUserId: user,
          requestId: randomUUID(),
          operation,
          resourceType: "content_folder",
          resourceId: row.id,
          result: "success",
        });
        if (fail) throw new Error("audit unavailable");
      };
    const logs = (id: string) =>
      db.select().from(operationLogs).where(eq(operationLogs.resourceId, id));
    const create = async (name = randomUUID()) => {
      const key = randomUUID();
      const result = await repository.createFolder(
        scope,
        name,
        user,
        key,
        audit("create"),
      );
      if (result.kind !== "created") throw new Error("Fixture create failed");
      return { row: result.row, key, name };
    };
    const document = async (folderId: string, archived = false) => {
      const result = await repository.create(
        createContentDocumentSchema.parse({
          ...scope,
          title: "文章",
          body: "保留正文",
          tags: ["资料"],
          folderId,
        }),
        user,
      );
      if (!result.ok) throw new Error("Fixture document failed");
      if (archived)
        await repository.update(
          scope,
          result.document.id,
          updateContentDocumentSchema.parse({
            ...scope,
            expectedVersion: 1,
            status: "archived",
          }),
          user,
        );
      return result.document.id;
    };
    it("并发同键只创建一次，原内容、操作者和品牌必须一致，改名后返回当前名称", async () => {
      const name = randomUUID(),
        key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          repository.createFolder(scope, name, user, key, audit("create")),
        ),
      );
      expect(results.filter((r) => r.kind === "created")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "replayed")).toHaveLength(3);
      const first = results[0];
      if (!("row" in first) || !first.row) throw new Error("No folder");
      expect(
        new Set(results.map((r) => ("row" in r ? r.row?.id : "missing"))).size,
      ).toBe(1);
      expect(await logs(first.row.id)).toHaveLength(1);
      for (const [changedScope, changedName, actor] of [
        [scope, "不同名称", user],
        [scope, name, second],
        [{ ...scope, brandId: "other" }, name, user],
      ] as const)
        expect(
          await repository.createFolder(changedScope, changedName, actor, key),
        ).toEqual({ kind: "conflict" });
      await repository.updateFolder(
        scope,
        first.row.id,
        "最新名称",
        user,
        name,
        audit("rename"),
      );
      expect(
        await repository.createFolder(scope, name, user, key, audit("create")),
      ).toMatchObject({
        kind: "replayed",
        row: { id: first.row.id, name: "最新名称" },
      });
      expect(await logs(first.row.id)).toHaveLength(2);
    });
    it("旧名称并发修改只接受一次，重复目标不再审计，过期删除不会改变文档", async () => {
      const { row, name } = await create();
      const id = await document(row.id);
      const results = await Promise.all(
        ["名称甲", "名称乙"].map((target) =>
          repository.updateFolder(
            scope,
            row.id,
            target,
            user,
            name,
            audit("rename"),
          ),
        ),
      );
      expect(results.map((r) => r.kind).sort()).toEqual([
        "conflict",
        "updated",
      ]);
      const current = results.find((r) => r.kind === "updated")!;
      expect(
        await repository.updateFolder(
          scope,
          row.id,
          current.row.name,
          user,
          name,
          audit("rename"),
        ),
      ).toMatchObject({ kind: "replayed" });
      expect(
        await repository.deleteFolder(
          scope,
          row.id,
          user,
          name,
          audit("delete"),
        ),
      ).toMatchObject({ kind: "conflict", row: { name: current.row.name } });
      expect(await repository.find(scope, id)).toMatchObject({
        folderId: row.id,
        currentVersion: 1,
        body: "保留正文",
      });
      expect(await logs(row.id)).toHaveLength(2);
    });
    it("删除保留活动和归档正文、历史并递增版本，重放不复活，名称可新建", async () => {
      const { row, name, key } = await create();
      const active = await document(row.id),
        archived = await document(row.id, true);
      expect(
        await repository.deleteFolder(
          scope,
          row.id,
          user,
          name,
          audit("delete"),
        ),
      ).toMatchObject({ kind: "deleted" });
      for (const [id, version, status] of [
        [active, 2, "draft"],
        [archived, 3, "archived"],
      ] as const) {
        const value = await repository.find(scope, id);
        expect(value).toMatchObject({
          folderId: null,
          currentVersion: version,
          body: "保留正文",
          status,
          tags: ["资料"],
          updatedBy: user,
        });
        expect(value?.versions).toHaveLength(version);
        const snapshots = await db
          .select()
          .from(contentDocumentVersions)
          .where(eq(contentDocumentVersions.documentId, id));
        expect(
          snapshots.find((snapshot) => snapshot.version === version),
        ).toMatchObject({
          version,
          body: "保留正文",
          status,
          changeSummary: "文件夹删除，移至未归档",
        });
      }
      expect(
        await repository.update(
          scope,
          active,
          updateContentDocumentSchema.parse({
            ...scope,
            expectedVersion: 1,
            body: "旧编辑",
          }),
          user,
        ),
      ).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
      expect(
        await repository.update(
          scope,
          active,
          updateContentDocumentSchema.parse({
            ...scope,
            expectedVersion: 2,
            folderId: row.id,
          }),
          user,
        ),
      ).toMatchObject({ ok: false, code: "FOLDER_NOT_FOUND" });
      expect(
        await repository.deleteFolder(
          scope,
          row.id,
          user,
          name,
          audit("delete"),
        ),
      ).toEqual({ kind: "missing" });
      expect((await repository.find(scope, active))?.currentVersion).toBe(2);
      expect(await logs(row.id)).toHaveLength(2);
      expect(
        await repository.createFolder(scope, name, user, key, audit("create")),
      ).toEqual({ kind: "removed" });
      expect(await repository.listFolders(scope, user)).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: row.id })]),
      );
      expect((await create(name)).row.id).not.toBe(row.id);
    });
    it("审计失败使创建、改名、删除及文档版本全部回滚", async () => {
      const key = randomUUID(),
        name = randomUUID();
      await expect(
        repository.createFolder(scope, name, user, key, audit("create", true)),
      ).rejects.toThrow("audit unavailable");
      expect(
        await db
          .select()
          .from(contentFolders)
          .where(eq(contentFolders.creationKey, key)),
      ).toHaveLength(0);
      const created = await repository.createFolder(
        scope,
        name,
        user,
        key,
        audit("create"),
      );
      if (created.kind !== "created") throw new Error("create failed");
      const id = await document(created.row.id);
      await expect(
        repository.updateFolder(
          scope,
          created.row.id,
          "回滚名称",
          user,
          name,
          audit("rename", true),
        ),
      ).rejects.toThrow("audit unavailable");
      await expect(
        repository.deleteFolder(
          scope,
          created.row.id,
          user,
          name,
          audit("delete", true),
        ),
      ).rejects.toThrow("audit unavailable");
      expect(await repository.listFolders(scope, user)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: created.row.id, name }),
        ]),
      );
      expect(await repository.find(scope, id)).toMatchObject({
        folderId: created.row.id,
        currentVersion: 1,
        versions: [{ version: 1 }],
      });
      expect(await logs(created.row.id)).toHaveLength(1);
    });
    it("其他品牌或企业不能读取、修改或删除当前目录", async () => {
      const { row } = await create();
      for (const hiddenScope of [
        { ...scope, brandId: "hidden" },
        { ...scope, organizationId: otherOrg },
      ]) {
        expect(await repository.listFolders(hiddenScope, user)).toEqual([]);
        expect(
          await repository.updateFolder(hiddenScope, row.id, "越权", user),
        ).toEqual({ kind: "missing" });
        expect(
          await repository.deleteFolder(hiddenScope, row.id, user),
        ).toEqual({ kind: "missing" });
      }
      expect(await logs(row.id)).toHaveLength(1);
    });
    it("删除与关联文档创建竞争时，只产生有效版本或明确文件夹不存在", async () => {
      for (let i = 0; i < 4; i++) {
        const { row } = await create();
        const [created, removed] = await Promise.all([
          repository.create(
            createContentDocumentSchema.parse({
              ...scope,
              folderId: row.id,
              title: "竞争文章",
              body: "竞争正文",
            }),
            user,
          ),
          repository.deleteFolder(scope, row.id, user),
        ]);
        expect(removed.kind).toBe("deleted");
        if (created.ok)
          expect(
            await repository.find(scope, created.document.id),
          ).toMatchObject({
            folderId: null,
            currentVersion: 2,
            body: "竞争正文",
          });
        else expect(created.code).toBe("FOLDER_NOT_FOUND");
        expect(
          await db
            .select()
            .from(contentDocuments)
            .where(eq(contentDocuments.folderId, row.id)),
        ).toHaveLength(0);
      }
    });
  },
);

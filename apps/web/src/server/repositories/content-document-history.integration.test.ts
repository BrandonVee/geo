import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  contentDocumentListQuerySchema,
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
import { contentDocumentRepository as repository } from "./content-documents";

type Scope = {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
};

describe.skipIf(process.env.CONTENT_DOCUMENT_HISTORY_DB_TESTS !== "1")(
  "文档库历史查询 PostgreSQL 回归",
  () => {
    const userId = randomUUID(),
      otherUserId = randomUUID();

    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error(
          "Document history QA requires disposable workflow database",
        );
      await db.insert(users).values(
        [userId, otherUserId].map((id) => ({
          id,
          name: "Document history QA",
          email: `${id}@test.invalid`,
        })),
      );
    });

    afterAll(async () => {
      await pool.end();
    });

    async function fixture() {
      const organizationId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "Document history QA",
        slug: organizationId,
      });
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "unused",
          apiKeyFingerprint: randomUUID(),
          apiKeyHint: "qa",
          createdBy: userId,
        })
        .returning();
      const bindings = await db
        .insert(answerbitTeamBindings)
        .values(
          Array.from({ length: 2 }, () => ({
            organizationId,
            connectionId: connection.id,
            teamId: randomUUID(),
          })),
        )
        .returning();
      const scope = {
        organizationId,
        teamBindingId: bindings[0].id,
        brandId: randomUUID(),
      };
      return {
        scope,
        otherBinding: { ...scope, teamBindingId: bindings[1].id },
        otherBrand: { ...scope, brandId: randomUUID() },
      };
    }

    const read = (scope: Scope, patch: Record<string, unknown> = {}) =>
      repository.list(
        contentDocumentListQuerySchema.parse({ ...scope, ...patch }),
        userId,
      );

    async function seed(
      scope: Scope,
      count = 1,
      patch: Partial<typeof contentDocuments.$inferInsert> = {},
    ) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(contentDocuments)
          .values(
            Array.from({ length: count }, (_, index) => ({
              ...scope,
              createdBy: index % 2 ? otherUserId : userId,
              updatedBy: userId,
              title: `历史文章 ${index}`,
              body: "文档正文",
              status: "ready" as const,
              updatedAt: new Date("2026-09-01T16:00:00Z"),
              ...patch,
            })),
          )
          .returning();
        await tx.insert(contentDocumentVersions).values(
          rows.map((row) => ({
            documentId: row.id,
            organizationId: row.organizationId,
            version: row.currentVersion,
            title: row.title,
            body: row.body,
            status: row.status,
            language: row.language,
            tags: row.tags,
            createdBy: row.createdBy,
          })),
        );
        return rows;
      });
    }

    // Delay delivery of a real SELECT result, then commit a write on another
    // connection. No rows or transaction options are mocked: this guarantees
    // the write occurs between the repository's two reads of the same snapshot.
    async function withWriteBetweenReads<T>(
      marker: string,
      reading: () => Promise<T>,
      writing: () => Promise<unknown>,
    ) {
      const client = await pool.connect();
      const prototype = Object.getPrototypeOf(client) as typeof client;
      client.release();
      const originalQuery = prototype.query;
      let resume!: () => void;
      let reached!: () => void;
      const paused = new Promise<void>((resolve) => (reached = resolve));
      const released = new Promise<void>((resolve) => (resume = resolve));
      let intercepted = false;
      const spy = vi.spyOn(prototype, "query").mockImplementation(function (
        this: typeof client,
        ...args: Parameters<typeof originalQuery>
      ) {
        const result: unknown = Reflect.apply(originalQuery, this, args);
        const query: unknown = args[0];
        const queryText =
          typeof query === "string"
            ? query
            : query && typeof query === "object" && "text" in query
              ? String(query.text)
              : "";
        if (
          !intercepted &&
          queryText.includes(marker) &&
          result instanceof Promise
        ) {
          intercepted = true;
          return result.then(async (value) => {
            reached();
            await released;
            return value;
          });
        }
        return result;
      } as typeof originalQuery);
      const pendingRead = reading();
      try {
        await Promise.race([
          paused,
          pendingRead.then(() => {
            throw new Error(`Expected SELECT was not intercepted: ${marker}`);
          }),
        ]);
        await writing();
        resume();
        return await pendingRead;
      } finally {
        resume();
        spy.mockRestore();
        await pendingRead.catch(() => undefined);
      }
    }

    it("超过百条文档按更新时间和编号稳定分页，同品牌其他操作者的文章也可见", async () => {
      const { scope } = await fixture();
      const rows = [
        ...(await seed(scope, 103)),
        ...(await seed(scope, 20, {
          updatedAt: new Date("2026-09-02T16:00:00Z"),
        })),
      ];
      const seen: string[] = [];
      for (let offset = 0; offset < rows.length; offset += 20) {
        const result = await read(scope, { limit: 20, offset });
        expect(result.total).toBe(123);
        expect(result.pagination).toEqual({
          page: offset / 20 + 1,
          pageSize: 20,
          total: 123,
          pages: 7,
          offset,
        });
        seen.push(...result.list.map((row) => row.id));
      }
      expect(seen).toEqual(
        rows
          .sort(
            (a, b) =>
              b.updatedAt.getTime() - a.updatedAt.getTime() ||
              b.id.localeCompare(a.id),
          )
          .map((row) => row.id),
      );
      expect(new Set(seen).size).toBe(123);
      const tail = await read(scope, { limit: 20, offset: 100_000 });
      expect(tail.pagination).toMatchObject({
        page: 7,
        offset: 120,
        total: 123,
      });
      expect(tail.list.map((row) => row.id)).toEqual(seen.slice(120));
      // Existing callers may use an offset that is not a page-size multiple.
      expect(
        (await read(scope, { limit: 20, offset: 7 })).list.map((row) => row.id),
      ).toEqual(seen.slice(7, 27));
      const partialTail = await read(scope, { limit: 20, offset: 122 });
      expect(partialTail.list.map((row) => row.id)).toEqual(seen.slice(122));
      expect(partialTail.pagination).toMatchObject({ page: 7, offset: 122 });
    });

    it("列表与详情隔离企业、内部绑定和品牌，不读取其他范围的版本", async () => {
      const { scope, otherBinding, otherBrand } = await fixture();
      const { scope: otherOrg } = await fixture();
      otherOrg.brandId = scope.brandId;
      const [document] = await seed(scope, 2);
      await seed(otherBinding, 3);
      await seed(otherBrand, 4);
      await seed(otherOrg, 5);
      for (const [target, total] of [
        [scope, 2],
        [otherBinding, 3],
        [otherBrand, 4],
        [otherOrg, 5],
      ] as const)
        expect((await read(target)).total).toBe(total);
      for (const target of [otherBinding, otherBrand, otherOrg])
        expect(
          await repository.find(target, document.id, userId),
        ).toBeUndefined();
      expect(
        await repository.find(scope, document.id, otherUserId),
      ).toMatchObject({
        id: document.id,
        versions: [{ version: 1 }],
      });
    });

    it("状态、来源、文件夹、未归档位置及标题正文检索按交集筛选，通配符按文字查找", async () => {
      const { scope, otherBrand } = await fixture();
      const folders = await db
        .insert(contentFolders)
        .values([
          { ...scope, name: "案例", createdBy: userId },
          { ...scope, name: "资料", createdBy: userId },
          { ...otherBrand, name: "外部目录", createdBy: userId },
        ])
        .returning();
      await seed(scope, 1, { folderId: folders[0].id });
      await seed(scope, 1, { folderId: folders[0].id, status: "draft" });
      const [literal] = await seed(scope, 1, {
        folderId: folders[0].id,
        source: "imported",
        sourceUrl: "https://example.invalid/source",
        title: "Literal_50%\\Road",
      });
      const [unfiled] = await seed(scope, 1, {
        source: "imported",
        sourceUrl: "https://example.invalid/other-source",
        body: "正文包含 Content Lookup 线索",
        title: "LiteralX50anythingRoad",
      });
      const [archived] = await seed(scope, 1, {
        folderId: folders[0].id,
        status: "archived",
        source: "ai_generated",
      });
      await seed(scope, 1, { folderId: folders[1].id, source: "ai_generated" });
      expect((await read(scope)).total).toBe(5);
      expect((await read(scope, { folderId: folders[0].id })).total).toBe(3);
      expect((await read(scope, { folderId: folders[2].id })).total).toBe(0);
      expect(
        (await read(scope, { unfiled: true })).list.map((row) => row.id),
      ).toEqual([unfiled.id]);
      expect(
        (await read(scope, { status: "archived" })).list.map((row) => row.id),
      ).toEqual([archived.id]);
      for (const q of ["_50%", "%", "_", "\\", "literal_50%\\road"])
        expect((await read(scope, { q })).list.map((row) => row.id)).toEqual([
          literal.id,
        ]);
      expect(
        (await read(scope, { q: "content lookup" })).list.map((row) => row.id),
      ).toEqual([unfiled.id]);
      const selected = await read(scope, {
        status: "ready",
        source: "imported",
        folderId: folders[0].id,
        q: "_50%",
      });
      expect(selected.list).toMatchObject([
        { id: literal.id, folderName: "案例" },
      ]);
      expect(selected.total).toBe(1);
      expect(
        (await read(scope, { status: "draft", source: "imported" })).total,
      ).toBe(0);
    });

    it("历史错误目录关联不泄露其他品牌或已删除文件夹的名称", async () => {
      const { scope, otherBrand } = await fixture();
      const folders = await db
        .insert(contentFolders)
        .values([
          { ...otherBrand, name: "其他品牌私有文件夹", createdBy: userId },
          {
            ...scope,
            name: "已删除文件夹",
            createdBy: userId,
            deletedAt: new Date(),
          },
        ])
        .returning();
      for (const folder of folders) {
        const [document] = await seed(scope, 1, { folderId: folder.id });
        const detail = await repository.find(scope, document.id, userId);
        expect(detail).toMatchObject({ id: document.id, folderName: null });
      }
      const result = await read(scope);
      expect(result.total).toBe(2);
      expect(result.list.every((row) => row.folderName === null)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("其他品牌私有文件夹");
      expect(JSON.stringify(result)).not.toContain("已删除文件夹");
    });

    it("末页文章归档后返回有效末页，空筛选返回第一页", async () => {
      const { scope } = await fixture();
      await seed(scope, 21);
      const tail = await read(scope, { limit: 20, offset: 20 });
      expect(tail.list).toHaveLength(1);
      await repository.update(
        scope,
        tail.list[0].id,
        updateContentDocumentSchema.parse({
          ...scope,
          expectedVersion: 1,
          status: "archived",
        }),
        userId,
      );
      const corrected = await read(scope, { limit: 20, offset: 20 });
      expect(corrected.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 20,
        pages: 1,
        offset: 0,
      });
      expect(corrected.list).toHaveLength(20);
      expect(
        await read(scope, { limit: 20, offset: 100_000, q: "没有匹配文章" }),
      ).toMatchObject({
        list: [],
        total: 0,
        pagination: { page: 1, pages: 1, offset: 0, total: 0 },
      });
    });

    it("列表仅返回正文预览，详情和版本元数据不暴露创建内部标识", async () => {
      const { scope } = await fixture();
      const body = `${"文章".repeat(100)}PRIVATE_CONTENT_AFTER_PREVIEW`;
      const [document] = await seed(scope, 1, {
        body,
        creationKey: "PRIVATE_CREATION_KEY",
        creationFingerprint: "PRIVATE_CREATION_FINGERPRINT",
      });
      const result = await read(scope);
      expect(result.list[0]).toMatchObject({
        bodyPreview: body.slice(0, 180),
        contentLength: body.length,
      });
      expect(result.list[0]).not.toHaveProperty("body");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      const detail = await repository.find(scope, document.id, userId);
      expect(detail).toMatchObject({ body, currentVersion: 1 });
      expect(detail).not.toHaveProperty("creationKey");
      expect(detail).not.toHaveProperty("creationFingerprint");
      expect(detail?.versions[0]).not.toHaveProperty("body");
      expect(detail?.versions[0]).not.toHaveProperty("title");
    });

    it("总数读取后并发新增文章，同次列表仍使用同一租户快照", async () => {
      const { scope } = await fixture();
      const initial = await seed(scope, 3);
      const result = await withWriteBetweenReads(
        'select count(*) from "content_documents"',
        () => read(scope),
        () => seed(scope),
      );
      expect(result.total).toBe(3);
      expect(result.list.map((row) => row.id).sort()).toEqual(
        initial.map((row) => row.id).sort(),
      );
      expect(result.pagination.total).toBe(3);
      expect((await read(scope)).total).toBe(4);
    });

    it("详情读取后并发保存文章，详情与版本历史仍使用同一快照", async () => {
      const { scope } = await fixture();
      const [document] = await seed(scope);
      const result = await withWriteBetweenReads(
        '"content_documents"."body"',
        () => repository.find(scope, document.id, userId),
        async () => {
          const saved = await repository.update(
            scope,
            document.id,
            updateContentDocumentSchema.parse({
              ...scope,
              expectedVersion: 1,
              body: "已提交的第二版正文",
            }),
            otherUserId,
          );
          expect(saved).toMatchObject({ ok: true });
        },
      );
      expect(result).toMatchObject({
        body: "文档正文",
        currentVersion: 1,
        versions: [{ version: 1 }],
      });
      expect(await repository.find(scope, document.id, userId)).toMatchObject({
        body: "已提交的第二版正文",
        currentVersion: 2,
        versions: [{ version: 2 }, { version: 1 }],
      });
    });
  },
);

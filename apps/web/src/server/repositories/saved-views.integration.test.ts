import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  users,
  organizations,
  operationLogs,
  savedViews,
  type DatabaseTransaction,
} from "@geo/db";
import { savedViewRepository as repository } from "./saved-views";

describe.skipIf(process.env.SAVED_VIEW_DB_TESTS !== "1")(
  "个人视图 PostgreSQL 闭环",
  () => {
    const org = randomUUID(),
      other = randomUUID(),
      user = randomUUID(),
      second = randomUUID();
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Saved view QA requires disposable workflow database");
      await db.insert(users).values(
        [user, second].map((id) => ({
          id,
          name: "saved-view-qa",
          email: `${id}@test.invalid`,
        })),
      );
      await db
        .insert(organizations)
        .values(
          [org, other].map((id) => ({ id, name: "saved-view-qa", slug: id })),
        );
    });
    afterAll(async () => {
      await pool.end();
    });
    const input = () => ({
      organizationId: org,
      name: randomUUID(),
      page: "answers" as const,
      filters: { keyword: "原条件", platforms: ["deepseek"] },
      isDefault: false,
    });
    const audit =
      (operation: string, fail = false) =>
      async (tx: DatabaseTransaction, row: typeof savedViews.$inferSelect) => {
        await tx.insert(operationLogs).values({
          organizationId: org,
          actorUserId: user,
          requestId: randomUUID(),
          operation,
          resourceType: "saved_view",
          resourceId: row.id,
          result: "success",
        });
        if (fail) throw new Error("audit unavailable");
      };
    const logs = (id: string) =>
      db.select().from(operationLogs).where(eq(operationLogs.resourceId, id));
    const create = async (value = input(), key = randomUUID()) => {
      const result = await repository.create(
        value,
        user,
        key,
        audit("saved-view.create"),
      );
      if (result.kind !== "created") throw new Error("Fixture create failed");
      return { row: result.row, value, key };
    };
    it("并发同键只创建一个视图和审计，对象字段顺序不影响重放", async () => {
      const value = input(),
        key = randomUUID();
      const results = await Promise.all([
        repository.create(value, user, key, audit("saved-view.create")),
        repository.create(
          { ...value, filters: { platforms: ["deepseek"], keyword: "原条件" } },
          user,
          key,
          audit("saved-view.create"),
        ),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual([
        "created",
        "replayed",
      ]);
      const row = results[0];
      if (!("row" in row) || !row.row) throw new Error("No row");
      expect(await logs(row.row.id)).toHaveLength(1);
      expect(
        await repository.create({ ...value, name: "其他内容" }, user, key),
      ).toEqual({ kind: "conflict" });
    });
    it("创建指纹不随编辑变化，原创建重放返回当前配置", async () => {
      const { row, value, key } = await create();
      await repository.update(
        row.id,
        org,
        user,
        { name: "编辑后的名称", filters: { keyword: "编辑后" } },
        audit("saved-view.update"),
      );
      expect(
        await repository.create(value, user, key, audit("saved-view.create")),
      ).toMatchObject({
        kind: "replayed",
        row: {
          id: row.id,
          name: "编辑后的名称",
          filters: { keyword: "编辑后" },
        },
      });
      expect(await logs(row.id)).toHaveLength(2);
    });
    it("删除重试不重复审计，原创建重试不能复活，新键可重用名称", async () => {
      const { row, value, key } = await create();
      await repository.remove(row.id, org, user, audit("saved-view.delete"));
      expect(
        await repository.remove(row.id, org, user, audit("saved-view.delete")),
      ).toBeUndefined();
      expect(await repository.find(row.id, org, user)).toBeUndefined();
      expect(await repository.create(value, user, key)).toEqual({
        kind: "removed",
      });
      expect(await logs(row.id)).toHaveLength(2);
      expect(await repository.create(value, user, randomUUID())).toMatchObject({
        kind: "created",
      });
    });
    it("并发改名只有一个获胜，旧配置被拒绝，原目标重试不写审计", async () => {
      const { row } = await create();
      const expected = {
        name: row.name,
        filters: row.filters,
        isDefault: row.isDefault,
      };
      const results = await Promise.all(
        ["名称一", "名称二"].map((name) =>
          repository.update(
            row.id,
            org,
            user,
            { name, expected },
            audit("saved-view.update"),
          ),
        ),
      );
      expect(results.map((r) => r.kind).sort()).toEqual([
        "conflict",
        "updated",
      ]);
      const current = await repository.find(row.id, org, user);
      expect(
        await repository.update(
          row.id,
          org,
          user,
          { name: current!.name, expected },
          audit("saved-view.update"),
        ),
      ).toMatchObject({ kind: "replayed" });
      expect(await logs(row.id)).toHaveLength(2);
    });
    it("企业及私人用户隔离，相同键可以独立保存", async () => {
      const { row, value, key } = await create();
      expect(await repository.find(row.id, other, user)).toBeUndefined();
      expect(await repository.find(row.id, org, second)).toBeUndefined();
      expect(
        await repository.update(row.id, org, second, { name: "越权" }),
      ).toEqual({ kind: "missing" });
      expect(await repository.remove(row.id, org, second)).toBeUndefined();
      expect(await repository.create(value, second, key)).toMatchObject({
        kind: "created",
      });
      expect(await repository.find(row.id, org, user)).toMatchObject({
        name: value.name,
      });
      expect(
        (await repository.list(org, second)).some((v) => v.id === row.id),
      ).toBe(false);
    });
    it("创建审计失败同时回滚默认切换，原键可重试", async () => {
      const original = await create({ ...input(), isDefault: true });
      const value = { ...input(), isDefault: true },
        key = randomUUID();
      await expect(
        repository.create(value, user, key, audit("saved-view.create", true)),
      ).rejects.toThrow("audit unavailable");
      expect(await repository.find(original.row.id, org, user)).toMatchObject({
        isDefault: true,
      });
      expect(
        (await repository.list(org, user)).some((v) => v.name === value.name),
      ).toBe(false);
      expect(
        await repository.create(value, user, key, audit("saved-view.create")),
      ).toMatchObject({ kind: "created" });
      expect(
        (await repository.list(org, user)).filter((v) => v.isDefault),
      ).toHaveLength(1);
    });
    it("修改和删除审计失败一起回滚配置与删除标记", async () => {
      const { row, value, key } = await create();
      await expect(
        repository.update(
          row.id,
          org,
          user,
          { name: "失败改名" },
          audit("saved-view.update", true),
        ),
      ).rejects.toThrow("audit unavailable");
      await expect(
        repository.remove(row.id, org, user, audit("saved-view.delete", true)),
      ).rejects.toThrow("audit unavailable");
      expect(await repository.find(row.id, org, user)).toMatchObject({
        name: value.name,
        deletedAt: null,
      });
      expect(await logs(row.id)).toHaveLength(1);
      expect(await repository.create(value, user, key)).toMatchObject({
        kind: "replayed",
      });
    });
    it("并发默认视图保持一个活动默认项", async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          repository.create(
            { ...input(), isDefault: true },
            user,
            randomUUID(),
          ),
        ),
      );
      expect(results.every((r) => r.kind === "created")).toBe(true);
      expect(
        (await repository.list(org, user)).filter((v) => v.isDefault),
      ).toHaveLength(1);
    });
  },
);

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContentDocumentSchema,
  restoreContentDocumentVersionSchema,
  updateContentDocumentSchema,
} from "@geo/contracts";

const mocks = vi.hoisted(() => ({
  authorizeBrand: vi.fn(),
  isPlatformAdministrator: vi.fn(),
  requirePlatformPermission: vi.fn(),
  findById: vi.fn(),
  findTeam: vi.fn(),
  findBrand: vi.fn(),
  list: vi.fn(),
  writeAudit: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  restore: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));

vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: mocks.authorizeBrand,
}));
vi.mock("@/server/permissions/platform", () => mocks);
vi.mock("@/server/repositories/organizations", () => ({
  organizationRepository: mocks,
}));
vi.mock("@/server/repositories/brands", () => ({ brandRepository: mocks }));
vi.mock("@/server/audit/write-audit", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("@/server/repositories/content-documents", () => ({
  contentDocumentRepository: mocks,
}));

import { contentDocumentService } from "./content-documents";

const scope = {
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  teamBindingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  brandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const documentId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const audit = { actorUserId: userId, requestId: "request" };
const document = {
  id: documentId,
  title: "测试文档",
  body: "正文",
  status: "draft",
  currentVersion: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isPlatformAdministrator.mockResolvedValue(false);
  mocks.findById.mockResolvedValue({ status: "active" });
  mocks.findTeam.mockResolvedValue({ id: scope.teamBindingId });
  mocks.findBrand.mockResolvedValue({ brandId: scope.brandId });
  mocks.authorizeBrand.mockResolvedValue(undefined);
  mocks.writeAudit.mockResolvedValue(undefined);
});

describe("内容文档服务", () => {
  it("保存、恢复和归档的版本冲突统一返回 409，且不记录成功审计", async () => {
    const conflict = { ok: false, code: "VERSION_CONFLICT", currentVersion: 2 };
    mocks.update.mockResolvedValue(conflict);
    mocks.restore.mockResolvedValue(conflict);
    const input = updateContentDocumentSchema.parse({
      ...scope,
      expectedVersion: 1,
      title: "我的编辑",
    });
    for (const action of [
      () =>
        contentDocumentService.update(scope, documentId, input, userId, audit),
      () =>
        contentDocumentService.archive(
          { ...scope, expectedVersion: 1 },
          documentId,
          userId,
          audit,
        ),
      () =>
        contentDocumentService.restoreVersion(
          scope,
          documentId,
          1,
          { ...scope, expectedVersion: 1, changeSummary: "恢复" },
          userId,
          audit,
        ),
    ])
      await expect(action()).rejects.toMatchObject({
        status: 409,
        code: "CONTENT_DOCUMENT_VERSION_CONFLICT",
        details: { currentVersion: 2 },
      });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
  it("创建重放不重复审计、不暴露内部指纹；内容或操作者冲突返回 409", async () => {
    const input = createContentDocumentSchema.parse({
      ...scope,
      title: document.title,
      body: document.body,
    });
    mocks.create.mockResolvedValueOnce({
      ok: true,
      replayed: true,
      document: {
        ...document,
        creationKey: "create-key",
        creationFingerprint: "private",
      },
    });
    await expect(
      contentDocumentService.create(input, userId, audit, "create-key"),
    ).resolves.toEqual({ ...document, replayed: true });
    expect(mocks.create).toHaveBeenCalledWith(
      input,
      userId,
      "create-key",
      expect.objectContaining({ context: audit }),
    );
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    mocks.create.mockResolvedValueOnce({
      ok: false,
      code: "IDEMPOTENCY_CONFLICT",
    });
    await expect(
      contentDocumentService.create(input, userId, audit, "create-key"),
    ).rejects.toMatchObject({
      status: 409,
      code: "CONTENT_DOCUMENT_IDEMPOTENCY_CONFLICT",
    });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
  it("先验证品牌权限，再读取文档", async () => {
    mocks.authorizeBrand.mockRejectedValueOnce(new Error("权限不足"));
    await expect(
      contentDocumentService.get(scope, documentId, userId),
    ).rejects.toThrow("权限不足");
    expect(mocks.find).not.toHaveBeenCalled();

    mocks.find.mockResolvedValueOnce(document);
    await expect(
      contentDocumentService.get(scope, documentId, userId),
    ).resolves.toEqual(document);
    expect(mocks.authorizeBrand).toHaveBeenLastCalledWith(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.read",
    );
    expect(mocks.find).toHaveBeenCalledWith(scope, documentId, userId);
  });

  it("创建文档时传递品牌范围并记录审计，目标文件夹缺失时不记录成功", async () => {
    const input = createContentDocumentSchema.parse({
      ...scope,
      source: "imported",
      sourceUrl: "https://example.com/article",
      title: document.title,
      body: document.body,
    });
    mocks.create.mockResolvedValueOnce({ ok: true, document });
    await expect(
      contentDocumentService.create(input, userId, audit),
    ).resolves.toEqual({ ...document, replayed: false });
    expect(mocks.authorizeBrand).toHaveBeenCalledWith(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.create",
    );
    expect(mocks.create).toHaveBeenCalledWith(input, userId, undefined, {
      context: audit,
      input: {
        operation: "content.document.create",
        resourceType: "content_document",
        summary: "导入文档：测试文档",
      },
    });
    expect(mocks.writeAudit).not.toHaveBeenCalled();

    mocks.create.mockResolvedValueOnce({ ok: false, code: "FOLDER_NOT_FOUND" });
    await expect(
      contentDocumentService.create(input, userId, audit),
    ).rejects.toMatchObject({
      status: 404,
      code: "CONTENT_FOLDER_NOT_FOUND",
    });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["CONTENT_REQUIRED", "CONTENT_DOCUMENT_BODY_REQUIRED", 422],
    ["SOURCE_URL_REQUIRED", "CONTENT_DOCUMENT_SOURCE_URL_REQUIRED", 422],
    ["FOLDER_NOT_FOUND", "CONTENT_FOLDER_NOT_FOUND", 404],
    ["NOT_FOUND", "CONTENT_DOCUMENT_NOT_FOUND", 404],
  ])("更新失败 %s 映射为 %s", async (repositoryCode, code, status) => {
    const input = updateContentDocumentSchema.parse({
      ...scope,
      expectedVersion: 1,
      title: "新标题",
    });
    mocks.update.mockResolvedValueOnce({ ok: false, code: repositoryCode });
    await expect(
      contentDocumentService.update(scope, documentId, input, userId, audit),
    ).rejects.toMatchObject({ status, code });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("恢复历史版本时保留版本号与修改说明，并只在成功后审计", async () => {
    const input = restoreContentDocumentVersionSchema.parse({
      ...scope,
      expectedVersion: 1,
    });
    const restored = { ...document, currentVersion: 3 };
    const tx = { insert: vi.fn() };
    mocks.restore.mockImplementationOnce(async (...args) => {
      await args[6](tx, restored);
      return { ok: true, document: restored };
    });
    await expect(
      contentDocumentService.restoreVersion(
        scope,
        documentId,
        1,
        input,
        userId,
        audit,
      ),
    ).resolves.toEqual(restored);
    expect(mocks.restore).toHaveBeenCalledWith(
      scope,
      documentId,
      1,
      "恢复历史版本",
      userId,
      1,
      expect.any(Function),
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      audit,
      expect.objectContaining({
        operation: "content.document.version.restore",
        summary: "恢复文档历史版本 v1",
      }),
      tx,
    );

    mocks.restore.mockResolvedValueOnce({
      ok: false,
      code: "VERSION_NOT_FOUND",
    });
    await expect(
      contentDocumentService.restoreVersion(
        scope,
        documentId,
        9,
        input,
        userId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "CONTENT_DOCUMENT_VERSION_NOT_FOUND",
    });
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });

  it("归档使用删除权限，文件夹删除失败不写入成功审计", async () => {
    const tx = { insert: vi.fn() };
    mocks.update.mockImplementationOnce(async (...args) => {
      const archived = { ...document, status: "archived" };
      await args[4](tx, archived);
      return { ok: true, document: archived };
    });
    await contentDocumentService.archive(
      { ...scope, expectedVersion: 1 },
      documentId,
      userId,
      audit,
    );
    expect(mocks.authorizeBrand).toHaveBeenCalledWith(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.delete",
    );
    expect(mocks.update).toHaveBeenCalledWith(
      { ...scope, expectedVersion: 1 },
      documentId,
      {
        ...scope,
        expectedVersion: 1,
        status: "archived",
        changeSummary: "归档文档",
      },
      userId,
      expect.any(Function),
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      audit,
      expect.objectContaining({ operation: "content.document.archive" }),
      tx,
    );

    mocks.deleteFolder.mockResolvedValueOnce({ kind: "missing" });
    await expect(
      contentDocumentService.deleteFolder(scope, "missing", userId, audit),
    ).resolves.toBeUndefined();
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });

  it("编辑审计使用仓库事务及实际保存的版本，写入响应不泄露原创建标识", async () => {
    const tx = { insert: vi.fn() };
    const saved = {
      ...document,
      currentVersion: 2,
      title: "保存标题",
      creationKey: "private-key",
      creationFingerprint: "private-fingerprint",
    };
    mocks.update.mockImplementationOnce(async (...args) => {
      await args[4](tx, saved);
      return { ok: true, document: saved };
    });
    const input = updateContentDocumentSchema.parse({
      ...scope,
      expectedVersion: 1,
      title: "保存标题",
    });
    await expect(
      contentDocumentService.update(scope, documentId, input, userId, audit),
    ).resolves.toEqual({ ...document, currentVersion: 2, title: "保存标题" });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      audit,
      {
        operation: "content.document.update",
        resourceType: "content_document",
        resourceId: documentId,
        summary: "更新文档版本 v2：保存标题",
      },
      tx,
    );
  });
  it.each([
    ["CONTENT_REQUIRED", "CONTENT_DOCUMENT_BODY_REQUIRED"],
    ["SOURCE_URL_REQUIRED", "CONTENT_DOCUMENT_SOURCE_URL_REQUIRED"],
  ])(
    "历史恢复业务校验 %s 保留准确错误，不误报文档不存在",
    async (repositoryCode, code) => {
      mocks.restore.mockResolvedValueOnce({ ok: false, code: repositoryCode });
      await expect(
        contentDocumentService.restoreVersion(
          scope,
          documentId,
          1,
          { ...scope, expectedVersion: 1, changeSummary: "恢复" },
          userId,
          audit,
        ),
      ).rejects.toMatchObject({ status: 422, code });
      expect(mocks.writeAudit).not.toHaveBeenCalled();
    },
  );
  it("重复文件夹名返回冲突而不是内部错误", async () => {
    mocks.createFolder.mockRejectedValueOnce({ code: "23505" });
    await expect(
      contentDocumentService.createFolder(
        { ...scope, name: "资料" },
        userId,
        audit,
      ),
    ).rejects.toMatchObject({ status: 409, code: "CONTENT_FOLDER_EXISTS" });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe("文章库平台与企业权限边界", () => {
  it("平台管理员无需企业成员关系即可读取、维护文档，但必须具备对应平台权限", async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true);
    mocks.find.mockResolvedValue(document);
    await expect(
      contentDocumentService.get(scope, documentId, userId),
    ).resolves.toEqual(document);
    expect(mocks.authorizeBrand).not.toHaveBeenCalled();
    expect(mocks.requirePlatformPermission).toHaveBeenCalledWith(
      userId,
      "resource.read",
    );
    mocks.requirePlatformPermission.mockRejectedValue(new Error("无写权限"));
    await expect(
      contentDocumentService.archive(
        { ...scope, expectedVersion: 1 },
        documentId,
        userId,
        audit,
      ),
    ).rejects.toThrow("无写权限");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["findById", undefined, "ORGANIZATION_NOT_FOUND"],
    ["findById", { status: "closed" }, "ORGANIZATION_NOT_FOUND"],
    ["findById", { status: "suspended" }, "ORGANIZATION_SUSPENDED"],
    ["findTeam", undefined, "TEAM_BINDING_NOT_FOUND"],
    ["findBrand", undefined, "BRAND_NOT_FOUND"],
  ] as const)(
    "管理员不能绕过范围状态和品牌归属：%s %j",
    async (method, result, code) => {
      mocks.isPlatformAdministrator.mockResolvedValue(true);
      mocks[method].mockResolvedValue(result);
      await expect(
        contentDocumentService.get(scope, documentId, userId),
      ).rejects.toMatchObject({ code });
      expect(mocks.find).not.toHaveBeenCalled();
    },
  );

  it("普通用户和代理商共享获授权品牌的全部文章，不按作者过滤", async () => {
    const input = { ...scope, limit: 20, offset: 0, unfiled: false };
    mocks.list.mockResolvedValue({
      list: [{ ...document, createdBy: "another-user" }],
      total: 1,
    });
    await expect(
      contentDocumentService.list(input, userId),
    ).resolves.toMatchObject({ total: 1 });
    expect(mocks.authorizeBrand).toHaveBeenCalledWith(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.read",
    );
    expect(mocks.list).toHaveBeenCalledWith(input, userId);
  });
});

describe("文件夹请求恢复与原子审计", () => {
  const folder = {
    id: documentId,
    ...scope,
    name: "最新名称",
    createdBy: userId,
    creationKey: "private-key",
    creationFingerprint: "private-hash",
    deletedAt: null,
  };
  it("创建重放返回当前名称并隐藏内部记录", async () => {
    mocks.createFolder.mockResolvedValue({ kind: "replayed", row: folder });
    const result = await contentDocumentService.createFolder(
      { ...scope, name: "原名称" },
      userId,
      audit,
      "stable-key",
    );
    expect(result).toMatchObject({
      id: documentId,
      name: "最新名称",
      replayed: true,
    });
    expect(result).not.toHaveProperty("creationKey");
    expect(result).not.toHaveProperty("creationFingerprint");
    expect(result).not.toHaveProperty("deletedAt");
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
  it.each([
    ["conflict", "CONTENT_FOLDER_IDEMPOTENCY_CONFLICT"],
    ["removed", "CONTENT_FOLDER_REMOVED"],
  ])("创建 %s 不伪造成功", async (kind, code) => {
    mocks.createFolder.mockResolvedValue({ kind });
    await expect(
      contentDocumentService.createFolder(
        { ...scope, name: "原名称" },
        userId,
        audit,
        "stable-key",
      ),
    ).rejects.toMatchObject({ status: 409, code });
  });
  it("改名与删除冲突返回可核对的最新名称", async () => {
    mocks.updateFolder.mockResolvedValue({ kind: "conflict", row: folder });
    mocks.deleteFolder.mockResolvedValue({ kind: "conflict", row: folder });
    for (const action of [
      () =>
        contentDocumentService.updateFolder(
          scope,
          documentId,
          "我的名称",
          userId,
          audit,
          "原名称",
        ),
      () =>
        contentDocumentService.deleteFolder(
          scope,
          documentId,
          userId,
          audit,
          "原名称",
        ),
    ])
      await expect(action()).rejects.toMatchObject({
        code: "CONTENT_FOLDER_VERSION_CONFLICT",
        details: { current: { id: documentId, name: "最新名称" } },
      });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

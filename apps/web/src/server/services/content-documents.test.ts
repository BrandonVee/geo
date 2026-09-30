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
    expect(mocks.find).toHaveBeenCalledWith(scope, documentId);
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
    ).resolves.toEqual(document);
    expect(mocks.authorizeBrand).toHaveBeenCalledWith(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.create",
    );
    expect(mocks.create).toHaveBeenCalledWith(input, userId);
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      audit,
      expect.objectContaining({
        operation: "content.document.create",
        resourceId: documentId,
        summary: "导入文档：测试文档",
      }),
    );

    mocks.create.mockResolvedValueOnce({ ok: false, code: "FOLDER_NOT_FOUND" });
    await expect(
      contentDocumentService.create(input, userId, audit),
    ).rejects.toMatchObject({
      status: 404,
      code: "CONTENT_FOLDER_NOT_FOUND",
    });
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["CONTENT_REQUIRED", "CONTENT_DOCUMENT_BODY_REQUIRED", 422],
    ["SOURCE_URL_REQUIRED", "CONTENT_DOCUMENT_SOURCE_URL_REQUIRED", 422],
    ["FOLDER_NOT_FOUND", "CONTENT_FOLDER_NOT_FOUND", 404],
    ["NOT_FOUND", "CONTENT_DOCUMENT_NOT_FOUND", 404],
  ])("更新失败 %s 映射为 %s", async (repositoryCode, code, status) => {
    const input = updateContentDocumentSchema.parse({
      ...scope,
      title: "新标题",
    });
    mocks.update.mockResolvedValueOnce({ ok: false, code: repositoryCode });
    await expect(
      contentDocumentService.update(scope, documentId, input, userId, audit),
    ).rejects.toMatchObject({ status, code });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("恢复历史版本时保留版本号与修改说明，并只在成功后审计", async () => {
    const input = restoreContentDocumentVersionSchema.parse({ ...scope });
    const restored = { ...document, currentVersion: 3 };
    mocks.restore.mockResolvedValueOnce({ ok: true, document: restored });
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
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      audit,
      expect.objectContaining({
        operation: "content.document.version.restore",
        summary: "恢复文档历史版本 v1",
      }),
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
    mocks.update.mockResolvedValueOnce({
      ok: true,
      document: { ...document, status: "archived" },
    });
    await contentDocumentService.archive(scope, documentId, userId, audit);
    expect(mocks.authorizeBrand).toHaveBeenCalledWith(
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      userId,
      "resource.delete",
    );
    expect(mocks.update).toHaveBeenCalledWith(
      scope,
      documentId,
      { ...scope, status: "archived", changeSummary: "归档文档" },
      userId,
    );

    mocks.deleteFolder.mockResolvedValueOnce(false);
    await expect(
      contentDocumentService.deleteFolder(scope, "missing", userId, audit),
    ).rejects.toMatchObject({ code: "CONTENT_FOLDER_NOT_FOUND" });
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });

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
      contentDocumentService.archive(scope, documentId, userId, audit),
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
    expect(mocks.list).toHaveBeenCalledWith(input);
  });
});

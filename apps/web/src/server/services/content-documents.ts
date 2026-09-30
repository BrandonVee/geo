import type {
  ContentDocumentListQuery,
  CreateContentDocumentInput,
  CreateContentFolderInput,
  RestoreContentDocumentVersionInput,
  UpdateContentDocumentInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import {
  isPlatformAdministrator,
  requirePlatformPermission,
} from "@/server/permissions/platform";
import { brandRepository } from "@/server/repositories/brands";
import { organizationRepository } from "@/server/repositories/organizations";
import { contentDocumentRepository } from "@/server/repositories/content-documents";

type Scope = {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
};

function versionConflict(currentVersion: number): never {
  throw new ApiError(
    409,
    "CONTENT_DOCUMENT_VERSION_CONFLICT",
    "文档已被更新，本次内容未保存。请核对最新版本后再保存。",
    { currentVersion },
  );
}

async function authorize(
  scope: Scope,
  userId: string,
  permission:
    | "resource.read"
    | "resource.create"
    | "resource.update"
    | "resource.delete",
) {
  if (await isPlatformAdministrator(userId)) {
    await requirePlatformPermission(userId, permission);
    const organization = await organizationRepository.findById(
      scope.organizationId,
    );
    if (!organization || organization.status === "closed")
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    if (organization.status !== "active")
      throw new ApiError(403, "ORGANIZATION_SUSPENDED", "企业已被冻结或关闭");
    if (
      !(await brandRepository.findTeam(
        scope.organizationId,
        scope.teamBindingId,
      ))
    )
      throw new ApiError(
        404,
        "TEAM_BINDING_NOT_FOUND",
        "企业腾讯范围不存在或已停用",
      );
    if (
      !(await brandRepository.findBrand(
        scope.organizationId,
        scope.teamBindingId,
        scope.brandId,
      ))
    )
      throw new ApiError(404, "BRAND_NOT_FOUND", "品牌不属于当前企业范围");
    return;
  }
  await authorizeBrand(
    scope.organizationId,
    scope.teamBindingId,
    scope.brandId,
    userId,
    permission,
  );
}

export const contentDocumentService = {
  async list(input: ContentDocumentListQuery, userId: string) {
    await authorize(input, userId, "resource.read");
    return contentDocumentRepository.list(input);
  },

  async get(scope: Scope, documentId: string, userId: string) {
    await authorize(scope, userId, "resource.read");
    const document = await contentDocumentRepository.find(scope, documentId);
    if (!document)
      throw new ApiError(404, "CONTENT_DOCUMENT_NOT_FOUND", "文档不存在");
    return document;
  },

  async create(
    input: CreateContentDocumentInput,
    userId: string,
    audit: AuditContext,
  ) {
    await authorize(input, userId, "resource.create");
    const result = await contentDocumentRepository.create(input, userId);
    if (!result.ok)
      throw new ApiError(404, "CONTENT_FOLDER_NOT_FOUND", "目标文件夹不存在");
    await writeAudit(audit, {
      operation: "content.document.create",
      resourceType: "content_document",
      resourceId: result.document.id,
      summary: `${input.source === "imported" ? "导入" : "创建"}文档：${input.title}`,
    });
    return result.document;
  },

  async update(
    scope: Scope,
    documentId: string,
    input: UpdateContentDocumentInput,
    userId: string,
    audit: AuditContext,
  ) {
    await authorize(scope, userId, "resource.update");
    const result = await contentDocumentRepository.update(
      scope,
      documentId,
      input,
      userId,
    );
    if (!result.ok) {
      if (result.code === "VERSION_CONFLICT")
        versionConflict(result.currentVersion);
      if (
        result.code === "CONTENT_REQUIRED" ||
        result.code === "SOURCE_URL_REQUIRED"
      )
        throw new ApiError(
          422,
          result.code === "CONTENT_REQUIRED"
            ? "CONTENT_DOCUMENT_BODY_REQUIRED"
            : "CONTENT_DOCUMENT_SOURCE_URL_REQUIRED",
          result.code === "CONTENT_REQUIRED"
            ? "定稿文档必须包含正文"
            : "导入文档必须保留来源链接",
        );
      throw new ApiError(
        404,
        result.code === "FOLDER_NOT_FOUND"
          ? "CONTENT_FOLDER_NOT_FOUND"
          : "CONTENT_DOCUMENT_NOT_FOUND",
        result.code === "FOLDER_NOT_FOUND" ? "目标文件夹不存在" : "文档不存在",
      );
    }
    await writeAudit(audit, {
      operation: "content.document.update",
      resourceType: "content_document",
      resourceId: documentId,
      summary: `更新文档版本 v${result.document.currentVersion}：${result.document.title}`,
    });
    return result.document;
  },

  async archive(
    scope: Scope & { expectedVersion: number },
    documentId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await authorize(scope, userId, "resource.delete");
    const result = await contentDocumentRepository.update(
      scope,
      documentId,
      { ...scope, status: "archived", changeSummary: "归档文档" },
      userId,
    );
    if (!result.ok) {
      if (result.code === "VERSION_CONFLICT")
        versionConflict(result.currentVersion);
      throw new ApiError(404, "CONTENT_DOCUMENT_NOT_FOUND", "文档不存在");
    }
    await writeAudit(audit, {
      operation: "content.document.archive",
      resourceType: "content_document",
      resourceId: documentId,
      summary: `归档文档：${result.document.title}`,
    });
    return result.document;
  },

  async restoreVersion(
    scope: Scope,
    documentId: string,
    version: number,
    input: RestoreContentDocumentVersionInput,
    userId: string,
    audit: AuditContext,
  ) {
    await authorize(scope, userId, "resource.update");
    const result = await contentDocumentRepository.restore(
      scope,
      documentId,
      version,
      input.changeSummary,
      userId,
      input.expectedVersion,
    );
    if (!result.ok) {
      if (result.code === "VERSION_CONFLICT")
        versionConflict(result.currentVersion);
      throw new ApiError(
        404,
        result.code === "VERSION_NOT_FOUND"
          ? "CONTENT_DOCUMENT_VERSION_NOT_FOUND"
          : "CONTENT_DOCUMENT_NOT_FOUND",
        result.code === "VERSION_NOT_FOUND" ? "历史版本不存在" : "文档不存在",
      );
    }
    await writeAudit(audit, {
      operation: "content.document.version.restore",
      resourceType: "content_document",
      resourceId: documentId,
      summary: `恢复文档历史版本 v${version}`,
    });
    return result.document;
  },

  async listFolders(scope: Scope, userId: string) {
    await authorize(scope, userId, "resource.read");
    return contentDocumentRepository.listFolders(scope);
  },

  async createFolder(
    input: CreateContentFolderInput,
    userId: string,
    audit: AuditContext,
  ) {
    await authorize(input, userId, "resource.create");
    try {
      const folder = await contentDocumentRepository.createFolder(
        input,
        input.name,
        userId,
      );
      await writeAudit(audit, {
        operation: "content.folder.create",
        resourceType: "content_folder",
        resourceId: folder!.id,
        summary: `创建内容文件夹：${input.name}`,
      });
      return folder;
    } catch (error) {
      if (databaseErrorCode(error) === "23505")
        throw new ApiError(409, "CONTENT_FOLDER_EXISTS", "同名文件夹已存在");
      throw error;
    }
  },

  async updateFolder(
    scope: Scope,
    folderId: string,
    name: string,
    userId: string,
    audit: AuditContext,
  ) {
    await authorize(scope, userId, "resource.update");
    try {
      const folder = await contentDocumentRepository.updateFolder(
        scope,
        folderId,
        name,
      );
      if (!folder)
        throw new ApiError(404, "CONTENT_FOLDER_NOT_FOUND", "文件夹不存在");
      await writeAudit(audit, {
        operation: "content.folder.update",
        resourceType: "content_folder",
        resourceId: folderId,
        summary: `重命名内容文件夹：${name}`,
      });
      return folder;
    } catch (error) {
      if (databaseErrorCode(error) === "23505")
        throw new ApiError(409, "CONTENT_FOLDER_EXISTS", "同名文件夹已存在");
      throw error;
    }
  },

  async deleteFolder(
    scope: Scope,
    folderId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await authorize(scope, userId, "resource.delete");
    if (!(await contentDocumentRepository.deleteFolder(scope, folderId)))
      throw new ApiError(404, "CONTENT_FOLDER_NOT_FOUND", "文件夹不存在");
    await writeAudit(audit, {
      operation: "content.folder.delete",
      resourceType: "content_folder",
      resourceId: folderId,
      summary: "删除内容文件夹并将其中文档移至未归档",
    });
  },
};

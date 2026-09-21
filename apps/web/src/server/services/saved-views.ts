import type {
  CreateSavedViewInput,
  UpdateSavedViewInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { organizationRepository } from "@/server/repositories/organizations";
import { savedViewRepository } from "@/server/repositories/saved-views";
async function member(organizationId: string, userId: string) {
  const membership = await organizationRepository.findMembershipRole(
    organizationId,
    userId,
  );
  if (!membership || membership.status !== "active")
    throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
  if (membership.organizationStatus !== "active")
    throw new ApiError(403, "ORGANIZATION_SUSPENDED", "企业已被平台冻结或关闭");
}
async function validateFilters(
  input: { organizationId: string; filters: Record<string, unknown> },
  userId: string,
) {
  await member(input.organizationId, userId);
  if (JSON.stringify(input.filters).length > 20_000)
    throw new ApiError(400, "SAVED_VIEW_TOO_LARGE", "保存视图筛选条件过大");
  const team = input.filters.teamBindingId;
  const brand = input.filters.brandId;
  if (typeof team === "string" && typeof brand === "string")
    await authorizeBrand(
      input.organizationId,
      team,
      brand,
      userId,
      "resource.read",
    );
}
export const savedViewService = {
  async list(organizationId: string, page: string | undefined, userId: string) {
    await member(organizationId, userId);
    return savedViewRepository.list(organizationId, userId, page);
  },
  async create(
    input: CreateSavedViewInput,
    userId: string,
    audit: AuditContext,
  ) {
    await validateFilters(input, userId);
    try {
      const row = await savedViewRepository.create(input, userId);
      await writeAudit(audit, {
        operation: "saved-view.create",
        resourceType: "saved_view",
        resourceId: row.id,
        summary: `保存视图：${row.name}`,
      });
      return row;
    } catch (error) {
      if (databaseErrorCode(error) === "23505")
        throw new ApiError(409, "SAVED_VIEW_NAME_EXISTS", "同名保存视图已存在");
      throw error;
    }
  },
  async update(
    id: string,
    input: UpdateSavedViewInput,
    userId: string,
    audit: AuditContext,
  ) {
    const current = await savedViewRepository.find(
      id,
      input.organizationId,
      userId,
    );
    if (!current)
      throw new ApiError(404, "SAVED_VIEW_NOT_FOUND", "保存视图不存在");
    if (input.filters)
      await validateFilters(
        { organizationId: input.organizationId, filters: input.filters },
        userId,
      );
    else await member(input.organizationId, userId);
    const { organizationId: _, ...changes } = input;
    void _;
    try {
      const row = await savedViewRepository.update(
        id,
        input.organizationId,
        userId,
        changes,
      );
      await writeAudit(audit, {
        operation: "saved-view.update",
        resourceType: "saved_view",
        resourceId: id,
        summary: `更新保存视图：${row!.name}`,
      });
      return row!;
    } catch (error) {
      if (databaseErrorCode(error) === "23505")
        throw new ApiError(409, "SAVED_VIEW_NAME_EXISTS", "同名保存视图已存在");
      throw error;
    }
  },
  async remove(
    id: string,
    organizationId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await member(organizationId, userId);
    const row = await savedViewRepository.remove(id, organizationId, userId);
    if (!row) throw new ApiError(404, "SAVED_VIEW_NOT_FOUND", "保存视图不存在");
    await writeAudit(audit, {
      operation: "saved-view.delete",
      resourceType: "saved_view",
      resourceId: id,
      summary: `删除保存视图：${row.name}`,
    });
  },
};

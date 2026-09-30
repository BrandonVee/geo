import { assertEnterpriseAccess } from "@geo/db";
import {
  answersSavedViewFiltersSchema,
  type CreateSavedViewInput,
  type UpdateSavedViewInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { assertOrganizationFeatureEnabled } from "@/server/permissions/organization-features";
import { brandRepository } from "@/server/repositories/brands";
import type { OrganizationFeature } from "@geo/core";
import { organizationRepository } from "@/server/repositories/organizations";
import { savedViewRepository } from "@/server/repositories/saved-views";
const viewFeature = (page: string): OrganizationFeature =>
  page === "content"
    ? "content"
    : page === "metering"
      ? "balance"
      : "geo_insights";
async function member(organizationId: string, userId: string, page?: string) {
  await assertEnterpriseAccess(organizationId);
  const membership = await organizationRepository.findMembershipRole(
    organizationId,
    userId,
  );
  if (!membership || membership.status !== "active")
    throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
  if (membership.organizationStatus !== "active")
    throw new ApiError(403, "ORGANIZATION_SUSPENDED", "企业已被平台冻结或关闭");
  if (page)
    await assertOrganizationFeatureEnabled(
      organizationId,
      userId,
      "resource.read",
      viewFeature(page),
    );
}
// @project-doc docs/domains/geo_operations.md#report_exports
async function validateFilters(
  input: {
    organizationId: string;
    page: string;
    filters: Record<string, unknown>;
  },
  userId: string,
) {
  await member(input.organizationId, userId, input.page);
  if (JSON.stringify(input.filters).length > 20_000)
    throw new ApiError(400, "SAVED_VIEW_TOO_LARGE", "保存视图筛选条件过大");
  const parsed =
    input.page === "answers"
      ? answersSavedViewFiltersSchema.safeParse(input.filters)
      : undefined;
  if (parsed && !parsed.success)
    throw new ApiError(
      400,
      "SAVED_VIEW_FILTERS_INVALID",
      "保存视图的筛选条件有误",
      parsed.error.issues,
    );
  const filters = parsed?.success ? parsed.data : input.filters;
  let team = filters.teamBindingId;
  const brand = filters.brandId;
  if (
    (team !== undefined && (typeof team !== "string" || !team)) ||
    (brand !== undefined && (typeof brand !== "string" || !brand)) ||
    (team !== undefined && brand === undefined)
  )
    throw new ApiError(
      400,
      "SAVED_VIEW_SCOPE_INVALID",
      "保存视图的品牌范围有误",
    );
  if (typeof brand === "string") {
    team ??= (
      await brandRepository.findTeamForBrand(input.organizationId, brand)
    )?.id;
    if (typeof team !== "string")
      throw new ApiError(404, "BRAND_NOT_FOUND", "品牌不属于当前企业范围");
    await authorizeBrand(
      input.organizationId,
      team,
      brand,
      userId,
      input.page === "metering" ? "balance.read" : "resource.read",
      viewFeature(input.page),
    );
    return { ...filters, teamBindingId: team };
  }
  return filters;
}
export const savedViewService = {
  async list(organizationId: string, page: string | undefined, userId: string) {
    await member(organizationId, userId, page);
    return savedViewRepository.list(organizationId, userId, page);
  },
  async create(
    input: CreateSavedViewInput,
    userId: string,
    audit: AuditContext,
  ) {
    const filters = await validateFilters(input, userId);
    try {
      const row = await savedViewRepository.create(
        { ...input, filters },
        userId,
      );
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
    const filters = input.filters
      ? await validateFilters(
          {
            organizationId: input.organizationId,
            page: current.page,
            filters: input.filters,
          },
          userId,
        )
      : undefined;
    if (!input.filters)
      await member(input.organizationId, userId, current.page);
    const { organizationId: _, ...changes } = input;
    void _;
    try {
      const row = await savedViewRepository.update(
        id,
        input.organizationId,
        userId,
        { ...changes, ...(filters ? { filters } : {}) },
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

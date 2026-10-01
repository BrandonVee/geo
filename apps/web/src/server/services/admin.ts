import type {
  AdminAddOrganizationMemberInput,
  AdminCreateUserInput,
  AdminUpdateUserInput,
} from "@geo/contracts";
import type { Permission } from "@geo/core";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError } from "@/server/http/errors";
import { getUserAccessState } from "@/server/auth/user-access";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { adminRepository } from "@/server/repositories/admin";
import { memberRepository } from "@/server/repositories/members";
import { identityService } from "@/server/modules/identity/identity.service";
import { assertEntitlementCapacity } from "./billing";
import { memberWriteApiError } from "./member-write-error";

type Page = { page: number; pageSize: number; q?: string; status?: string };
type UserPage = Page & {
  accountType?: "admin" | "agent" | "customer";
};
async function allowed(userId: string, permission: Permission) {
  await requirePlatformPermission(userId, permission);
}

function assertAccountIsEffective(
  account: Parameters<typeof getUserAccessState>[0],
) {
  const state = getUserAccessState(account);
  if (state === "disabled")
    throw new ApiError(422, "ACCOUNT_DISABLED", "该账户已停用");
  if (state === "scheduled")
    throw new ApiError(422, "AGENT_NOT_YET_VALID", "代理商账户尚未生效");
  if (state === "expired")
    throw new ApiError(422, "AGENT_EXPIRED", "代理商账户有效期已结束");
}

export const adminService = {
  async overview(userId: string) {
    await allowed(userId, "platform.tenant.read");
    return adminRepository.overview();
  },
  async organizations(input: Page, userId: string) {
    await allowed(userId, "platform.tenant.read");
    if (input.status && !["active", "suspended"].includes(input.status))
      throw new ApiError(400, "VALIDATION_ERROR", "企业状态筛选无效");
    return adminRepository.listOrganizations(input);
  },
  async organization(id: string, userId: string) {
    await allowed(userId, "platform.tenant.read");
    const organization = await adminRepository.findOrganization(id);
    if (!organization)
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    const members = await adminRepository.listOrganizationMembers(id);
    return { organization, members };
  },
  async rejectLocalOrganizationCreation(userId: string) {
    await allowed(userId, "platform.tenant.manage");
    throw new ApiError(
      410,
      "LOCAL_ORGANIZATION_CREATION_DEPRECATED",
      "平台企业仅由腾讯品牌生成，请通过腾讯企业管理接口新增",
    );
  },
  async rejectOrganizationBrandBinding(userId: string) {
    await allowed(userId, "platform.tenant.manage");
    throw new ApiError(
      410,
      "ORGANIZATION_BRAND_BINDING_DEPRECATED",
      "企业与腾讯 BrandID 的关系仅由腾讯企业创建流程生成",
    );
  },
  async updateOrganization(
    id: string,
    input: {
      status?: "active" | "suspended";
      serviceExpiresAt?: string;
      pointsExpiresAt?: string;
    },
    userId: string,
    audit: AuditContext,
  ) {
    await allowed(userId, "platform.tenant.manage");
    const row = await adminRepository.updateOrganization(id, {
      status: input.status,
      serviceExpiresAt: input.serviceExpiresAt
        ? new Date(input.serviceExpiresAt)
        : undefined,
      pointsExpiresAt: input.pointsExpiresAt
        ? new Date(input.pointsExpiresAt)
        : undefined,
    });
    if (!row) throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    await writeAudit(
      { ...audit, organizationId: id },
      {
        operation: "platform.organization.update",
        resourceType: "organization",
        resourceId: id,
        summary: `企业设置：${input.status ?? "状态不变"}；服务到期 ${input.serviceExpiresAt ?? "不变"}；积分到期 ${input.pointsExpiresAt ?? "不变"}`,
      },
    );
    return row;
  },
  async users(input: UserPage, userId: string) {
    await allowed(userId, "platform.user.read");
    if (
      input.status &&
      !["active", "disabled", "scheduled", "expired"].includes(input.status)
    )
      throw new ApiError(400, "VALIDATION_ERROR", "用户状态筛选无效");
    return adminRepository.listUsers(input);
  },
  async user(id: string, userId: string) {
    await allowed(userId, "platform.user.read");
    const user = await adminRepository.findUser(id);
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
    const [memberships, brandAccess, featureScopes, agentQuotaUsage] =
      await Promise.all([
        adminRepository.listUserMemberships(id),
        adminRepository.listUserBrandAccess(id),
        adminRepository.listUserFeatureScopes(id),
        adminRepository.getAgentQuotaUsage(id),
      ]);
    return {
      user,
      memberships,
      brandAccess,
      featureScopes,
      agentQuotaUsage,
    };
  },
  async createUser(
    input: AdminCreateUserInput,
    userId: string,
    audit: AuditContext,
  ) {
    await allowed(userId, "platform.user.manage");
    const row = await identityService.createManagedAccount(input, userId);
    await writeAudit(audit, {
      operation: "platform.user.create",
      resourceType: "user",
      resourceId: row.id,
      summary: `创建${input.accountType}账户 ${input.username}`,
    });
    return row;
  },
  async updateUser(
    id: string,
    input: AdminUpdateUserInput,
    userId: string,
    audit: AuditContext,
  ) {
    await allowed(userId, "platform.user.manage");
    if (id === userId && input.status === "disabled")
      throw new ApiError(
        422,
        "SELF_DISABLE_FORBIDDEN",
        "不能停用当前平台管理员账号",
      );
    const current = await adminRepository.findUser(id);
    if (!current) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
    if (input.accountType && current.accountType === "admin")
      throw new ApiError(
        422,
        "ADMIN_ACCOUNT_TYPE_IMMUTABLE",
        "管理员账户类型不能切换",
      );

    const nextAccountType = input.accountType ?? current.accountType;
    const nextPricingTier =
      nextAccountType === "agent"
        ? (input.pricingTier ??
          (current.accountType === "agent" ? current.pricingTier : "bronze"))
        : "retail";
    if (nextAccountType === "agent" && nextPricingTier === "retail")
      throw new ApiError(
        422,
        "AGENT_PRICING_TIER_REQUIRED",
        "代理商请选择金牌、银牌或铜牌价格等级",
      );
    if (input.accountType && input.accountType !== current.accountType) {
      const constraints = await adminRepository.getUserRoleConstraints(id);
      if (input.accountType === "agent" && constraints.brandAccessCount > 0)
        throw new ApiError(
          409,
          "ACCOUNT_TYPE_ROLE_CONFLICT",
          "该用户仍有品牌级权限，请先移除后再切换为代理商",
        );
      if (input.accountType === "customer" && constraints.tenantAdminCount > 0)
        throw new ApiError(
          409,
          "ACCOUNT_TYPE_ROLE_CONFLICT",
          "该代理商仍是企业管理员，请先转移或移除企业管理员角色",
        );
    }

    const agentValidFrom =
      input.agentValidFrom === undefined
        ? current.agentValidFrom
        : input.agentValidFrom
          ? new Date(input.agentValidFrom)
          : null;
    const agentExpiresAt =
      input.agentExpiresAt === undefined
        ? current.agentExpiresAt
        : input.agentExpiresAt
          ? new Date(input.agentExpiresAt)
          : null;
    if (
      nextAccountType !== "agent" &&
      (input.agentValidFrom || input.agentExpiresAt)
    )
      throw new ApiError(
        422,
        "AGENT_VALIDITY_NOT_APPLICABLE",
        "只有代理商账户可以设置有效期",
      );
    if (nextAccountType !== "agent" && input.agentQuota)
      throw new ApiError(
        422,
        "AGENT_QUOTA_NOT_APPLICABLE",
        "只有代理商账户可以设置企业、品牌和腾讯积分额度",
      );
    if (
      nextAccountType === "agent" &&
      agentValidFrom &&
      agentExpiresAt &&
      agentValidFrom >= agentExpiresAt
    )
      throw new ApiError(
        422,
        "INVALID_AGENT_VALIDITY_RANGE",
        "代理商生效时间必须早于到期时间",
      );

    const accountTypeChanged =
      input.accountType !== undefined &&
      input.accountType !== current.accountType;
    const validityChanged =
      input.agentValidFrom !== undefined || input.agentExpiresAt !== undefined;
    if (input.organizationFeatureScopes) {
      const memberships = await adminRepository.listUserMemberships(id);
      const membershipIds = new Set(
        memberships.map((membership) => membership.organizationId),
      );
      const invalidScope = input.organizationFeatureScopes.find(
        (scope) => !membershipIds.has(scope.organizationId),
      );
      if (invalidScope)
        throw new ApiError(
          422,
          "USER_ORGANIZATION_SCOPE_INVALID",
          "只能设置该用户已加入企业的功能范围",
          { organizationId: invalidScope.organizationId },
        );
    }
    const row = await adminRepository.updateUser(
      id,
      {
        name: input.name,
        status: input.status,
        accountType: accountTypeChanged ? input.accountType : undefined,
        pricingTier:
          input.pricingTier !== undefined || accountTypeChanged
            ? nextPricingTier
            : undefined,
        agentValidFrom:
          nextAccountType === "customer"
            ? accountTypeChanged
              ? null
              : undefined
            : validityChanged || accountTypeChanged
              ? agentValidFrom
              : undefined,
        agentExpiresAt:
          nextAccountType === "customer"
            ? accountTypeChanged
              ? null
              : undefined
            : validityChanged || accountTypeChanged
              ? agentExpiresAt
              : undefined,
        agentEnterpriseLimit:
          nextAccountType === "customer"
            ? accountTypeChanged
              ? null
              : undefined
            : input.agentQuota
              ? input.agentQuota.enterpriseLimit
              : undefined,
        agentBrandLimit:
          nextAccountType === "customer"
            ? accountTypeChanged
              ? null
              : undefined
            : input.agentQuota
              ? input.agentQuota.brandLimit
              : undefined,
        agentAnswerbitPointsLimit:
          nextAccountType === "customer"
            ? accountTypeChanged
              ? null
              : undefined
            : input.agentQuota
              ? input.agentQuota.answerbitPointsLimit
              : undefined,
      },
      input.organizationFeatureScopes,
      userId,
    );
    if (!row) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
    const changes = [
      input.name !== undefined ? `名称 ${current.name} → ${input.name}` : null,
      input.status ? `状态 ${input.status}` : null,
      accountTypeChanged
        ? `类型 ${current.accountType} → ${nextAccountType}`
        : null,
      validityChanged ? "代理商有效期" : null,
      input.agentQuota ? "代理商经营额度" : null,
      input.pricingTier !== undefined || accountTypeChanged
        ? `价格等级 ${nextPricingTier}`
        : null,
      input.organizationFeatureScopes ? "目标企业功能范围" : null,
    ].filter(Boolean);
    await writeAudit(audit, {
      operation: "platform.user.update",
      resourceType: "user",
      resourceId: id,
      summary: `平台管理员更新用户：${changes.join("、")}`,
    });
    return row;
  },
  async addOrganizationMember(
    organizationId: string,
    input: AdminAddOrganizationMemberInput,
    userId: string,
    audit: AuditContext,
  ) {
    await allowed(userId, "platform.tenant.manage");
    const organization = await adminRepository.findOrganization(organizationId);
    if (!organization)
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    const existingMembership = await memberRepository.findMemberByUser(
      organizationId,
      input.userId,
    );
    if (!existingMembership || existingMembership.status === "disabled")
      await assertEntitlementCapacity(organizationId, "members");
    const account = await memberRepository.findUserById(input.userId);
    if (!account) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
    assertAccountIsEffective(account);
    if (input.role === "tenant_admin" && account.accountType === "agent") {
      const [agent, usage] = await Promise.all([
        adminRepository.findUser(input.userId),
        adminRepository.getAgentQuotaUsage(input.userId),
      ]);
      const alreadyTenantAdmin = existingMembership
        ? existingMembership.status === "active" &&
          (await memberRepository.isTenantAdmin(existingMembership.id))
        : false;
      if (
        !alreadyTenantAdmin &&
        agent?.agentEnterpriseLimit !== null &&
        agent?.agentEnterpriseLimit !== undefined &&
        usage.enterpriseCount >= agent.agentEnterpriseLimit
      )
        throw new ApiError(
          422,
          "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
          "代理商企业额度已用尽，请先提高额度再分配企业",
        );
    }
    if (input.role === "tenant_admin" && account.accountType === "customer")
      throw new ApiError(
        422,
        "ACCOUNT_TYPE_MISMATCH",
        "客户账户不能配置为企业管理员",
      );
    if (input.role !== "tenant_admin" && account.accountType === "agent")
      throw new ApiError(
        422,
        "ACCOUNT_TYPE_MISMATCH",
        "代理商账户应配置为企业管理员",
      );
    const brandScope =
      input.role === "tenant_admin"
        ? undefined
        : await memberRepository.findActiveBrandScope(organizationId);
    if (input.role !== "tenant_admin" && !brandScope)
      throw new ApiError(
        422,
        "ENTERPRISE_BRAND_SCOPE_NOT_FOUND",
        "当前企业尚未建立可用的腾讯品牌范围",
      );
    let member;
    try {
      member = await memberRepository.addExistingMember(
        organizationId,
        input.userId,
        { ...input, ...brandScope },
      );
    } catch (error) {
      const capacityError = memberWriteApiError(error);
      if (capacityError) throw capacityError;
      if (
        error instanceof Error &&
        error.message === "AGENT_ENTERPRISE_QUOTA_EXCEEDED"
      )
        throw new ApiError(
          422,
          "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
          "代理商企业额度已用尽，请先提高额度再分配企业",
        );
      throw error;
    }
    await writeAudit(
      { ...audit, organizationId },
      {
        operation: "platform.organization_member.upsert",
        resourceType: "organization_member",
        resourceId: member.id,
        summary: `平台配置成员 ${account.username}，角色 ${input.role}`,
      },
    );
    return { memberId: member.id, userId: account.id, role: input.role };
  },
  async updateOrganizationMember(
    organizationId: string,
    memberId: string,
    status: "active" | "disabled",
    userId: string,
    audit: AuditContext,
  ) {
    await allowed(userId, "platform.tenant.manage");
    const member = await memberRepository.findMember(organizationId, memberId);
    if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "企业成员不存在");
    if (status === "active" && member.status !== "active") {
      const account = await memberRepository.findUserById(member.userId);
      if (!account) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
      assertAccountIsEffective(account);
      if (member.status === "disabled")
        await assertEntitlementCapacity(organizationId, "members");
    }
    if (
      status === "disabled" &&
      member.status === "active" &&
      (await memberRepository.isTenantAdmin(memberId)) &&
      (await memberRepository.countActiveTenantAdmins(organizationId)) <= 1
    )
      throw new ApiError(
        409,
        "LAST_TENANT_ADMIN",
        "企业必须保留至少一名可用管理员",
      );
    let updated;
    try {
      updated = await memberRepository.updateMember(
        organizationId,
        memberId,
        status,
      );
    } catch (error) {
      const capacityError = memberWriteApiError(error);
      if (capacityError) throw capacityError;
      if (
        error instanceof Error &&
        error.message === "AGENT_ENTERPRISE_QUOTA_EXCEEDED"
      )
        throw new ApiError(
          422,
          "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
          "代理商企业额度已用尽，请先提高额度再恢复成员",
        );
      throw error;
    }
    await writeAudit(
      { ...audit, organizationId },
      {
        operation: "platform.organization_member.update",
        resourceType: "organization_member",
        resourceId: memberId,
        summary: `平台将企业成员状态更新为 ${status}`,
      },
    );
    return updated;
  },
  async removeOrganizationMember(
    organizationId: string,
    memberId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await allowed(userId, "platform.tenant.manage");
    const member = await memberRepository.findMember(organizationId, memberId);
    if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "企业成员不存在");
    if (
      member.status === "active" &&
      (await memberRepository.isTenantAdmin(memberId)) &&
      (await memberRepository.countActiveTenantAdmins(organizationId)) <= 1
    )
      throw new ApiError(
        409,
        "LAST_TENANT_ADMIN",
        "企业必须保留至少一名管理员",
      );
    try {
      await memberRepository.removeMember(
        organizationId,
        memberId,
        member.userId,
      );
    } catch (error) {
      throw memberWriteApiError(error) ?? error;
    }
    await writeAudit(
      { ...audit, organizationId },
      {
        operation: "platform.organization_member.delete",
        resourceType: "organization_member",
        resourceId: memberId,
        summary: "平台移除企业成员及其品牌权限",
      },
    );
  },
  async audits(input: Page, userId: string) {
    await allowed(userId, "platform.audit.read");
    if (input.status && !["success", "failed"].includes(input.status))
      throw new ApiError(400, "VALIDATION_ERROR", "审计结果筛选无效");
    return adminRepository.listAudits(input);
  },
  async apiCalls(input: Page, userId: string) {
    await allowed(userId, "platform.answerbit.read");
    if (
      input.status &&
      !["success", "failed", "timeout"].includes(input.status)
    )
      throw new ApiError(400, "VALIDATION_ERROR", "调用状态筛选无效");
    return adminRepository.listApiCalls(input);
  },
};

import type {
  AddOrganizationMemberInput,
  CreateBrandAccessInput,
  UpdateMemberInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { hashPassword } from "better-auth/crypto";
import { writeAudit } from "@/server/audit/write-audit";
import { getUserAccessState } from "@/server/auth/user-access";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { adminRepository } from "@/server/repositories/admin";
import { memberRepository as repository } from "@/server/repositories/members";
import { organizationService } from "./organizations";
import { assertEntitlementCapacity } from "./billing";
import { memberCapacityApiError } from "./member-write-error";

export const memberService = {
  async list(organizationId: string, userId: string) {
    await organizationService.authorize(
      organizationId,
      userId,
      "tenant.member.read",
    );
    const [rows, accesses] = await Promise.all([
      repository.listMemberRows(organizationId),
      repository.listBrandAccess(organizationId),
    ]);
    const members = new Map<
      string,
      {
        id: string;
        userId: string;
        name: string;
        username: string | null;
        status: string;
        joinedAt: Date | null;
        createdAt: Date;
        organizationRoles: string[];
        brandAccess: typeof accesses;
      }
    >();
    for (const row of rows) {
      const member = members.get(row.memberId) ?? {
        id: row.memberId,
        userId: row.userId,
        name: row.name,
        username: row.username,
        status: row.memberStatus,
        joinedAt: row.joinedAt,
        createdAt: row.createdAt,
        organizationRoles: [],
        brandAccess: [],
      };
      if (
        row.organizationRole &&
        !member.organizationRoles.includes(row.organizationRole)
      )
        member.organizationRoles.push(row.organizationRole);
      members.set(row.memberId, member);
    }
    for (const access of accesses) {
      const member = [...members.values()].find(
        (item) => item.userId === access.userId,
      );
      if (member) member.brandAccess.push(access);
    }
    return { members: [...members.values()] };
  },
  async add(
    organizationId: string,
    input: AddOrganizationMemberInput,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "tenant.member.manage",
    );
    const brandScope =
      input.role === "tenant_admin"
        ? undefined
        : await repository.findActiveBrandScope(organizationId);
    if (input.role !== "tenant_admin" && !brandScope)
      throw new ApiError(
        422,
        "ENTERPRISE_BRAND_SCOPE_NOT_FOUND",
        "当前企业尚未建立可用的腾讯品牌范围",
      );
    if ("name" in input) {
      if (!brandScope)
        throw new ApiError(
          422,
          "ENTERPRISE_BRAND_SCOPE_NOT_FOUND",
          "当前企业尚未建立可用的腾讯品牌范围",
        );
      await assertEntitlementCapacity(organizationId, "members");
      let created;
      try {
        created = await repository.createCustomerMember(organizationId, {
          name: input.name,
          username: input.username,
          role: input.role,
          teamBindingId: brandScope.teamBindingId,
          brandId: brandScope.brandId,
          passwordHash: await hashPassword(input.password),
        });
      } catch (error) {
        if (databaseErrorCode(error) === "23505")
          throw new ApiError(
            409,
            "USERNAME_EXISTS",
            "该登录账号已存在，请改用绑定已有账号",
          );
        const capacityError = memberCapacityApiError(error);
        if (capacityError) throw capacityError;
        throw error;
      }
      await writeAudit(audit, {
        operation: "tenant.member.create_account",
        resourceType: "organization_member",
        resourceId: created.member.id,
        summary: `创建客户账号 ${input.username} 并授予 ${input.role}`,
      });
      return {
        memberId: created.member.id,
        username: created.user.username,
        role: input.role,
      };
    }
    const existingUser = await repository.findUserByUsername(input.username);
    if (!existingUser)
      throw new ApiError(
        422,
        "ACCOUNT_NOT_PROVISIONED",
        "该账号尚未创建，请先由平台管理员创建",
      );
    const accessState = getUserAccessState(existingUser);
    if (accessState === "disabled")
      throw new ApiError(422, "ACCOUNT_DISABLED", "该账户已停用");
    if (accessState === "scheduled")
      throw new ApiError(422, "AGENT_NOT_YET_VALID", "代理商账户尚未生效");
    if (accessState === "expired")
      throw new ApiError(422, "AGENT_EXPIRED", "代理商账户有效期已结束");
    if (
      input.role === "tenant_admin" &&
      existingUser.accountType === "customer"
    )
      throw new ApiError(
        422,
        "ACCOUNT_TYPE_MISMATCH",
        "客户账户不能配置为企业管理员",
      );
    if (input.role !== "tenant_admin" && existingUser.accountType === "agent")
      throw new ApiError(
        422,
        "ACCOUNT_TYPE_MISMATCH",
        "代理账户应配置为企业管理员",
      );
    const existingMembership = await repository.findMemberByUser(
      organizationId,
      existingUser.id,
    );
    if (!existingMembership || existingMembership.status === "disabled")
      await assertEntitlementCapacity(organizationId, "members");
    if (input.role === "tenant_admin" && existingUser.accountType === "agent") {
      const alreadyTenantAdmin = existingMembership
        ? existingMembership.status === "active" &&
          (await repository.isTenantAdmin(existingMembership.id))
        : false;
      if (!alreadyTenantAdmin && existingUser.agentEnterpriseLimit !== null) {
        const usage = await adminRepository.getAgentQuotaUsage(existingUser.id);
        if (usage.enterpriseCount >= existingUser.agentEnterpriseLimit)
          throw new ApiError(
            422,
            "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
            "代理商企业额度已用尽，请联系平台管理员调整额度",
          );
      }
    }
    let member;
    try {
      member = await repository.addExistingMember(
        organizationId,
        existingUser.id,
        { ...input, ...brandScope },
      );
    } catch (error) {
      const capacityError = memberCapacityApiError(error);
      if (capacityError) throw capacityError;
      if (
        error instanceof Error &&
        error.message === "AGENT_ENTERPRISE_QUOTA_EXCEEDED"
      )
        throw new ApiError(
          422,
          "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
          "代理商企业额度已用尽，请联系平台管理员调整额度",
        );
      throw error;
    }
    await writeAudit(audit, {
      operation: "tenant.member.add",
      resourceType: "organization_member",
      resourceId: member.id,
      summary: `添加已开通账户，角色 ${input.role}`,
    });
    return { memberId: member.id, username: input.username, role: input.role };
  },
  async update(
    organizationId: string,
    memberId: string,
    input: UpdateMemberInput,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "tenant.member.manage",
    );
    const member = await repository.findMember(organizationId, memberId);
    if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "企业成员不存在");
    if (input.status === "active" && member.status !== "active") {
      const account = await repository.findUserById(member.userId);
      if (!account) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
      const state = getUserAccessState(account);
      if (state === "disabled")
        throw new ApiError(422, "ACCOUNT_DISABLED", "该账户已停用");
      if (state === "scheduled")
        throw new ApiError(422, "AGENT_NOT_YET_VALID", "代理商账户尚未生效");
      if (state === "expired")
        throw new ApiError(422, "AGENT_EXPIRED", "代理商账户有效期已结束");
      if (member.status === "disabled")
        await assertEntitlementCapacity(organizationId, "members");
    }
    if (
      input.status === "disabled" &&
      (await repository.isTenantAdmin(memberId)) &&
      (await repository.countActiveTenantAdmins(organizationId)) <= 1
    )
      throw new ApiError(
        409,
        "LAST_TENANT_ADMIN",
        "企业必须保留至少一名可用管理员",
      );
    let updated;
    try {
      updated = await repository.updateMember(
        organizationId,
        memberId,
        input.status,
      );
    } catch (error) {
      const capacityError = memberCapacityApiError(error);
      if (capacityError) throw capacityError;
      if (
        error instanceof Error &&
        error.message === "AGENT_ENTERPRISE_QUOTA_EXCEEDED"
      )
        throw new ApiError(
          422,
          "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
          "代理商企业额度已用尽，请联系平台管理员调整额度",
        );
      throw error;
    }
    await writeAudit(audit, {
      operation: "tenant.member.update",
      resourceType: "organization_member",
      resourceId: memberId,
      summary: `成员状态更新为 ${input.status}`,
    });
    return updated;
  },
  async remove(
    organizationId: string,
    memberId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "tenant.member.manage",
    );
    const member = await repository.findMember(organizationId, memberId);
    if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "企业成员不存在");
    if (
      (await repository.isTenantAdmin(memberId)) &&
      (await repository.countActiveTenantAdmins(organizationId)) <= 1
    )
      throw new ApiError(
        409,
        "LAST_TENANT_ADMIN",
        "企业必须保留至少一名管理员",
      );
    await repository.removeMember(organizationId, memberId, member.userId);
    await writeAudit(audit, {
      operation: "tenant.member.delete",
      resourceType: "organization_member",
      resourceId: memberId,
      summary: "移除企业成员及其品牌权限",
    });
  },
  async addBrandAccess(
    organizationId: string,
    memberId: string,
    input: CreateBrandAccessInput,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "tenant.member.manage",
    );
    const [member, brandScope] = await Promise.all([
      repository.findMember(organizationId, memberId),
      repository.findActiveBrandScope(organizationId),
    ]);
    if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "企业成员不存在");
    if (!brandScope)
      throw new ApiError(
        422,
        "ENTERPRISE_BRAND_SCOPE_NOT_FOUND",
        "当前企业尚未建立可用的腾讯品牌范围",
      );
    const access = await repository.addBrandAccess(
      organizationId,
      member.userId,
      { ...input, ...brandScope },
    );
    await writeAudit(audit, {
      operation: "tenant.brand_access.upsert",
      resourceType: "brand_access",
      resourceId: access.id,
      summary: `配置品牌 ${brandScope.brandId} 的 ${input.role} 权限`,
    });
    return {
      id: access.id,
      brandId: access.brandId,
      role: access.role,
      createdAt: access.createdAt,
    };
  },
  async removeBrandAccess(
    organizationId: string,
    memberId: string,
    accessId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "tenant.member.manage",
    );
    const member = await repository.findMember(organizationId, memberId);
    if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "企业成员不存在");
    if (
      !(await repository.removeBrandAccess(
        organizationId,
        member.userId,
        accessId,
      ))
    )
      throw new ApiError(404, "BRAND_ACCESS_NOT_FOUND", "品牌权限不存在");
    await writeAudit(audit, {
      operation: "tenant.brand_access.delete",
      resourceType: "brand_access",
      resourceId: accessId,
      summary: "移除成员品牌权限",
    });
  },
};

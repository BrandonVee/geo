import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  assertEntitlementCapacity: vi.fn(),
  findActiveBrandScope: vi.fn(),
  findUserByUsername: vi.fn(),
  findMemberByUser: vi.fn(),
  findMember: vi.fn(),
  findUserById: vi.fn(),
  isTenantAdmin: vi.fn(),
  addExistingMember: vi.fn(),
  createCustomerMember: vi.fn(),
  updateMember: vi.fn(),
  getAgentQuotaUsage: vi.fn(),
  getUserAccessState: vi.fn(),
  hashPassword: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("./organizations", () => ({
  organizationService: { authorize: mocks.authorize },
}));
vi.mock("./billing", () => ({
  assertEntitlementCapacity: mocks.assertEntitlementCapacity,
}));
vi.mock("@/server/repositories/members", () => ({
  memberRepository: mocks,
}));
vi.mock("@/server/repositories/admin", () => ({
  adminRepository: { getAgentQuotaUsage: mocks.getAgentQuotaUsage },
}));
vi.mock("@/server/auth/user-access", () => ({
  getUserAccessState: mocks.getUserAccessState,
}));
vi.mock("@/server/audit/write-audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("better-auth/crypto", () => ({ hashPassword: mocks.hashPassword }));

import { memberService } from "./members";

const organizationId = "e17c707b-f07c-4464-a4fa-26d699dad45b";
const actorUserId = "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8";
const audit = { requestId: "request-1", actorUserId } as Parameters<
  typeof memberService.add
>[3];

describe("企业成员开户与授权", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findActiveBrandScope.mockResolvedValue({
      brandId: "brand-1",
      teamBindingId: "team-binding-1",
    });
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.getUserAccessState.mockReturnValue("active");
    mocks.findMemberByUser.mockResolvedValue(null);
    mocks.findUserById.mockResolvedValue({
      accountType: "agent",
      status: "active",
    });
    mocks.createCustomerMember.mockResolvedValue({
      user: { username: "editor_1" },
      member: { id: "member-1" },
    });
    mocks.addExistingMember.mockResolvedValue({ id: "member-2" });
  });

  it("企业管理员一步创建客户账号并授予本企业品牌角色", async () => {
    await expect(
      memberService.add(
        organizationId,
        {
          name: "张三",
          username: "editor_1",
          password: "safePassword123",
          role: "brand_editor",
        },
        actorUserId,
        audit,
      ),
    ).resolves.toEqual({
      memberId: "member-1",
      username: "editor_1",
      role: "brand_editor",
    });
    expect(mocks.authorize).toHaveBeenCalledWith(
      organizationId,
      actorUserId,
      "tenant.member.manage",
    );
    expect(mocks.createCustomerMember).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        name: "张三",
        username: "editor_1",
        passwordHash: "hashed-password",
        brandId: "brand-1",
        role: "brand_editor",
      }),
    );
    expect(mocks.findUserByUsername).not.toHaveBeenCalled();
  });

  it("账号冲突时提示改为绑定已有账号", async () => {
    mocks.createCustomerMember.mockRejectedValue({ code: "23505" });
    await expect(
      memberService.add(
        organizationId,
        {
          name: "张三",
          username: "editor_1",
          password: "safePassword123",
          role: "brand_editor",
        },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({ status: 409, code: "USERNAME_EXISTS" });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("重新绑定已停用成员时必须重新校验成员额度", async () => {
    mocks.findUserByUsername.mockResolvedValue({
      id: "customer-1",
      accountType: "customer",
    });
    mocks.findMemberByUser.mockResolvedValue({
      id: "member-2",
      status: "disabled",
    });
    mocks.assertEntitlementCapacity.mockRejectedValue({
      status: 402,
      code: "ENTITLEMENT_LIMIT_REACHED",
    });

    await expect(
      memberService.add(
        organizationId,
        { username: "customer_1", role: "brand_editor" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
    expect(mocks.addExistingMember).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("已有活跃成员更新品牌角色不重复占用成员额度", async () => {
    mocks.findUserByUsername.mockResolvedValue({
      id: "customer-1",
      accountType: "customer",
    });
    mocks.findMemberByUser.mockResolvedValue({
      id: "member-2",
      status: "active",
    });

    await memberService.add(
      organizationId,
      { username: "customer_1", role: "brand_editor" },
      actorUserId,
      audit,
    );
    expect(mocks.assertEntitlementCapacity).not.toHaveBeenCalled();
    expect(mocks.addExistingMember).toHaveBeenCalledOnce();
  });

  it("启用已停用成员时必须重新校验成员额度", async () => {
    mocks.findMember.mockResolvedValue({
      id: "member-2",
      userId: "customer-1",
      status: "disabled",
    });
    mocks.assertEntitlementCapacity.mockRejectedValue({
      status: 402,
      code: "ENTITLEMENT_LIMIT_REACHED",
    });

    await expect(
      memberService.update(
        organizationId,
        "member-2",
        { status: "active" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
    expect(mocks.updateMember).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("事务内并发额度冲突返回业务错误", async () => {
    mocks.findUserByUsername.mockResolvedValue({
      id: "customer-1",
      accountType: "customer",
    });
    mocks.addExistingMember.mockRejectedValue(
      new Error("ENTITLEMENT_LIMIT_REACHED"),
    );

    await expect(
      memberService.add(
        organizationId,
        { username: "customer_1", role: "brand_editor" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 402,
      code: "ENTITLEMENT_LIMIT_REACHED",
    });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("事务内恢复成员的额度冲突返回业务错误", async () => {
    mocks.findMember.mockResolvedValue({
      id: "member-2",
      userId: "customer-1",
      status: "disabled",
    });
    mocks.updateMember.mockRejectedValue(
      new Error("ENTITLEMENT_LIMIT_REACHED"),
    );

    await expect(
      memberService.update(
        organizationId,
        "member-2",
        { status: "active" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 402,
      code: "ENTITLEMENT_LIMIT_REACHED",
    });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("绑定代理商为企业管理员时校验代理企业额度", async () => {
    mocks.findUserByUsername.mockResolvedValue({
      id: "agent-1",
      accountType: "agent",
      agentEnterpriseLimit: 1,
    });
    mocks.getAgentQuotaUsage.mockResolvedValue({ enterpriseCount: 1 });
    await expect(
      memberService.add(
        organizationId,
        { username: "agent_1", role: "tenant_admin" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
    });
    expect(mocks.addExistingMember).not.toHaveBeenCalled();
  });

  it("恢复已停用的代理商管理员仍须有可用企业额度", async () => {
    mocks.findUserByUsername.mockResolvedValue({
      id: "agent-1",
      accountType: "agent",
      agentEnterpriseLimit: 1,
    });
    mocks.findMemberByUser.mockResolvedValue({
      id: "member-2",
      status: "disabled",
    });
    mocks.isTenantAdmin.mockResolvedValue(true);
    mocks.getAgentQuotaUsage.mockResolvedValue({ enterpriseCount: 1 });
    await expect(
      memberService.add(
        organizationId,
        { username: "agent_1", role: "tenant_admin" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({
      code: "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
    });
  });

  it("并发授权超过代理额度时返回明确错误", async () => {
    mocks.findUserByUsername.mockResolvedValue({
      id: "agent-1",
      accountType: "agent",
      agentEnterpriseLimit: 2,
    });
    mocks.getAgentQuotaUsage.mockResolvedValue({ enterpriseCount: 1 });
    mocks.addExistingMember.mockRejectedValue(
      new Error("AGENT_ENTERPRISE_QUOTA_EXCEEDED"),
    );
    await expect(
      memberService.add(
        organizationId,
        { username: "agent_1", role: "tenant_admin" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
    });
  });

  it("恢复成员超过代理额度时返回明确错误", async () => {
    mocks.findMember.mockResolvedValue({ id: "member-2", status: "disabled" });
    mocks.updateMember.mockRejectedValue(
      new Error("AGENT_ENTERPRISE_QUOTA_EXCEEDED"),
    );
    await expect(
      memberService.update(
        organizationId,
        "member-2",
        { status: "active" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "AGENT_ENTERPRISE_QUOTA_EXCEEDED",
    });
  });

  it("不能恢复已过期代理商的成员关系", async () => {
    mocks.findMember.mockResolvedValue({
      id: "member-2",
      userId: "agent-1",
      status: "disabled",
    });
    mocks.getUserAccessState.mockReturnValue("expired");
    await expect(
      memberService.update(
        organizationId,
        "member-2",
        { status: "active" },
        actorUserId,
        audit,
      ),
    ).rejects.toMatchObject({ code: "AGENT_EXPIRED" });
    expect(mocks.updateMember).not.toHaveBeenCalled();
  });
});

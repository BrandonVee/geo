import { ApiError } from "@/server/http/errors";

export function memberWriteApiError(error: unknown): ApiError | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message === "LAST_TENANT_ADMIN") {
    const organizations = (
      error as Error & { organizations?: { id: string; name: string }[] }
    ).organizations;
    return new ApiError(
      409,
      "LAST_TENANT_ADMIN",
      organizations?.length
        ? `企业必须保留至少一名可用管理员，请先为 ${organizations
            .slice(0, 3)
            .map((organization) => organization.name)
            .join(
              "、",
            )}${organizations.length > 3 ? ` 等 ${organizations.length} 家企业` : ""} 分配其他管理员`
        : "企业必须保留至少一名可用管理员",
      organizations?.length ? { organizations } : undefined,
    );
  }
  const accountErrors: Record<string, { status: number; message: string }> = {
    MEMBER_NOT_FOUND: { status: 404, message: "企业成员不存在" },
    USER_NOT_FOUND: { status: 404, message: "用户不存在" },
    ACCOUNT_DISABLED: { status: 422, message: "该账户已停用" },
    AGENT_NOT_YET_VALID: { status: 422, message: "代理商账户尚未生效" },
    AGENT_EXPIRED: { status: 422, message: "代理商账户有效期已结束" },
    ACCOUNT_TYPE_MISMATCH: {
      status: 422,
      message: "账号类型与所选企业角色不匹配",
    },
    ACCOUNT_TYPE_ROLE_CONFLICT: {
      status: 409,
      message: "该账号仍有企业管理员或品牌权限，请先移除对应权限再切换账号类型",
    },
    USER_ORGANIZATION_SCOPE_INVALID: {
      status: 422,
      message: "只能设置该用户已加入企业的功能范围",
    },
  };
  const accountError = accountErrors[error.message];
  if (accountError)
    return new ApiError(
      accountError.status,
      error.message,
      accountError.message,
    );
  if (error.message === "ENTITLEMENT_NOT_FOUND")
    return new ApiError(
      402,
      "ENTITLEMENT_NOT_FOUND",
      "当前配置未包含此项资源权限",
    );
  if (error.message === "ENTITLEMENT_LIMIT_REACHED")
    return new ApiError(
      402,
      "ENTITLEMENT_LIMIT_REACHED",
      "企业成员数量已达到配置上限",
    );
  return undefined;
}

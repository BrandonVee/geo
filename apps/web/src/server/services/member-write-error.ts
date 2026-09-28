import { ApiError } from "@/server/http/errors";

export function memberCapacityApiError(error: unknown): ApiError | undefined {
  if (!(error instanceof Error)) return undefined;
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

import type { AuditContext } from "@/server/audit/write-audit";
import { ApiError } from "@/server/http/errors";
import { retryAfterSeconds } from "@/server/http/rate-limit";
import { AnswerBitError } from "@/server/integrations/answerbit/errors";
import { answerBitConnectionRepository as repository } from "@/server/repositories/answerbit-connections";
import { organizationService } from "./organizations";

export const mapUpstreamError = (error: unknown): never => {
  if (!(error instanceof AnswerBitError)) throw error;
  const mapping = {
    unauthorized: [422, "ANSWERBIT_UNAUTHORIZED", "腾讯接入凭证无访问权限"],
    rate_limited: [
      429,
      "ANSWERBIT_RATE_LIMITED",
      "AnswerBit 请求频率过高，请稍后重试",
    ],
    timeout: [504, "ANSWERBIT_TIMEOUT", "AnswerBit 连接超时"],
    upstream: [502, "ANSWERBIT_UNAVAILABLE", "AnswerBit 服务暂时不可用"],
    business: [422, "ANSWERBIT_BUSINESS_ERROR", "AnswerBit 拒绝了当前请求"],
    insufficient_balance: [
      402,
      "ANSWERBIT_POINTS_INSUFFICIENT",
      "品牌或企业的腾讯能力积分不足",
    ],
    invalid_response: [
      502,
      "ANSWERBIT_INVALID_RESPONSE",
      "AnswerBit 返回了无法识别的数据",
    ],
  } as const;
  const [status, code, message] = mapping[error.kind];
  const retryAfter =
    error.kind === "rate_limited" && error.retryAfterMs !== undefined
      ? retryAfterSeconds(error.retryAfterMs)
      : undefined;
  throw new ApiError(
    status,
    code,
    message,
    {
      operation: error.operation,
      httpStatus: error.httpStatus,
      businessCode: error.businessCode,
    },
    retryAfter === undefined ? undefined : { "Retry-After": retryAfter },
  );
};

export const answerBitConnectionService = {
  async list(organizationId: string, userId: string) {
    await organizationService.authorize(
      organizationId,
      userId,
      "answerbit.connection.read",
    );
    return repository.listConnections(organizationId);
  },
  async create(
    organizationId: string,
    userId: string,
  ): Promise<{ id: string }> {
    await organizationService.authorize(
      organizationId,
      userId,
      "answerbit.connection.manage",
    );
    throw new ApiError(
      403,
      "ANSWERBIT_PLATFORM_MANAGED",
      "腾讯接入由平台管理员统一配置",
    );
  },
  async test(
    organizationId: string,
    connectionId: string,
    userId: string,
    requestId: string,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "answerbit.connection.manage",
    );
    void connectionId;
    void requestId;
    throw new ApiError(
      403,
      "ANSWERBIT_PLATFORM_MANAGED",
      "请由平台管理员执行腾讯接入同步检测",
    );
  },
  async rotate(organizationId: string, connectionId: string, userId: string) {
    await organizationService.authorize(
      organizationId,
      userId,
      "answerbit.connection.manage",
    );
    void connectionId;
    throw new ApiError(
      403,
      "ANSWERBIT_PLATFORM_MANAGED",
      "腾讯 API Key 由平台管理员统一配置和轮换",
    );
  },
  async remove(
    organizationId: string,
    connectionId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "answerbit.connection.manage",
    );
    void connectionId;
    void audit;
    throw new ApiError(
      403,
      "ANSWERBIT_PLATFORM_MANAGED",
      "腾讯 API Key 由平台管理员统一管理",
    );
  },
};

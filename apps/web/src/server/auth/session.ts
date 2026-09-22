import { db, platformAnswerbitCredentials } from "@geo/db";
import { isPlatformTencentReady } from "@geo/core";
import { eq } from "drizzle-orm";
import { ApiError } from "@/server/http/errors";
import { auth } from "./auth";
import { assertTrustedWriteOrigin } from "./trusted-origins";
import { getUserAccessState } from "./user-access";
export async function requireUser(
  request: Request,
  options: { allowBeforeTencentConnection?: boolean } = {},
) {
  assertTrustedWriteOrigin(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, "AUTH_REQUIRED", "请先登录");
  const accessState = getUserAccessState(session.user);
  if (accessState === "disabled")
    throw new ApiError(403, "USER_DISABLED", "账号已停用");
  if (accessState === "scheduled")
    throw new ApiError(403, "AGENT_NOT_YET_VALID", "代理商账户尚未到生效时间");
  if (accessState === "expired")
    throw new ApiError(403, "AGENT_EXPIRED", "代理商账户有效期已结束");
  if (!options.allowBeforeTencentConnection) {
    const [configuration] = await db
      .select({
        status: platformAnswerbitCredentials.status,
        teamId: platformAnswerbitCredentials.teamId,
      })
      .from(platformAnswerbitCredentials)
      .where(eq(platformAnswerbitCredentials.id, 1))
      .limit(1);
    if (!isPlatformTencentReady(configuration))
      throw new ApiError(
        422,
        "PLATFORM_TENCENT_CONNECTION_REQUIRED",
        "平台尚未完成腾讯 TeamID 与 API Key 接入",
      );
  }
  return session.user;
}

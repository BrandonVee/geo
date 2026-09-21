import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
export async function PATCH(request: Request) {
  const requestId = createRequestId();
  try {
    await requireUser(request);
    throw new ApiError(
      410,
      "ANSWERBIT_BRAND_PLATFORM_MANAGED",
      "腾讯企业资料只允许在平台管理端修改",
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

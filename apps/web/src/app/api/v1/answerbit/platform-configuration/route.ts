import { organizationQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { platformAnswerbitService } from "@/server/services/platform-answerbit";
import { apiJson } from "@/server/http/response";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = organizationQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(400, "VALIDATION_ERROR", "organizationId 格式错误");
    return apiJson({
      data: await platformAnswerbitService.getForTenant(
        parsed.data.organizationId,
        user.id,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

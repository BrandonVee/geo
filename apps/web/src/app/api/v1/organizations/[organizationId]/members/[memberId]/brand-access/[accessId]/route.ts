import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { memberService } from "@/server/services/members";
import { emptyResponse } from "@/server/http/response";
type Context = {
  params: Promise<{
    organizationId: string;
    memberId: string;
    accessId: string;
  }>;
};
export async function DELETE(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const params = z
      .object({
        organizationId: z.string().uuid(),
        memberId: z.string().uuid(),
        accessId: z.string().uuid(),
      })
      .safeParse(await context.params);
    if (!params.success)
      throw new ApiError(400, "VALIDATION_ERROR", "路径参数有误");
    await memberService.removeBrandAccess(
      params.data.organizationId,
      params.data.memberId,
      params.data.accessId,
      user.id,
      auditContextFromRequest(
        request,
        params.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

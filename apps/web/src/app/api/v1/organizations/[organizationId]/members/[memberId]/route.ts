import { updateMemberSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { memberService } from "@/server/services/members";
import { apiJson, emptyResponse } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
type Context = {
  params: Promise<{ organizationId: string; memberId: string }>;
};
const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
});
export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const params = paramsSchema.safeParse(await context.params);
    const body = updateMemberSchema.safeParse(await readJsonBody(request));
    if (!params.success || !body.success)
      throw new ApiError(400, "VALIDATION_ERROR", "请求参数有误");
    const data = await memberService.update(
      params.data.organizationId,
      params.data.memberId,
      body.data,
      user.id,
      auditContextFromRequest(
        request,
        params.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return apiJson({ data, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function DELETE(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success)
      throw new ApiError(400, "VALIDATION_ERROR", "路径参数有误");
    await memberService.remove(
      params.data.organizationId,
      params.data.memberId,
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

import { organizationQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { answerBitConnectionService } from "@/server/services/answerbit-connections";
import { apiJson, emptyResponse } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
type Context = { params: Promise<{ connectionId: string }> };
const parseId = (value: string) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success)
    throw new ApiError(400, "VALIDATION_ERROR", "connectionId 格式错误");
  return parsed.data;
};
export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const connectionId = parseId((await context.params).connectionId);
    const parsed = organizationQuerySchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const data = await answerBitConnectionService.rotate(
      parsed.data.organizationId,
      connectionId,
      user.id,
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
    const connectionId = parseId((await context.params).connectionId);
    const parsed = organizationQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(400, "VALIDATION_ERROR", "organizationId 格式错误");
    await answerBitConnectionService.remove(
      parsed.data.organizationId,
      connectionId,
      user.id,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

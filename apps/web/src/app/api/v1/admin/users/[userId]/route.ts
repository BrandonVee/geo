import { adminUpdateUserSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { adminService } from "@/server/services/admin";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
type Context = { params: Promise<{ userId: string }> };
async function userIdFrom(context: Context) {
  const parsed = z
    .string()
    .uuid()
    .safeParse((await context.params).userId);
  if (!parsed.success)
    throw new ApiError(400, "VALIDATION_ERROR", "userId 格式错误");
  return parsed.data;
}
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const actor = await requireUser(request);
    const userId = await userIdFrom(context);
    return apiJson({
      data: await adminService.user(userId, actor.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const userId = await userIdFrom(context);
    const parsed = adminUpdateUserSchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "用户权限或额度参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await adminService.updateUser(
        userId,
        parsed.data,
        user.id,
        auditContextFromRequest(request, undefined, user.id, requestId),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

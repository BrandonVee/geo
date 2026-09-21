import { adminUpdateOrganizationSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { adminService } from "@/server/services/admin";
type Context = { params: Promise<{ organizationId: string }> };
async function organizationIdFrom(context: Context) {
  const parsed = z
    .string()
    .uuid()
    .safeParse((await context.params).organizationId);
  if (!parsed.success)
    throw new ApiError(400, "VALIDATION_ERROR", "organizationId 格式错误");
  return parsed.data;
}
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const organizationId = await organizationIdFrom(context);
    return Response.json({
      data: await adminService.organization(organizationId, user.id),
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
    const organizationId = await organizationIdFrom(context);
    const parsed = adminUpdateOrganizationSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "企业状态参数有误",
        parsed.error.issues,
      );
    return Response.json({
      data: await adminService.updateOrganization(
        organizationId,
        parsed.data.status,
        user.id,
        auditContextFromRequest(request, organizationId, user.id, requestId),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

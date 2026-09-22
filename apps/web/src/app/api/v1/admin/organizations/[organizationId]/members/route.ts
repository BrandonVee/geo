import { adminAddOrganizationMemberSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { adminService } from "@/server/services/admin";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

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
    const detail = await adminService.organization(organizationId, user.id);
    return apiJson({ data: detail.members, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const organizationId = await organizationIdFrom(context);
    const parsed = adminAddOrganizationMemberSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "成员参数有误",
        parsed.error.issues,
      );
    const member = await adminService.addOrganizationMember(
      organizationId,
      parsed.data,
      user.id,
      auditContextFromRequest(request, organizationId, user.id, requestId),
    );
    return apiJson(
      { data: member, requestId },
      {
        status: 201,
        headers: {
          Location: `/api/v1/admin/organizations/${organizationId}/members/${member.memberId}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

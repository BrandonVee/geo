import { addOrganizationMemberSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { memberService } from "@/server/services/members";

type Context = { params: Promise<{ organizationId: string }> };

async function parseOrganizationId(context: Context) {
  const result = z
    .string()
    .uuid()
    .safeParse((await context.params).organizationId);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "organizationId 格式错误");
  }
  return result.data;
}

export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();

  try {
    const user = await requireUser(request);
    const organizationId = await parseOrganizationId(context);
    return Response.json({
      data: await memberService.list(organizationId, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();

  try {
    const user = await requireUser(request);
    const organizationId = await parseOrganizationId(context);
    const body = addOrganizationMemberSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!body.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "成员参数有误",
        body.error.issues,
      );
    }

    const member = await memberService.add(
      organizationId,
      body.data,
      user.id,
      auditContextFromRequest(request, organizationId, user.id, requestId),
    );
    return Response.json(
      { data: member, requestId },
      {
        status: 201,
        headers: {
          Location: `/api/v1/organizations/${organizationId}/members/${member.memberId}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

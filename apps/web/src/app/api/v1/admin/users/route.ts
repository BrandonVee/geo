import { adminCreateUserSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { parseAdminUserPage } from "@/server/http/admin-request";
import { adminService } from "@/server/services/admin";
import { apiJson } from "@/server/http/response";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await adminService.users(parseAdminUserPage(request), user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const actor = await requireUser(request);
    const parsed = adminCreateUserSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "账户参数有误",
        parsed.error.issues,
      );
    const user = await adminService.createUser(
      parsed.data,
      actor.id,
      auditContextFromRequest(request, undefined, actor.id, requestId),
    );
    return apiJson(
      { data: user, requestId },
      { status: 201, headers: { Location: `/api/v1/admin/users/${user.id}` } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

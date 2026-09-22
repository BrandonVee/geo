import { createBrandAccessSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { memberService } from "@/server/services/members";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
type Context = {
  params: Promise<{ organizationId: string; memberId: string }>;
};
export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const params = z
      .object({
        organizationId: z.string().uuid(),
        memberId: z.string().uuid(),
      })
      .safeParse(await context.params);
    const body = createBrandAccessSchema.safeParse(await readJsonBody(request));
    if (!params.success || !body.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        body.success ? undefined : body.error.issues,
      );
    const data = await memberService.addBrandAccess(
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
    return apiJson(
      { data, requestId },
      {
        status: 201,
        headers: {
          Location: `/api/v1/organizations/${params.data.organizationId}/members/${params.data.memberId}/brand-access/${data.id}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

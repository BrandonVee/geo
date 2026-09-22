import { movePromptSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { promptService } from "@/server/services/prompts";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
type Context = { params: Promise<{ promptId: string }> };
export async function PUT(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const id = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .safeParse((await context.params).promptId);
    const body = movePromptSchema.safeParse(await readJsonBody(request));
    if (!id.success || !body.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        body.success ? undefined : body.error.issues,
      );
    const { organizationId, teamBindingId, brandId } = body.data;
    return apiJson({
      data: await promptService.move(
        { organizationId, teamBindingId, brandId },
        id.data,
        body.data,
        user.id,
        requestId,
        auditContextFromRequest(request, organizationId, user.id, requestId),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

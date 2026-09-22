import {
  notificationRuleActionSchema,
  notificationRuleSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { notificationService } from "@/server/services/notifications";
import { apiJson, emptyResponse } from "@/server/http/response";

type Context = { params: Promise<{ ruleId: string }> };
export async function PUT(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { ruleId } = await context.params;
    const parsed = notificationRuleSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "通知规则参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await notificationService.replaceRule(
        ruleId,
        parsed.data,
        user.id,
        auditContextFromRequest(
          request,
          parsed.data.organizationId,
          user.id,
          requestId,
        ),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function DELETE(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { ruleId } = await context.params;
    const parsed = notificationRuleActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "通知规则停用参数有误",
        parsed.error.issues,
      );
    await notificationService.disableRule(
      ruleId,
      parsed.data.organizationId,
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

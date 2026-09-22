import {
  notificationRuleListQuerySchema,
  notificationRuleSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { notificationService } from "@/server/services/notifications";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = notificationRuleListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "通知规则查询参数有误",
        parsed.error.issues,
      );
    return apiJson(
      {
        data: await notificationService.listRules(
          parsed.data.organizationId,
          user.id,
        ),
        requestId,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = notificationRuleSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "通知规则参数有误",
        parsed.error.issues,
      );
    const rule = await notificationService.createRule(
      parsed.data,
      user.id,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return apiJson(
      { data: rule, requestId },
      {
        status: 201,
        headers: { Location: `/api/v1/notification-rules/${rule.id}` },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

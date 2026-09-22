import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { platformAnswerbitService } from "@/server/services/platform-answerbit";
import { apiJson } from "@/server/http/response";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await platformAnswerbitService.synchronizeEnterprises(
        user.id,
        auditContextFromRequest(request, undefined, user.id, requestId),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

import { adminCreateAnswerBitCredentialSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { answerBitCredentialService } from "@/server/services/answerbit-credentials";
import { apiJson } from "@/server/http/response";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await answerBitCredentialService.list(user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = adminCreateAnswerBitCredentialSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "AnswerBit Key 配置参数有误",
        parsed.error.issues,
      );
    const credential = await answerBitCredentialService.create(
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
      {
        data: credential,
        requestId,
      },
      {
        status: 201,
        headers: {
          Location: `/api/v1/admin/answerbit-credentials/${credential.id}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

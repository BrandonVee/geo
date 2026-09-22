import { adminUpdateAnswerBitCredentialSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { answerBitCredentialService } from "@/server/services/answerbit-credentials";
import { apiJson, emptyResponse } from "@/server/http/response";

type Context = { params: Promise<{ credentialId: string }> };
async function credentialIdFrom(context: Context) {
  const parsed = z
    .string()
    .uuid()
    .safeParse((await context.params).credentialId);
  if (!parsed.success)
    throw new ApiError(400, "VALIDATION_ERROR", "credentialId 格式错误");
  return parsed.data;
}

export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const credentialId = await credentialIdFrom(context);
    const parsed = adminUpdateAnswerBitCredentialSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "AnswerBit Key 更新参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await answerBitCredentialService.update(
        credentialId,
        parsed.data,
        user.id,
        auditContextFromRequest(request, undefined, user.id, requestId),
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
    const credentialId = await credentialIdFrom(context);
    await answerBitCredentialService.remove(
      credentialId,
      user.id,
      auditContextFromRequest(request, undefined, user.id, requestId),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

import { organizationQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { answerBitConnectionService } from "@/server/services/answerbit-connections";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = organizationQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(400, "VALIDATION_ERROR", "organizationId 格式错误");
    return apiJson({
      data: await answerBitConnectionService.list(
        parsed.data.organizationId,
        user.id,
      ),
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
    const parsed = organizationQuerySchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const data = await answerBitConnectionService.create(
      parsed.data.organizationId,
      user.id,
    );
    return apiJson(
      { data, requestId },
      {
        status: 201,
        headers: { Location: `/api/v1/answerbit/connections/${data.id}` },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

import { teamBindingActionSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { answerBitConnectionService } from "@/server/services/answerbit-connections";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
type Context = { params: Promise<{ connectionId: string }> };
export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const id = z
      .string()
      .uuid()
      .safeParse((await context.params).connectionId);
    const body = teamBindingActionSchema.safeParse(await readJsonBody(request));
    if (!id.success || !body.success)
      throw new ApiError(400, "VALIDATION_ERROR", "请求参数有误");
    return apiJson({
      data: await answerBitConnectionService.test(
        body.data.organizationId,
        id.data,
        user.id,
        requestId,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

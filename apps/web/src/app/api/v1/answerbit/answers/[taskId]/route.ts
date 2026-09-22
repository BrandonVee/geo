import { brandResourceQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { insightService } from "@/server/services/insights";
import { apiJson } from "@/server/http/response";
type Context = { params: Promise<{ taskId: string }> };
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const id = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .safeParse((await context.params).taskId);
    const query = brandResourceQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!id.success || !query.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        query.success ? undefined : query.error.issues,
      );
    return apiJson({
      data: await insightService.taskDetail(
        query.data,
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

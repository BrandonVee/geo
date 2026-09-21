import { createRequestId } from "@geo/core";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "./errors";

export function createMeteringGetRoute<T>(
  schema: z.ZodType<T>,
  load: (input: T, userId: string, requestId: string) => Promise<unknown>,
) {
  return async function GET(request: Request) {
    const requestId = createRequestId();
    try {
      const user = await requireUser(request);
      const parsed = schema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success)
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "计量查询参数有误",
          parsed.error.issues,
        );
      return Response.json({
        data: await load(parsed.data, user.id, requestId),
        requestId,
      });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

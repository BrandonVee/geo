import { createRequestId } from "@geo/core";
import { auth } from "@/server/auth/auth";
import { errorResponse } from "@/server/http/errors";
import { normalizeRetryAfterHeader } from "@/server/http/rate-limit";
import { withRequestId } from "@/server/http/response";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);
const handle = async (
  handler: (request: Request) => Promise<Response>,
  request: Request,
) => {
  const requestId = createRequestId();
  try {
    return withRequestId(
      normalizeRetryAfterHeader(await handler(request)),
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

export const GET = (request: Request) => handle(handlers.GET, request);
export const POST = (request: Request) => handle(handlers.POST, request);

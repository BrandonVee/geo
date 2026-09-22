import { createRequestId } from "@geo/core";
import { auth } from "@/server/auth/auth";
import { assertTrustedWriteOrigin } from "@/server/auth/trusted-origins";
import { errorResponse } from "@/server/http/errors";
import { normalizeRetryAfterHeader } from "@/server/http/rate-limit";
import { withBoundedRequestBody } from "@/server/http/request-body";
import { withRequestId } from "@/server/http/response";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);
const handle = async (
  handler: (request: Request) => Promise<Response>,
  request: Request,
  boundBody = false,
) => {
  const requestId = createRequestId();
  try {
    let forwardedRequest = request;
    if (boundBody) {
      assertTrustedWriteOrigin(request);
      forwardedRequest = await withBoundedRequestBody(request);
    }
    return withRequestId(
      normalizeRetryAfterHeader(await handler(forwardedRequest)),
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

export const GET = (request: Request) => handle(handlers.GET, request);
export const POST = (request: Request) => handle(handlers.POST, request, true);

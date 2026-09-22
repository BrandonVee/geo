import { auth } from "@/server/auth/auth";
import { normalizeRetryAfterHeader } from "@/server/http/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);
const handle = async (
  handler: (request: Request) => Promise<Response>,
  request: Request,
) => normalizeRetryAfterHeader(await handler(request));

export const GET = (request: Request) => handle(handlers.GET, request);
export const POST = (request: Request) => handle(handlers.POST, request);

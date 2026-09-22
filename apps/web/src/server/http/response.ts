const requestIdFrom = (body: unknown) => {
  if (!body || typeof body !== "object" || !("requestId" in body))
    return undefined;
  const requestId = (body as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : undefined;
};

export function apiJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  const requestId = requestIdFrom(body);
  if (requestId) headers.set("X-Request-ID", requestId);
  return Response.json(body, { ...init, headers });
}

export function emptyResponse(requestId: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Request-ID", requestId);
  return new Response(null, { status: 204, ...init, headers });
}

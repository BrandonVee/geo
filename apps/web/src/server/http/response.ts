const requestIdFrom = (body: unknown) => {
  if (!body || typeof body !== "object" || !("requestId" in body))
    return undefined;
  const requestId = (body as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : undefined;
};

export function copyResponseHeaders(source: Headers) {
  const headers = new Headers(source);
  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  if (!getSetCookie) return headers;

  const cookies = getSetCookie.call(source);
  if (cookies.length === 0) return headers;
  headers.delete("Set-Cookie");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

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

export function withRequestId(response: Response, requestId: string) {
  const headers = copyResponseHeaders(response.headers);
  headers.set("X-Request-ID", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const DEFAULT_UPSTREAM_JSON_LIMIT_BYTES = 16 * 1024 * 1024;

export type BoundedJsonResponseErrorKind = "BODY_TOO_LARGE" | "INVALID_JSON";

export class BoundedJsonResponseError extends Error {
  constructor(public readonly kind: BoundedJsonResponseErrorKind) {
    super(`UPSTREAM_${kind}`);
  }
}

export async function discardResponseBody(response: Response) {
  if (!response.body || response.body.locked) return;
  await response.body.cancel().catch(() => undefined);
}

const declaredLengthExceeds = (response: Response, maxBytes: number) => {
  const contentLength = response.headers.get("Content-Length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return false;
  return Number(contentLength) > maxBytes;
};

export async function readBoundedJsonResponse(
  response: Response,
  maxBytes = DEFAULT_UPSTREAM_JSON_LIMIT_BYTES,
): Promise<unknown> {
  if (!response.body) throw new BoundedJsonResponseError("INVALID_JSON");
  if (declaredLengthExceeds(response, maxBytes)) {
    await discardResponseBody(response);
    throw new BoundedJsonResponseError("BODY_TOO_LARGE");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedJsonResponseError("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new BoundedJsonResponseError("INVALID_JSON");
  }
}

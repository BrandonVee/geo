import { ApiError } from "./errors";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

const readableLimit = (maxBytes: number) =>
  maxBytes % (1024 * 1024) === 0
    ? `${maxBytes / (1024 * 1024)} MiB`
    : `${maxBytes} 字节`;

const payloadTooLarge = (maxBytes: number) =>
  new ApiError(
    413,
    "PAYLOAD_TOO_LARGE",
    `JSON 请求体不能超过 ${readableLimit(maxBytes)}`,
  );

const declaredLengthExceeds = (request: Request, maxBytes: number) => {
  const contentLength = request.headers.get("Content-Length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return false;
  return Number(contentLength) > maxBytes;
};

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<unknown> {
  if (declaredLengthExceeds(request, maxBytes)) throw payloadTooLarge(maxBytes);
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw payloadTooLarge(maxBytes);
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

import { setTimeout as delay } from "node:timers/promises";
import type { AnswerBitOperation } from "@geo/core";
import { z } from "zod";
import { AnswerBitError } from "./errors";
const envelopeSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.unknown(),
});
const retryAfterMs = (value: string | null) => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(5_000, seconds * 1000);
  const instant = Date.parse(value);
  return Number.isNaN(instant)
    ? undefined
    : Math.min(5_000, Math.max(0, instant - Date.now()));
};
export class AnswerBitClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.ANSWERBIT_BASE_URL ??
      "https://answerbit.qq.com",
  ) {}
  async post<T>(
    operation: AnswerBitOperation,
    payload: unknown,
    schema: z.ZodType<T>,
    requestId: string,
    options: {
      retries?: number;
      timeoutMs?: number;
      retryRateLimited?: boolean;
      retryTransient?: boolean;
    } = {},
  ): Promise<T> {
    const retries = options.retries ?? 0;
    const timeoutMs = options.timeoutMs ?? 15_000;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(new URL(operation, this.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-API-Key": this.apiKey,
            "X-Request-ID": requestId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 401 || response.status === 403)
          throw new AnswerBitError("unauthorized", operation, response.status);
        if (response.status === 429)
          throw new AnswerBitError(
            "rate_limited",
            operation,
            response.status,
            undefined,
            retryAfterMs(response.headers.get("retry-after")),
          );
        if (response.status >= 500)
          throw new AnswerBitError("upstream", operation, response.status);
        if (!response.ok)
          throw new AnswerBitError("business", operation, response.status);
        const envelope = envelopeSchema.safeParse(await response.json());
        if (!envelope.success)
          throw new AnswerBitError(
            "invalid_response",
            operation,
            response.status,
          );
        if (envelope.data.code !== 0)
          throw new AnswerBitError(
            "business",
            operation,
            response.status,
            envelope.data.code,
          );
        const parsed = schema.safeParse(envelope.data.data);
        if (!parsed.success)
          throw new AnswerBitError(
            "invalid_response",
            operation,
            response.status,
          );
        return parsed.data;
      } catch (error) {
        const normalized =
          error instanceof AnswerBitError
            ? error
            : new AnswerBitError(
                error instanceof DOMException && error.name === "TimeoutError"
                  ? "timeout"
                  : "upstream",
                operation,
              );
        const retryable =
          ((normalized.kind === "timeout" || normalized.kind === "upstream") &&
            options.retryTransient !== false) ||
          (normalized.kind === "rate_limited" &&
            options.retryRateLimited === true);
        if (!retryable || attempt === retries) throw normalized;
        await delay(normalized.retryAfterMs ?? 500 * 2 ** attempt);
      }
    }
    throw new AnswerBitError("upstream", operation);
  }
}

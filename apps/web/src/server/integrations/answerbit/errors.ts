export type AnswerBitErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "upstream"
  | "business"
  | "insufficient_balance"
  | "invalid_response";
export class AnswerBitError extends Error {
  constructor(
    public readonly kind: AnswerBitErrorKind,
    public readonly operation: string,
    public readonly httpStatus?: number,
    public readonly businessCode?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(`AnswerBit ${kind} (${operation})`);
  }
}

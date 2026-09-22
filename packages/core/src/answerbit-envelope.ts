export type AnswerBitEnvelope = {
  code: number;
  msg?: string;
  data: unknown;
};

export class InvalidAnswerBitEnvelopeError extends Error {
  constructor() {
    super("ANSWERBIT_INVALID_ENVELOPE");
  }
}

export function parseAnswerBitEnvelope(value: unknown): AnswerBitEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidAnswerBitEnvelopeError();

  const envelope = value as Record<string, unknown>;
  if (
    typeof envelope.code !== "number" ||
    !Number.isFinite(envelope.code) ||
    !Object.prototype.hasOwnProperty.call(envelope, "data") ||
    (envelope.msg !== undefined && typeof envelope.msg !== "string")
  )
    throw new InvalidAnswerBitEnvelopeError();

  return {
    code: envelope.code,
    ...(envelope.msg === undefined ? {} : { msg: envelope.msg }),
    data: envelope.data,
  };
}

export type AnswerBitDataSchema<T> = {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error?: unknown };
};

export class InvalidAnswerBitDataError extends Error {
  constructor() {
    super("ANSWERBIT_INVALID_DATA");
  }
}

export class AnswerBitHttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP_${status}`);
  }
}

export class AnswerBitBusinessError extends Error {
  constructor(public readonly code: number) {
    super(`BUSINESS_${code}`);
  }
}

export function isConfirmedAnswerBitRejection(error: unknown) {
  return (
    error instanceof AnswerBitBusinessError ||
    (error instanceof AnswerBitHttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408)
  );
}

export function parseAnswerBitData<T>(
  schema: AnswerBitDataSchema<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidAnswerBitDataError();
  return parsed.data;
}

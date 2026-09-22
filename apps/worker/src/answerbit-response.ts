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

export function parseAnswerBitData<T>(
  schema: AnswerBitDataSchema<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidAnswerBitDataError();
  return parsed.data;
}

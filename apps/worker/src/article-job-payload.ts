import {
  answerBitArticleCreatePayloadSchema,
  type AnswerBitArticleCreatePayload,
} from "@geo/contracts";

const maxEncryptedArticlePayloadCharacters = 512 * 1024;

export class InvalidArticleJobPayloadError extends Error {
  constructor() {
    super("INVALID_ARTICLE_JOB_PAYLOAD");
  }
}

export function parseArticleJobPayload(
  storedPayload: unknown,
  decrypt: (ciphertext: string) => string,
  expected: {
    brandId: string;
    templateType: number | null;
    language: string | null;
  },
): AnswerBitArticleCreatePayload {
  if (
    !storedPayload ||
    typeof storedPayload !== "object" ||
    Array.isArray(storedPayload)
  )
    throw new InvalidArticleJobPayloadError();

  const keys = Object.keys(storedPayload);
  const ciphertext = (storedPayload as Record<string, unknown>).ciphertext;
  if (
    keys.length !== 1 ||
    keys[0] !== "ciphertext" ||
    typeof ciphertext !== "string" ||
    ciphertext.length === 0 ||
    ciphertext.length > maxEncryptedArticlePayloadCharacters
  )
    throw new InvalidArticleJobPayloadError();

  let value: unknown;
  try {
    value = JSON.parse(decrypt(ciphertext));
  } catch {
    throw new InvalidArticleJobPayloadError();
  }

  const parsed = answerBitArticleCreatePayloadSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.brand_id !== expected.brandId ||
    parsed.data.template_type !== expected.templateType ||
    parsed.data.language !== expected.language
  )
    throw new InvalidArticleJobPayloadError();

  return parsed.data;
}

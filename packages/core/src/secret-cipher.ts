import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const canonicalBase64Url = /^[A-Za-z0-9_-]*$/;

function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!canonicalBase64Url.test(value)) throw new InvalidSecretEnvelopeError();
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  )
    throw new InvalidSecretEnvelopeError();
  return decoded;
}

export class InvalidSecretEnvelopeError extends Error {
  constructor() {
    super("INVALID_SECRET_ENVELOPE");
    this.name = "InvalidSecretEnvelopeError";
  }
}

// @project-doc docs/architecture/data_and_security.md#credential_encryption
export class SecretCipher {
  private readonly key: Buffer;

  constructor(
    encodedKey: string,
    private readonly keyVersion = 1,
  ) {
    this.key = Buffer.from(encodedKey, "base64");
    if (this.key.length !== 32 || this.key.toString("base64") !== encodedKey)
      throw new Error(
        "APP_ENCRYPTION_KEY must be a canonical base64 encoded 32-byte key",
      );
    if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0)
      throw new Error("SECRET_KEY_VERSION must be a positive safe integer");
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      `v${this.keyVersion}`,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(envelope: string, context: string): string {
    try {
      const parts = envelope.split(".");
      if (parts.length !== 4) throw new InvalidSecretEnvelopeError();
      const [version, encodedIv, encodedTag, encodedCiphertext] = parts;
      if (version !== `v${this.keyVersion}`)
        throw new InvalidSecretEnvelopeError();
      const iv = decodeBase64Url(encodedIv, 12);
      const tag = decodeBase64Url(encodedTag, 16);
      const ciphertext = decodeBase64Url(encodedCiphertext);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      if (error instanceof InvalidSecretEnvelopeError) throw error;
      throw new InvalidSecretEnvelopeError();
    }
  }

  fingerprint(secret: string): string {
    return createHmac("sha256", this.key).update(secret).digest("hex");
  }
}

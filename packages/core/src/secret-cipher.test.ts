import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidSecretEnvelopeError, SecretCipher } from "./secret-cipher";

const encodedKey = randomBytes(32).toString("base64");

describe("SecretCipher", () => {
  it.each(["secret", "", "密文内容"])(
    "round-trips canonical authenticated envelopes for %j",
    (plaintext) => {
      const cipher = new SecretCipher(encodedKey);
      const envelope = cipher.encrypt(plaintext, "tenant-a");
      const [version, iv, tag, ciphertext] = envelope.split(".");

      expect(version).toBe("v1");
      expect(Buffer.from(iv, "base64url")).toHaveLength(12);
      expect(Buffer.from(tag, "base64url")).toHaveLength(16);
      expect(Buffer.from(ciphertext, "base64url").toString("base64url")).toBe(
        ciphertext,
      );
      expect(cipher.decrypt(envelope, "tenant-a")).toBe(plaintext);
    },
  );

  it.each([
    [
      "missing segment",
      (value: string) => value.split(".").slice(0, 3).join("."),
    ],
    ["extra segment", (value: string) => `${value}.ignored`],
    [
      "padded IV",
      (value: string) => {
        const parts = value.split(".");
        parts[1] += "=";
        return parts.join(".");
      },
    ],
    [
      "short authentication tag",
      (value: string) => {
        const parts = value.split(".");
        parts[2] = Buffer.alloc(15).toString("base64url");
        return parts.join(".");
      },
    ],
    [
      "short IV",
      (value: string) => {
        const parts = value.split(".");
        parts[1] = Buffer.alloc(11).toString("base64url");
        return parts.join(".");
      },
    ],
    ["unsupported version", (value: string) => value.replace(/^v1\./, "v2.")],
  ])("rejects a %s", (_name, mutate) => {
    const cipher = new SecretCipher(encodedKey);
    const envelope = mutate(cipher.encrypt("secret", "tenant-a"));
    expect(() => cipher.decrypt(envelope, "tenant-a")).toThrow(
      InvalidSecretEnvelopeError,
    );
  });

  it("normalizes authentication and context failures", () => {
    const cipher = new SecretCipher(encodedKey);
    const envelope = cipher.encrypt("secret", "tenant-a");
    expect(() => cipher.decrypt(envelope, "tenant-b")).toThrowError(
      "INVALID_SECRET_ENVELOPE",
    );

    const parts = envelope.split(".");
    parts[3] = `${parts[3].startsWith("A") ? "B" : "A"}${parts[3].slice(1)}`;
    expect(() => cipher.decrypt(parts.join("."), "tenant-a")).toThrowError(
      "INVALID_SECRET_ENVELOPE",
    );
  });

  it.each([
    ["trailing characters", `${encodedKey}@@`],
    ["missing padding", encodedKey.replace(/=$/, "")],
    ["leading whitespace", ` ${encodedKey}`],
  ])("rejects a noncanonical encryption key with %s", (_name, key) => {
    expect(() => new SecretCipher(key)).toThrow(
      "APP_ENCRYPTION_KEY must be a canonical base64 encoded 32-byte key",
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid key version %s",
    (version) => {
      expect(() => new SecretCipher(encodedKey, version)).toThrow(
        "SECRET_KEY_VERSION must be a positive safe integer",
      );
    },
  );
});

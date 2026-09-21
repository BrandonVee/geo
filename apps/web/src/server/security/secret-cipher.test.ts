import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { maskApiKey, SecretCipher } from "./secret-cipher";
describe("SecretCipher", () => {
  const cipher = new SecretCipher(randomBytes(32).toString("base64"));
  it("使用组织上下文加密并解密", () => {
    const encrypted = cipher.encrypt("secret-api-key", "org-a");
    expect(encrypted).not.toContain("secret-api-key");
    expect(cipher.decrypt(encrypted, "org-a")).toBe("secret-api-key");
  });
  it("拒绝跨组织解密", () => {
    const encrypted = cipher.encrypt("secret-api-key", "org-a");
    expect(() => cipher.decrypt(encrypted, "org-b")).toThrow();
  });
  it("生成稳定但不可逆的指纹", () => {
    expect(cipher.fingerprint("key")).toBe(cipher.fingerprint("key"));
    expect(cipher.fingerprint("key")).not.toContain("key");
  });
  it("掩码不暴露完整密钥", () =>
    expect(maskApiKey("abcd12345678wxyz")).toBe("abcd********wxyz"));
});

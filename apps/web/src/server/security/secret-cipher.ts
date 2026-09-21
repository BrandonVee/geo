import { SecretCipher } from "@geo/core";
import { getServerEnv } from "../env";
export { SecretCipher } from "@geo/core";

export const maskApiKey = (value: string) =>
  value.length <= 8
    ? "********"
    : `${value.slice(0, 4)}${"*".repeat(8)}${value.slice(-4)}`;
export function getSecretCipher() {
  return new SecretCipher(getServerEnv().APP_ENCRYPTION_KEY);
}

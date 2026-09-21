import {
  FrogPublicationClient,
  frogPublicationClient as environmentClient,
} from "@geo/publication";
import { platformFrogCredentialAad } from "@geo/core";
import { platformFrogRepository } from "@/server/repositories/platform-frog";
import { getSecretCipher } from "@/server/security/secret-cipher";

export async function resolveFrogPublicationClient() {
  const configuration = await platformFrogRepository.getConfiguration();
  if (configuration?.status !== "active") return environmentClient;
  return new FrogPublicationClient(
    getSecretCipher().decrypt(
      configuration.encryptedApiKey,
      platformFrogCredentialAad,
    ),
    configuration.baseUrl,
  );
}

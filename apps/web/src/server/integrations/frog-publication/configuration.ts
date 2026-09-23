import { FrogPublicationClient } from "@geo/publication";
import { platformFrogCredentialAad } from "@geo/core";
import { getServerEnv } from "@/server/env";
import { platformFrogRepository } from "@/server/repositories/platform-frog";
import { getSecretCipher } from "@/server/security/secret-cipher";

export async function resolveFrogPublicationClient() {
  const configuration = await platformFrogRepository.getConfiguration();
  if (configuration?.status !== "active") {
    const environment = getServerEnv();
    return new FrogPublicationClient(
      environment.FROG_PUBLICATION_API_KEY,
      environment.FROG_PUBLICATION_BASE_URL,
    );
  }
  return new FrogPublicationClient(
    getSecretCipher().decrypt(
      configuration.encryptedApiKey,
      platformFrogCredentialAad,
    ),
    configuration.baseUrl,
  );
}

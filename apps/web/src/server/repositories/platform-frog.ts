import { db, platformFrogCredentials } from "@geo/db";
import { eq, sql } from "drizzle-orm";

export const platformFrogRepository = {
  async getConfiguration() {
    const [configuration] = await db
      .select()
      .from(platformFrogCredentials)
      .where(eq(platformFrogCredentials.id, 1))
      .limit(1);
    return configuration;
  },

  async upsertConfiguration(input: {
    baseUrl: string;
    encryptedApiKey: string;
    apiKeyFingerprint: string;
    apiKeyHint: string;
    userId: string;
    checkedAt: Date;
  }) {
    const [configuration] = await db
      .insert(platformFrogCredentials)
      .values({
        id: 1,
        baseUrl: input.baseUrl,
        encryptedApiKey: input.encryptedApiKey,
        apiKeyFingerprint: input.apiKeyFingerprint,
        apiKeyHint: input.apiKeyHint,
        status: "active",
        lastCheckedAt: input.checkedAt,
        updatedBy: input.userId,
      })
      .onConflictDoUpdate({
        target: platformFrogCredentials.id,
        set: {
          baseUrl: input.baseUrl,
          encryptedApiKey: input.encryptedApiKey,
          apiKeyFingerprint: input.apiKeyFingerprint,
          apiKeyHint: input.apiKeyHint,
          keyVersion: sql`${platformFrogCredentials.keyVersion} + 1`,
          status: "active",
          lastCheckedAt: input.checkedAt,
          updatedBy: input.userId,
          updatedAt: input.checkedAt,
        },
      })
      .returning();
    return configuration!;
  },
};

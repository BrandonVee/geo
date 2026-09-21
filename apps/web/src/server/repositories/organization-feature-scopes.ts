import { db, organizationUserFeatureScopes } from "@geo/db";
import { and, eq } from "drizzle-orm";

export const organizationFeatureScopeRepository = {
  async find(organizationId: string, userId: string) {
    const [scope] = await db
      .select({ features: organizationUserFeatureScopes.features })
      .from(organizationUserFeatureScopes)
      .where(
        and(
          eq(organizationUserFeatureScopes.organizationId, organizationId),
          eq(organizationUserFeatureScopes.userId, userId),
        ),
      )
      .limit(1);
    return scope;
  },
};

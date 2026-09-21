import {
  answerbitApiCalls,
  answerbitBrandMappings,
  answerbitConnections,
  answerbitTeamBindings,
  db,
  organizations,
  platformAnswerbitBrands,
  platformAnswerbitCredentials,
} from "@geo/db";
import { platformAnswerBitConnectionSentinel } from "@geo/core";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";

export const platformAnswerbitRepository = {
  async getConfiguration() {
    const [configuration] = await db
      .select()
      .from(platformAnswerbitCredentials)
      .where(eq(platformAnswerbitCredentials.id, 1))
      .limit(1);
    return configuration;
  },

  async upsertConfiguration(input: {
    teamId: string;
    permissions: string[];
    encryptedApiKey: string;
    apiKeyFingerprint: string;
    apiKeyHint: string;
    userId: string;
    checkedAt: Date;
  }) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('tencent-enterprise-directory-sync'))`,
      );
      const [configuration] = await tx
        .insert(platformAnswerbitCredentials)
        .values({
          id: 1,
          teamId: input.teamId,
          permissions: input.permissions,
          encryptedApiKey: input.encryptedApiKey,
          apiKeyFingerprint: input.apiKeyFingerprint,
          apiKeyHint: input.apiKeyHint,
          status: "active",
          lastCheckedAt: input.checkedAt,
          lastSyncedAt: input.checkedAt,
          updatedBy: input.userId,
        })
        .onConflictDoUpdate({
          target: platformAnswerbitCredentials.id,
          set: {
            teamId: input.teamId,
            permissions: input.permissions,
            encryptedApiKey: input.encryptedApiKey,
            apiKeyFingerprint: input.apiKeyFingerprint,
            apiKeyHint: input.apiKeyHint,
            keyVersion: sql`${platformAnswerbitCredentials.keyVersion} + 1`,
            status: "active",
            lastCheckedAt: input.checkedAt,
            lastSyncedAt: input.checkedAt,
            updatedBy: input.userId,
            updatedAt: input.checkedAt,
          },
        })
        .returning();

      await tx
        .update(answerbitConnections)
        .set({
          apiKeyHint: input.apiKeyHint,
          status: "active",
          lastCheckedAt: input.checkedAt,
          updatedAt: input.checkedAt,
        })
        .where(
          and(
            eq(
              answerbitConnections.encryptedApiKey,
              platformAnswerBitConnectionSentinel,
            ),
            sql`exists (select 1 from ${organizations} active_organization where active_organization.id = ${answerbitConnections.organizationId} and active_organization.status <> 'closed')`,
          ),
        );
      return configuration;
    });
  },

  listBrands() {
    return db
      .select({
        id: platformAnswerbitBrands.id,
        brandId: platformAnswerbitBrands.brandId,
        brandName: platformAnswerbitBrands.brandName,
        syncedAt: platformAnswerbitBrands.syncedAt,
        alias: answerbitBrandMappings.alias,
        website: answerbitBrandMappings.website,
        description: answerbitBrandMappings.description,
        note: answerbitBrandMappings.note,
        websiteAutoTrace: answerbitBrandMappings.websiteAutoTrace,
        organizationId: answerbitBrandMappings.organizationId,
        organizationName: organizations.name,
      })
      .from(platformAnswerbitBrands)
      .leftJoin(
        answerbitBrandMappings,
        eq(answerbitBrandMappings.brandId, platformAnswerbitBrands.brandId),
      )
      .leftJoin(
        organizations,
        eq(organizations.id, answerbitBrandMappings.organizationId),
      )
      .where(or(isNull(organizations.id), ne(organizations.status, "closed")))
      .orderBy(asc(platformAnswerbitBrands.brandName));
  },

  listMeteringScopes() {
    return db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: sql<string>`'super_admin'`,
        teamBindingId: answerbitBrandMappings.teamBindingId,
      })
      .from(organizations)
      .innerJoin(
        answerbitBrandMappings,
        eq(answerbitBrandMappings.organizationId, organizations.id),
      )
      .innerJoin(
        answerbitTeamBindings,
        and(
          eq(answerbitTeamBindings.id, answerbitBrandMappings.teamBindingId),
          eq(answerbitTeamBindings.organizationId, organizations.id),
          eq(answerbitTeamBindings.status, "active"),
        ),
      )
      .where(ne(organizations.status, "closed"))
      .orderBy(asc(organizations.name));
  },

  async findBrand(brandId: string) {
    const [brand] = await db
      .select({
        id: platformAnswerbitBrands.id,
        brandId: platformAnswerbitBrands.brandId,
        brandName: platformAnswerbitBrands.brandName,
        syncedAt: platformAnswerbitBrands.syncedAt,
        alias: answerbitBrandMappings.alias,
        website: answerbitBrandMappings.website,
        description: answerbitBrandMappings.description,
        note: answerbitBrandMappings.note,
        websiteAutoTrace: answerbitBrandMappings.websiteAutoTrace,
        organizationId: answerbitBrandMappings.organizationId,
        organizationName: organizations.name,
      })
      .from(platformAnswerbitBrands)
      .leftJoin(
        answerbitBrandMappings,
        eq(answerbitBrandMappings.brandId, platformAnswerbitBrands.brandId),
      )
      .leftJoin(
        organizations,
        eq(organizations.id, answerbitBrandMappings.organizationId),
      )
      .where(
        and(
          eq(platformAnswerbitBrands.brandId, brandId),
          or(isNull(organizations.id), ne(organizations.status, "closed")),
        ),
      )
      .limit(1);
    return brand;
  },

  async findBrandByOrganization(organizationId: string) {
    const [brand] = await db
      .select({
        brandId: platformAnswerbitBrands.brandId,
        brandName: platformAnswerbitBrands.brandName,
        syncedAt: platformAnswerbitBrands.syncedAt,
      })
      .from(platformAnswerbitBrands)
      .innerJoin(
        answerbitBrandMappings,
        and(
          eq(answerbitBrandMappings.brandId, platformAnswerbitBrands.brandId),
          eq(answerbitBrandMappings.organizationId, organizationId),
        ),
      )
      .limit(1);
    return brand;
  },

  async updateBrandProjection(input: {
    brandId: string;
    brandName: string;
    brandAlias: string;
    website: string;
    description: string;
    note: string;
    websiteAutoTrace: boolean;
    syncedAt: Date;
  }) {
    await db.transaction(async (tx) => {
      await tx
        .update(platformAnswerbitBrands)
        .set({
          brandName: input.brandName,
          missingSyncCount: 0,
          syncedAt: input.syncedAt,
          updatedAt: input.syncedAt,
        })
        .where(eq(platformAnswerbitBrands.brandId, input.brandId));
      const [mapping] = await tx
        .update(answerbitBrandMappings)
        .set({
          brandName: input.brandName,
          alias: input.brandAlias,
          website: input.website,
          description: input.description,
          note: input.note,
          websiteAutoTrace: input.websiteAutoTrace,
          syncedAt: input.syncedAt,
          updatedAt: input.syncedAt,
        })
        .where(eq(answerbitBrandMappings.brandId, input.brandId))
        .returning({ organizationId: answerbitBrandMappings.organizationId });
      if (mapping)
        await tx
          .update(organizations)
          .set({
            name: input.brandName.slice(0, 100),
            updatedAt: input.syncedAt,
          })
          .where(eq(organizations.id, mapping.organizationId));
    });
    return this.findBrand(input.brandId);
  },

  async closeBrandProjection(brandId: string, closedAt: Date) {
    return db.transaction(async (tx) => {
      const [mapping] = await tx
        .select({ organizationId: answerbitBrandMappings.organizationId })
        .from(answerbitBrandMappings)
        .where(eq(answerbitBrandMappings.brandId, brandId))
        .limit(1);
      if (!mapping) return undefined;
      await tx
        .update(organizations)
        .set({ status: "closed", updatedAt: closedAt })
        .where(eq(organizations.id, mapping.organizationId));
      await tx
        .update(answerbitTeamBindings)
        .set({
          status: "disabled",
          isDefault: false,
          lastErrorCode: "ANSWERBIT_BRAND_DELETED",
          updatedAt: closedAt,
        })
        .where(
          eq(answerbitTeamBindings.organizationId, mapping.organizationId),
        );
      await tx
        .update(answerbitConnections)
        .set({ status: "disabled", updatedAt: closedAt })
        .where(eq(answerbitConnections.organizationId, mapping.organizationId));
      return mapping;
    });
  },

  async markConfigurationInvalid(
    teamId: string,
    checkedAt: Date,
    errorCode: string,
  ) {
    await db.transaction(async (tx) => {
      await tx
        .update(platformAnswerbitCredentials)
        .set({
          status: "invalid",
          lastCheckedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(platformAnswerbitCredentials.id, 1));
      await tx
        .update(answerbitConnections)
        .set({
          status: "invalid",
          lastCheckedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(
          eq(
            answerbitConnections.encryptedApiKey,
            platformAnswerBitConnectionSentinel,
          ),
        );
      await tx
        .update(answerbitTeamBindings)
        .set({
          status: "invalid",
          lastErrorCode: errorCode,
          lastCheckedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(answerbitTeamBindings.teamId, teamId));
    });
  },

  async countOrganizationTeams(organizationId: string, teamId?: string | null) {
    if (!teamId) return 0;
    const [row] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(answerbitTeamBindings)
      .where(
        and(
          eq(answerbitTeamBindings.organizationId, organizationId),
          eq(answerbitTeamBindings.teamId, teamId),
        ),
      );
    return row?.value ?? 0;
  },

  updateConnectionHealth(
    connectionId: string,
    status: "active" | "invalid",
    checkedAt: Date,
  ) {
    return db
      .update(answerbitConnections)
      .set({ status, lastCheckedAt: checkedAt, updatedAt: checkedAt })
      .where(eq(answerbitConnections.id, connectionId));
  },

  recordSyncCall(input: {
    organizationId: string;
    connectionId: string;
    requestId: string;
    status: "success" | "failed" | "timeout";
    httpStatus?: number;
    answerbitCode?: number;
    errorCode?: string;
    durationMs: number;
  }) {
    return db.insert(answerbitApiCalls).values({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      requestId: input.requestId,
      operation: "/geo/query/brand",
      status: input.status,
      httpStatus: input.httpStatus,
      answerbitCode: input.answerbitCode,
      errorCode: input.errorCode,
      durationMs: input.durationMs,
    });
  },
};

import { and, count, eq, ne } from "drizzle-orm";
import {
  answerbitBrandMappings,
  answerbitConnections,
  answerbitTeamBindings,
  db,
} from "@geo/db";

export const answerBitConnectionRepository = {
  listConnections(organizationId: string) {
    return db
      .select({
        id: answerbitConnections.id,
        status: answerbitConnections.status,
        apiKeyHint: answerbitConnections.apiKeyHint,
        keyVersion: answerbitConnections.keyVersion,
        lastCheckedAt: answerbitConnections.lastCheckedAt,
        createdAt: answerbitConnections.createdAt,
        updatedAt: answerbitConnections.updatedAt,
        teamCount: count(answerbitTeamBindings.id),
      })
      .from(answerbitConnections)
      .leftJoin(
        answerbitTeamBindings,
        eq(answerbitTeamBindings.connectionId, answerbitConnections.id),
      )
      .where(eq(answerbitConnections.organizationId, organizationId))
      .groupBy(answerbitConnections.id)
      .orderBy(answerbitConnections.createdAt);
  },
  async findConnection(organizationId: string, connectionId: string) {
    const [connection] = await db
      .select()
      .from(answerbitConnections)
      .where(
        and(
          eq(answerbitConnections.organizationId, organizationId),
          eq(answerbitConnections.id, connectionId),
        ),
      )
      .limit(1);
    return connection;
  },
  async createConnection(values: typeof answerbitConnections.$inferInsert) {
    const [connection] = await db
      .insert(answerbitConnections)
      .values(values)
      .returning();
    return connection;
  },
  async updateConnection(
    organizationId: string,
    connectionId: string,
    values: Partial<typeof answerbitConnections.$inferInsert>,
  ) {
    const [connection] = await db
      .update(answerbitConnections)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(answerbitConnections.organizationId, organizationId),
          eq(answerbitConnections.id, connectionId),
        ),
      )
      .returning();
    return connection;
  },
  async deleteConnection(organizationId: string, connectionId: string) {
    const [dependency] = await db
      .select({ value: count() })
      .from(answerbitTeamBindings)
      .where(
        and(
          eq(answerbitTeamBindings.organizationId, organizationId),
          eq(answerbitTeamBindings.connectionId, connectionId),
        ),
      );
    if (Number(dependency.value)) return false;
    return Boolean(
      (
        await db
          .update(answerbitConnections)
          .set({ status: "disabled", updatedAt: new Date() })
          .where(
            and(
              eq(answerbitConnections.organizationId, organizationId),
              eq(answerbitConnections.id, connectionId),
            ),
          )
          .returning({ id: answerbitConnections.id })
      ).length,
    );
  },
  listConnectionTeams(organizationId: string, connectionId: string) {
    return db
      .select()
      .from(answerbitTeamBindings)
      .where(
        and(
          eq(answerbitTeamBindings.organizationId, organizationId),
          eq(answerbitTeamBindings.connectionId, connectionId),
          eq(answerbitTeamBindings.status, "active"),
        ),
      );
  },
  async findTeamBindingByTeamId(teamId: string) {
    const [binding] = await db
      .select({
        id: answerbitTeamBindings.id,
        organizationId: answerbitTeamBindings.organizationId,
      })
      .from(answerbitTeamBindings)
      .where(eq(answerbitTeamBindings.teamId, teamId))
      .limit(1);
    return binding;
  },
  createTeamBinding(
    values: typeof answerbitTeamBindings.$inferInsert,
    brands: { id: string; name: string }[],
  ) {
    return db.transaction(async (tx) => {
      const now = new Date();
      if (values.isDefault)
        await tx
          .update(answerbitTeamBindings)
          .set({ isDefault: false, updatedAt: now })
          .where(
            eq(answerbitTeamBindings.organizationId, values.organizationId),
          );
      const [binding] = await tx
        .insert(answerbitTeamBindings)
        .values(values)
        .returning();
      for (const brand of brands)
        await tx
          .insert(answerbitBrandMappings)
          .values({
            organizationId: values.organizationId,
            teamBindingId: binding.id,
            brandId: brand.id,
            brandName: brand.name,
            syncedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              answerbitBrandMappings.organizationId,
              answerbitBrandMappings.teamBindingId,
              answerbitBrandMappings.brandId,
            ],
            set: { brandName: brand.name, syncedAt: now, updatedAt: now },
          });
      return binding;
    });
  },
  async markTeamSynced(
    organizationId: string,
    teamBindingId: string,
    brands: { id: string; name: string }[],
    checkedAt: Date,
  ) {
    return db.transaction(async (tx) => {
      for (const brand of brands)
        await tx
          .insert(answerbitBrandMappings)
          .values({
            organizationId,
            teamBindingId,
            brandId: brand.id,
            brandName: brand.name,
            syncedAt: checkedAt,
          })
          .onConflictDoUpdate({
            target: [
              answerbitBrandMappings.organizationId,
              answerbitBrandMappings.teamBindingId,
              answerbitBrandMappings.brandId,
            ],
            set: {
              brandName: brand.name,
              syncedAt: checkedAt,
              updatedAt: checkedAt,
            },
          });
      const [binding] = await tx
        .update(answerbitTeamBindings)
        .set({
          status: "active",
          brandCount: brands.length,
          lastCheckedAt: checkedAt,
          lastSyncedAt: checkedAt,
          lastErrorCode: null,
          updatedAt: checkedAt,
        })
        .where(
          and(
            eq(answerbitTeamBindings.organizationId, organizationId),
            eq(answerbitTeamBindings.id, teamBindingId),
          ),
        )
        .returning();
      return binding;
    });
  },
  updateTeamBinding(
    organizationId: string,
    teamBindingId: string,
    values: Partial<typeof answerbitTeamBindings.$inferInsert>,
  ) {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(answerbitTeamBindings)
        .where(
          and(
            eq(answerbitTeamBindings.organizationId, organizationId),
            eq(answerbitTeamBindings.id, teamBindingId),
          ),
        )
        .limit(1);
      if (values.isDefault)
        await tx
          .update(answerbitTeamBindings)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(answerbitTeamBindings.organizationId, organizationId));
      if (values.status === "disabled" && current?.isDefault) {
        values.isDefault = false;
        const [replacement] = await tx
          .select({ id: answerbitTeamBindings.id })
          .from(answerbitTeamBindings)
          .where(
            and(
              eq(answerbitTeamBindings.organizationId, organizationId),
              ne(answerbitTeamBindings.id, teamBindingId),
              eq(answerbitTeamBindings.status, "active"),
            ),
          )
          .limit(1);
        if (replacement)
          await tx
            .update(answerbitTeamBindings)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(answerbitTeamBindings.id, replacement.id));
      }
      const [binding] = await tx
        .update(answerbitTeamBindings)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(answerbitTeamBindings.organizationId, organizationId),
            eq(answerbitTeamBindings.id, teamBindingId),
          ),
        )
        .returning();
      return binding;
    });
  },
};

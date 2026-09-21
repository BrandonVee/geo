import { and, eq, notInArray } from "drizzle-orm";
import { answerbitCompetitorMappings, db } from "@geo/db";

type CompetitorRecord = { id: string; name: string; alias: string };
export const competitorRepository = {
  async sync(
    organizationId: string,
    teamBindingId: string,
    brandId: string,
    competitors: CompetitorRecord[],
  ) {
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const competitor of competitors)
        await tx
          .insert(answerbitCompetitorMappings)
          .values({
            organizationId,
            teamBindingId,
            brandId,
            competitorId: competitor.id,
            competitorName: competitor.name,
            competitorAlias: competitor.alias,
            syncedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              answerbitCompetitorMappings.organizationId,
              answerbitCompetitorMappings.teamBindingId,
              answerbitCompetitorMappings.brandId,
              answerbitCompetitorMappings.competitorId,
            ],
            set: {
              competitorName: competitor.name,
              competitorAlias: competitor.alias,
              syncedAt: now,
              updatedAt: now,
            },
          });
      const scope = and(
        eq(answerbitCompetitorMappings.organizationId, organizationId),
        eq(answerbitCompetitorMappings.teamBindingId, teamBindingId),
        eq(answerbitCompetitorMappings.brandId, brandId),
      );
      await tx.delete(answerbitCompetitorMappings).where(
        competitors.length
          ? and(
              scope,
              notInArray(
                answerbitCompetitorMappings.competitorId,
                competitors.map((item) => item.id),
              ),
            )
          : scope,
      );
    });
  },
  async save(values: typeof answerbitCompetitorMappings.$inferInsert) {
    const [record] = await db
      .insert(answerbitCompetitorMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [
          answerbitCompetitorMappings.organizationId,
          answerbitCompetitorMappings.teamBindingId,
          answerbitCompetitorMappings.brandId,
          answerbitCompetitorMappings.competitorId,
        ],
        set: {
          competitorName: values.competitorName,
          competitorAlias: values.competitorAlias,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return record;
  },
  async remove(
    organizationId: string,
    teamBindingId: string,
    brandId: string,
    competitorId: string,
  ) {
    await db
      .delete(answerbitCompetitorMappings)
      .where(
        and(
          eq(answerbitCompetitorMappings.organizationId, organizationId),
          eq(answerbitCompetitorMappings.teamBindingId, teamBindingId),
          eq(answerbitCompetitorMappings.brandId, brandId),
          eq(answerbitCompetitorMappings.competitorId, competitorId),
        ),
      );
  },
};

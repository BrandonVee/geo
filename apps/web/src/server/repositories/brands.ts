import { and, eq } from "drizzle-orm";
import {
  answerbitBrandMappings,
  answerbitTeamBindings,
  brandAccess,
  db,
  organizationMembers,
} from "@geo/db";
export const brandRepository = {
  async findTeamForBrand(organizationId: string, brandId: string) {
    const [row] = await db
      .select({ id: answerbitTeamBindings.id })
      .from(answerbitBrandMappings)
      .innerJoin(
        answerbitTeamBindings,
        and(
          eq(answerbitTeamBindings.id, answerbitBrandMappings.teamBindingId),
          eq(
            answerbitTeamBindings.organizationId,
            answerbitBrandMappings.organizationId,
          ),
        ),
      )
      .where(
        and(
          eq(answerbitBrandMappings.organizationId, organizationId),
          eq(answerbitBrandMappings.brandId, brandId),
          eq(answerbitTeamBindings.status, "active"),
        ),
      )
      .limit(1);
    return row;
  },
  async findTeam(organizationId: string, teamBindingId: string) {
    const [team] = await db
      .select()
      .from(answerbitTeamBindings)
      .where(
        and(
          eq(answerbitTeamBindings.organizationId, organizationId),
          eq(answerbitTeamBindings.id, teamBindingId),
          eq(answerbitTeamBindings.status, "active"),
        ),
      )
      .limit(1);
    return team;
  },
  async findActiveMembership(organizationId: string, userId: string) {
    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.status, "active"),
        ),
      )
      .limit(1);
    return member;
  },
  listUserBrandAccess(
    organizationId: string,
    teamBindingId: string,
    userId: string,
  ) {
    return db
      .select()
      .from(brandAccess)
      .where(
        and(
          eq(brandAccess.organizationId, organizationId),
          eq(brandAccess.teamBindingId, teamBindingId),
          eq(brandAccess.userId, userId),
        ),
      );
  },
  listBrands(organizationId: string, teamBindingId: string) {
    return db
      .select()
      .from(answerbitBrandMappings)
      .where(
        and(
          eq(answerbitBrandMappings.organizationId, organizationId),
          eq(answerbitBrandMappings.teamBindingId, teamBindingId),
        ),
      );
  },
  async syncBrandNames(
    organizationId: string,
    teamBindingId: string,
    brands: { id: string; name: string }[],
  ) {
    const now = new Date();
    for (const brand of brands)
      await db
        .insert(answerbitBrandMappings)
        .values({
          organizationId,
          teamBindingId,
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
  },
  async saveBrand(values: typeof answerbitBrandMappings.$inferInsert) {
    const [mapping] = await db
      .insert(answerbitBrandMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [
          answerbitBrandMappings.organizationId,
          answerbitBrandMappings.teamBindingId,
          answerbitBrandMappings.brandId,
        ],
        set: {
          brandName: values.brandName,
          alias: values.alias,
          website: values.website,
          description: values.description,
          note: values.note,
          websiteAutoTrace: values.websiteAutoTrace,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return mapping;
  },
  async findBrand(
    organizationId: string,
    teamBindingId: string,
    brandId: string,
  ) {
    const [brand] = await db
      .select()
      .from(answerbitBrandMappings)
      .where(
        and(
          eq(answerbitBrandMappings.organizationId, organizationId),
          eq(answerbitBrandMappings.teamBindingId, teamBindingId),
          eq(answerbitBrandMappings.brandId, brandId),
        ),
      )
      .limit(1);
    return brand;
  },
};

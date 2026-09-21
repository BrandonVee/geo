import type {
  CreateSavedViewInput,
  UpdateSavedViewInput,
} from "@geo/contracts";
import { db, savedViews } from "@geo/db";
import { and, desc, eq, ne } from "drizzle-orm";
export const savedViewRepository = {
  list(organizationId: string, userId: string, page?: string) {
    return db
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.organizationId, organizationId),
          eq(savedViews.userId, userId),
          page ? eq(savedViews.page, page) : undefined,
        ),
      )
      .orderBy(desc(savedViews.isDefault), desc(savedViews.updatedAt));
  },
  async find(id: string, organizationId: string, userId: string) {
    const [row] = await db
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.id, id),
          eq(savedViews.organizationId, organizationId),
          eq(savedViews.userId, userId),
        ),
      )
      .limit(1);
    return row;
  },
  create(input: CreateSavedViewInput, userId: string) {
    return db.transaction(async (tx) => {
      if (input.isDefault)
        await tx
          .update(savedViews)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(savedViews.organizationId, input.organizationId),
              eq(savedViews.userId, userId),
              eq(savedViews.page, input.page),
              eq(savedViews.isDefault, true),
            ),
          );
      const [row] = await tx
        .insert(savedViews)
        .values({ ...input, userId })
        .returning();
      return row;
    });
  },
  update(
    id: string,
    organizationId: string,
    userId: string,
    input: Omit<UpdateSavedViewInput, "organizationId">,
  ) {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.id, id),
            eq(savedViews.organizationId, organizationId),
            eq(savedViews.userId, userId),
          ),
        )
        .limit(1);
      if (!current) return undefined;
      if (input.isDefault)
        await tx
          .update(savedViews)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(savedViews.organizationId, organizationId),
              eq(savedViews.userId, userId),
              eq(savedViews.page, current.page),
              ne(savedViews.id, id),
              eq(savedViews.isDefault, true),
            ),
          );
      const [row] = await tx
        .update(savedViews)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(savedViews.id, id))
        .returning();
      return row;
    });
  },
  remove(id: string, organizationId: string, userId: string) {
    return db
      .delete(savedViews)
      .where(
        and(
          eq(savedViews.id, id),
          eq(savedViews.organizationId, organizationId),
          eq(savedViews.userId, userId),
        ),
      )
      .returning()
      .then((rows) => rows[0]);
  },
};

import { and, eq, inArray } from "drizzle-orm";
import { answerbitPromptMappings, answerbitTitleMappings, db } from "@geo/db";

type Scope = { organizationId: string; teamBindingId: string; brandId: string };
export const promptRepository = {
  async syncTitles(
    scope: Scope,
    titles: {
      id: string;
      title_name: string;
      title_desc: string;
      count: number;
    }[],
  ) {
    const now = new Date();
    for (const item of titles)
      await db
        .insert(answerbitTitleMappings)
        .values({
          ...scope,
          titleId: item.id,
          titleName: item.title_name,
          titleDescription: item.title_desc,
          promptCount: item.count,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            answerbitTitleMappings.organizationId,
            answerbitTitleMappings.teamBindingId,
            answerbitTitleMappings.brandId,
            answerbitTitleMappings.titleId,
          ],
          set: {
            titleName: item.title_name,
            titleDescription: item.title_desc,
            promptCount: item.count,
            syncedAt: now,
            updatedAt: now,
          },
        });
  },
  async saveTitle(
    scope: Scope,
    titleId: string,
    titleName: string,
    titleDescription = "",
  ) {
    const [record] = await db
      .insert(answerbitTitleMappings)
      .values({ ...scope, titleId, titleName, titleDescription })
      .onConflictDoUpdate({
        target: [
          answerbitTitleMappings.organizationId,
          answerbitTitleMappings.teamBindingId,
          answerbitTitleMappings.brandId,
          answerbitTitleMappings.titleId,
        ],
        set: {
          titleName,
          titleDescription,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return record;
  },
  async updateTitle(
    scope: Scope,
    titleId: string,
    changes: { titleName: string; titleDescription?: string },
  ) {
    const [record] = await db
      .update(answerbitTitleMappings)
      .set({ ...changes, syncedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(answerbitTitleMappings.organizationId, scope.organizationId),
          eq(answerbitTitleMappings.teamBindingId, scope.teamBindingId),
          eq(answerbitTitleMappings.brandId, scope.brandId),
          eq(answerbitTitleMappings.titleId, titleId),
        ),
      )
      .returning();
    return record;
  },
  async removeTitle(scope: Scope, titleId: string) {
    await db.transaction(async (tx) => {
      await tx
        .delete(answerbitPromptMappings)
        .where(
          and(
            eq(answerbitPromptMappings.organizationId, scope.organizationId),
            eq(answerbitPromptMappings.teamBindingId, scope.teamBindingId),
            eq(answerbitPromptMappings.brandId, scope.brandId),
            eq(answerbitPromptMappings.titleId, titleId),
          ),
        );
      await tx
        .delete(answerbitTitleMappings)
        .where(
          and(
            eq(answerbitTitleMappings.organizationId, scope.organizationId),
            eq(answerbitTitleMappings.teamBindingId, scope.teamBindingId),
            eq(answerbitTitleMappings.brandId, scope.brandId),
            eq(answerbitTitleMappings.titleId, titleId),
          ),
        );
    });
  },
  async syncPromptGroups(
    scope: Scope,
    groups: {
      title_id: string;
      title_name: string;
      title_desc: string;
      prompt_count: number;
      prompts: {
        id: string;
        title_id: string;
        query_str: string;
        status: number;
      }[];
    }[],
  ) {
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const group of groups) {
        await tx
          .insert(answerbitTitleMappings)
          .values({
            ...scope,
            titleId: group.title_id,
            titleName: group.title_name,
            titleDescription: group.title_desc,
            promptCount: group.prompt_count,
            syncedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              answerbitTitleMappings.organizationId,
              answerbitTitleMappings.teamBindingId,
              answerbitTitleMappings.brandId,
              answerbitTitleMappings.titleId,
            ],
            set: {
              titleName: group.title_name,
              titleDescription: group.title_desc,
              promptCount: group.prompt_count,
              syncedAt: now,
              updatedAt: now,
            },
          });
        for (const item of group.prompts)
          await tx
            .insert(answerbitPromptMappings)
            .values({
              ...scope,
              promptId: item.id,
              titleId: item.title_id,
              query: item.query_str,
              status: item.status,
              syncedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                answerbitPromptMappings.organizationId,
                answerbitPromptMappings.teamBindingId,
                answerbitPromptMappings.brandId,
                answerbitPromptMappings.promptId,
              ],
              set: {
                titleId: item.title_id,
                query: item.query_str,
                status: item.status,
                syncedAt: now,
                updatedAt: now,
              },
            });
      }
    });
  },
  async savePrompt(
    scope: Scope,
    promptId: string,
    titleId: string,
    query: string,
    status = 1,
  ) {
    const [record] = await db
      .insert(answerbitPromptMappings)
      .values({ ...scope, promptId, titleId, query, status })
      .onConflictDoUpdate({
        target: [
          answerbitPromptMappings.organizationId,
          answerbitPromptMappings.teamBindingId,
          answerbitPromptMappings.brandId,
          answerbitPromptMappings.promptId,
        ],
        set: {
          titleId,
          query,
          status,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return record;
  },
  async updatePrompt(
    scope: Scope,
    promptId: string,
    changes: { query?: string; status?: number; titleId?: string },
  ) {
    const [record] = await db
      .update(answerbitPromptMappings)
      .set({ ...changes, syncedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(answerbitPromptMappings.organizationId, scope.organizationId),
          eq(answerbitPromptMappings.teamBindingId, scope.teamBindingId),
          eq(answerbitPromptMappings.brandId, scope.brandId),
          eq(answerbitPromptMappings.promptId, promptId),
        ),
      )
      .returning();
    return record;
  },
  async removePrompts(scope: Scope, promptIds: string[]) {
    if (!promptIds.length) return;
    await db
      .delete(answerbitPromptMappings)
      .where(
        and(
          eq(answerbitPromptMappings.organizationId, scope.organizationId),
          eq(answerbitPromptMappings.teamBindingId, scope.teamBindingId),
          eq(answerbitPromptMappings.brandId, scope.brandId),
          inArray(answerbitPromptMappings.promptId, promptIds),
        ),
      );
  },
};

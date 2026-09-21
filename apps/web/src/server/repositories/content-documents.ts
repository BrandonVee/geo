import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  contentDocuments,
  contentDocumentVersions,
  contentFolders,
  db,
} from "@geo/db";
import type {
  ContentDocumentListQuery,
  CreateContentDocumentInput,
  UpdateContentDocumentInput,
} from "@geo/contracts";

type Scope = {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
};

const scopeConditions = (scope: Scope) => [
  eq(contentDocuments.organizationId, scope.organizationId),
  eq(contentDocuments.teamBindingId, scope.teamBindingId),
  eq(contentDocuments.brandId, scope.brandId),
];

async function folderExists(
  executor: Pick<typeof db, "select">,
  scope: Scope,
  folderId: string,
) {
  const [folder] = await executor
    .select({ id: contentFolders.id })
    .from(contentFolders)
    .where(
      and(
        eq(contentFolders.id, folderId),
        eq(contentFolders.organizationId, scope.organizationId),
        eq(contentFolders.teamBindingId, scope.teamBindingId),
        eq(contentFolders.brandId, scope.brandId),
      ),
    )
    .limit(1);
  return Boolean(folder);
}

export const contentDocumentRepository = {
  async list(input: ContentDocumentListQuery) {
    const conditions = [
      ...scopeConditions(input),
      input.status
        ? eq(contentDocuments.status, input.status)
        : ne(contentDocuments.status, "archived"),
      input.folderId
        ? eq(contentDocuments.folderId, input.folderId)
        : input.unfiled
          ? isNull(contentDocuments.folderId)
          : undefined,
      input.source ? eq(contentDocuments.source, input.source) : undefined,
      input.q
        ? or(
            ilike(contentDocuments.title, `%${input.q}%`),
            ilike(contentDocuments.body, `%${input.q}%`),
          )
        : undefined,
    ].filter(Boolean);
    const where = and(...conditions);
    const [rows, totals] = await Promise.all([
      db
        .select({
          id: contentDocuments.id,
          organizationId: contentDocuments.organizationId,
          teamBindingId: contentDocuments.teamBindingId,
          brandId: contentDocuments.brandId,
          folderId: contentDocuments.folderId,
          folderName: contentFolders.name,
          createdBy: contentDocuments.createdBy,
          updatedBy: contentDocuments.updatedBy,
          source: contentDocuments.source,
          sourceJobId: contentDocuments.sourceJobId,
          sourceUrl: contentDocuments.sourceUrl,
          title: contentDocuments.title,
          bodyPreview: sql<string>`left(${contentDocuments.body}, 180)`,
          contentLength: sql<number>`char_length(${contentDocuments.body})::int`,
          status: contentDocuments.status,
          language: contentDocuments.language,
          tags: contentDocuments.tags,
          currentVersion: contentDocuments.currentVersion,
          createdAt: contentDocuments.createdAt,
          updatedAt: contentDocuments.updatedAt,
        })
        .from(contentDocuments)
        .leftJoin(
          contentFolders,
          eq(contentFolders.id, contentDocuments.folderId),
        )
        .where(where)
        .orderBy(desc(contentDocuments.updatedAt))
        .limit(input.limit)
        .offset(input.offset),
      db.select({ value: count() }).from(contentDocuments).where(where),
    ]);
    return { list: rows, total: totals[0]?.value ?? 0 };
  },

  async find(scope: Scope, documentId: string) {
    const [document] = await db
      .select({
        id: contentDocuments.id,
        organizationId: contentDocuments.organizationId,
        teamBindingId: contentDocuments.teamBindingId,
        brandId: contentDocuments.brandId,
        folderId: contentDocuments.folderId,
        folderName: contentFolders.name,
        createdBy: contentDocuments.createdBy,
        updatedBy: contentDocuments.updatedBy,
        source: contentDocuments.source,
        sourceJobId: contentDocuments.sourceJobId,
        sourceUrl: contentDocuments.sourceUrl,
        title: contentDocuments.title,
        body: contentDocuments.body,
        status: contentDocuments.status,
        language: contentDocuments.language,
        tags: contentDocuments.tags,
        currentVersion: contentDocuments.currentVersion,
        createdAt: contentDocuments.createdAt,
        updatedAt: contentDocuments.updatedAt,
      })
      .from(contentDocuments)
      .leftJoin(
        contentFolders,
        eq(contentFolders.id, contentDocuments.folderId),
      )
      .where(
        and(eq(contentDocuments.id, documentId), ...scopeConditions(scope)),
      )
      .limit(1);
    if (!document) return undefined;
    const versions = await db
      .select({
        id: contentDocumentVersions.id,
        version: contentDocumentVersions.version,
        status: contentDocumentVersions.status,
        changeSummary: contentDocumentVersions.changeSummary,
        createdBy: contentDocumentVersions.createdBy,
        createdAt: contentDocumentVersions.createdAt,
      })
      .from(contentDocumentVersions)
      .where(
        and(
          eq(contentDocumentVersions.documentId, documentId),
          eq(contentDocumentVersions.organizationId, scope.organizationId),
        ),
      )
      .orderBy(desc(contentDocumentVersions.version));
    return { ...document, versions };
  },

  async create(input: CreateContentDocumentInput, userId: string) {
    return db.transaction(async (tx) => {
      if (
        input.folderId &&
        !(await folderExists(tx as unknown as typeof db, input, input.folderId))
      )
        return { ok: false as const, code: "FOLDER_NOT_FOUND" as const };
      const [document] = await tx
        .insert(contentDocuments)
        .values({
          organizationId: input.organizationId,
          teamBindingId: input.teamBindingId,
          brandId: input.brandId,
          folderId: input.folderId,
          createdBy: userId,
          updatedBy: userId,
          source: input.source,
          sourceUrl: input.sourceUrl,
          title: input.title,
          body: input.body,
          status: input.status,
          language: input.language,
          tags: input.tags,
        })
        .returning();
      await tx.insert(contentDocumentVersions).values({
        documentId: document!.id,
        organizationId: input.organizationId,
        version: 1,
        title: document!.title,
        body: document!.body,
        status: document!.status,
        language: document!.language,
        tags: document!.tags,
        changeSummary: input.source === "imported" ? "导入文章" : "创建文档",
        createdBy: userId,
      });
      return { ok: true as const, document: document! };
    });
  },

  async update(
    scope: Scope,
    documentId: string,
    input: UpdateContentDocumentInput,
    userId: string,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${documentId}))`,
      );
      const [current] = await tx
        .select()
        .from(contentDocuments)
        .where(
          and(eq(contentDocuments.id, documentId), ...scopeConditions(scope)),
        )
        .limit(1);
      if (!current) return { ok: false as const, code: "NOT_FOUND" as const };
      if (
        input.folderId &&
        !(await folderExists(tx as unknown as typeof db, scope, input.folderId))
      )
        return { ok: false as const, code: "FOLDER_NOT_FOUND" as const };
      const version = current.currentVersion + 1;
      const next = {
        title: input.title ?? current.title,
        body: input.body ?? current.body,
        status: input.status ?? current.status,
        sourceUrl:
          input.sourceUrl === undefined ? current.sourceUrl : input.sourceUrl,
        folderId:
          input.folderId === undefined ? current.folderId : input.folderId,
        language: input.language ?? current.language,
        tags: input.tags ?? current.tags,
      };
      if (next.status === "ready" && !next.body.trim())
        return { ok: false as const, code: "CONTENT_REQUIRED" as const };
      if (current.source === "imported" && !next.sourceUrl)
        return { ok: false as const, code: "SOURCE_URL_REQUIRED" as const };
      const [document] = await tx
        .update(contentDocuments)
        .set({
          ...next,
          currentVersion: version,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(contentDocuments.id, documentId), ...scopeConditions(scope)),
        )
        .returning();
      await tx.insert(contentDocumentVersions).values({
        documentId,
        organizationId: scope.organizationId,
        version,
        title: next.title,
        body: next.body,
        status: next.status,
        language: next.language,
        tags: next.tags,
        changeSummary: input.changeSummary,
        createdBy: userId,
      });
      return { ok: true as const, document: document! };
    });
  },

  async restore(
    scope: Scope,
    documentId: string,
    restoreVersion: number,
    changeSummary: string,
    userId: string,
  ) {
    const [version] = await db
      .select()
      .from(contentDocumentVersions)
      .where(
        and(
          eq(contentDocumentVersions.documentId, documentId),
          eq(contentDocumentVersions.organizationId, scope.organizationId),
          eq(contentDocumentVersions.version, restoreVersion),
        ),
      )
      .limit(1);
    if (!version)
      return { ok: false as const, code: "VERSION_NOT_FOUND" as const };
    return this.update(
      scope,
      documentId,
      {
        ...scope,
        title: version.title,
        body: version.body,
        status: version.status,
        language: version.language as "zh-CN" | "zh-TW" | "en-US" | "ja-JP",
        tags: version.tags,
        changeSummary,
      },
      userId,
    );
  },

  listFolders(scope: Scope) {
    return db
      .select({
        id: contentFolders.id,
        name: contentFolders.name,
        createdBy: contentFolders.createdBy,
        createdAt: contentFolders.createdAt,
        updatedAt: contentFolders.updatedAt,
        documentCount: sql<number>`count(${contentDocuments.id}) filter (where ${contentDocuments.status} <> 'archived')::int`,
      })
      .from(contentFolders)
      .leftJoin(
        contentDocuments,
        eq(contentDocuments.folderId, contentFolders.id),
      )
      .where(
        and(
          eq(contentFolders.organizationId, scope.organizationId),
          eq(contentFolders.teamBindingId, scope.teamBindingId),
          eq(contentFolders.brandId, scope.brandId),
        ),
      )
      .groupBy(contentFolders.id)
      .orderBy(asc(contentFolders.name));
  },

  async createFolder(scope: Scope, name: string, userId: string) {
    const [folder] = await db
      .insert(contentFolders)
      .values({ ...scope, name, createdBy: userId })
      .returning();
    return folder;
  },

  async updateFolder(scope: Scope, folderId: string, name: string) {
    const [folder] = await db
      .update(contentFolders)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(contentFolders.id, folderId),
          eq(contentFolders.organizationId, scope.organizationId),
          eq(contentFolders.teamBindingId, scope.teamBindingId),
          eq(contentFolders.brandId, scope.brandId),
        ),
      )
      .returning();
    return folder;
  },

  deleteFolder(scope: Scope, folderId: string) {
    return db.transaction(async (tx) => {
      const [folder] = await tx
        .select({ id: contentFolders.id })
        .from(contentFolders)
        .where(
          and(
            eq(contentFolders.id, folderId),
            eq(contentFolders.organizationId, scope.organizationId),
            eq(contentFolders.teamBindingId, scope.teamBindingId),
            eq(contentFolders.brandId, scope.brandId),
          ),
        )
        .limit(1);
      if (!folder) return false;
      await tx
        .update(contentDocuments)
        .set({ folderId: null, updatedAt: new Date() })
        .where(
          and(
            eq(contentDocuments.folderId, folderId),
            ...scopeConditions(scope),
          ),
        );
      await tx.delete(contentFolders).where(eq(contentFolders.id, folderId));
      return true;
    });
  },
};

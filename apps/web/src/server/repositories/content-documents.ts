import { createHash } from "node:crypto";
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
  withTenantDbContext,
  assertEnterpriseAccess,
  type DatabaseTransaction,
} from "@geo/db";
import type {
  ContentDocumentListQuery,
  CreateContentDocumentInput,
  UpdateContentDocumentInput,
} from "@geo/contracts";

import {
  writeAudit,
  type AuditContext,
  type AuditEntry,
} from "@/server/audit/write-audit";

type Scope = {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
};

type FolderRow = typeof contentFolders.$inferSelect;
type FolderAudit = (tx: DatabaseTransaction, row: FolderRow) => Promise<void>;
type DocumentAudit = (
  tx: DatabaseTransaction,
  document: typeof contentDocuments.$inferSelect,
) => Promise<void>;
const folderConditions = (scope: Scope, id?: string) => [
  eq(contentFolders.organizationId, scope.organizationId),
  eq(contentFolders.teamBindingId, scope.teamBindingId),
  eq(contentFolders.brandId, scope.brandId),
  id ? eq(contentFolders.id, id) : undefined,
  isNull(contentFolders.deletedAt),
];
async function lockLibrary(tx: DatabaseTransaction, scope: Scope) {
  await assertEnterpriseAccess(scope.organizationId, false, tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["content-library", scope.organizationId, scope.teamBindingId, scope.brandId])}, 0))`,
  );
}
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
        isNull(contentFolders.deletedAt),
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

  // @project-doc docs/domains/geo_operations.md#article_jobs
  async create(
    input: CreateContentDocumentInput,
    userId: string,
    creationKey?: string,
    audit?: { context: AuditContext; input: Omit<AuditEntry, "resourceId"> },
  ) {
    // A fixed field order and normalized nulls make omitted/default fields equivalent.
    const creationFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          organizationId: input.organizationId,
          teamBindingId: input.teamBindingId,
          brandId: input.brandId,
          title: input.title,
          body: input.body,
          status: input.status,
          source: input.source,
          sourceUrl: input.sourceUrl ?? null,
          folderId: input.folderId ?? null,
          language: input.language,
          tags: input.tags,
        }),
      )
      .digest("hex");
    return withTenantDbContext({ ...input, userId }, async (tx) => {
      await lockLibrary(tx, input);
      if (creationKey) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["content-document-create", input.organizationId, creationKey])}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(contentDocuments)
          .where(
            and(
              eq(contentDocuments.organizationId, input.organizationId),
              eq(contentDocuments.creationKey, creationKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (
            existing.createdBy !== userId ||
            existing.teamBindingId !== input.teamBindingId ||
            existing.brandId !== input.brandId ||
            existing.creationFingerprint !== creationFingerprint
          )
            return {
              ok: false as const,
              code: "IDEMPOTENCY_CONFLICT" as const,
            };
          return { ok: true as const, document: existing, replayed: true };
        }
      }
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
          creationKey,
          creationFingerprint: creationKey ? creationFingerprint : undefined,
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
      if (audit)
        await writeAudit(
          audit.context,
          { ...audit.input, resourceId: document!.id },
          tx,
        );
      return { ok: true as const, document: document!, replayed: false };
    });
  },

  // @project-doc docs/domains/geo_operations.md#article_jobs
  async update(
    scope: Scope,
    documentId: string,
    input: UpdateContentDocumentInput,
    userId: string,
    audit?: DocumentAudit,
  ) {
    return withTenantDbContext({ ...scope, userId }, async (tx) => {
      await lockLibrary(tx, scope);
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
      if (current.currentVersion !== input.expectedVersion)
        return {
          ok: false as const,
          code: "VERSION_CONFLICT" as const,
          currentVersion: current.currentVersion,
        };
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
      if (audit) await audit(tx, document!);
      return { ok: true as const, document: document! };
    });
  },

  async restore(
    scope: Scope,
    documentId: string,
    restoreVersion: number,
    changeSummary: string,
    userId: string,
    expectedVersion: number,
    audit?: DocumentAudit,
  ) {
    const [version] = await withTenantDbContext({ ...scope, userId }, (tx) =>
      tx
        .select({ snapshot: contentDocumentVersions })
        .from(contentDocumentVersions)
        .innerJoin(
          contentDocuments,
          eq(contentDocuments.id, contentDocumentVersions.documentId),
        )
        .where(
          and(
            ...scopeConditions(scope),
            eq(contentDocumentVersions.documentId, documentId),
            eq(contentDocumentVersions.organizationId, scope.organizationId),
            eq(contentDocumentVersions.version, restoreVersion),
          ),
        )
        .limit(1),
    );
    if (!version)
      return { ok: false as const, code: "VERSION_NOT_FOUND" as const };
    return this.update(
      scope,
      documentId,
      {
        ...scope,
        expectedVersion,
        title: version.snapshot.title,
        body: version.snapshot.body,
        status: version.snapshot.status,
        language: version.snapshot.language as
          | "zh-CN"
          | "zh-TW"
          | "en-US"
          | "ja-JP",
        tags: version.snapshot.tags,
        changeSummary,
      },
      userId,
      audit,
    );
  },

  // @project-doc docs/domains/geo_operations.md#article_jobs
  listFolders(scope: Scope, userId: string) {
    return withTenantDbContext({ ...scope, userId }, (tx) =>
      tx
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
          and(
            eq(contentDocuments.folderId, contentFolders.id),
            ...scopeConditions(scope),
          ),
        )
        .where(and(...folderConditions(scope)))
        .groupBy(contentFolders.id)
        .orderBy(asc(contentFolders.name)),
    );
  },

  createFolder(
    scope: Scope,
    name: string,
    userId: string,
    creationKey?: string,
    audit?: FolderAudit,
  ) {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
          name,
        }),
      )
      .digest("hex");
    return withTenantDbContext({ ...scope, userId }, async (tx) => {
      await lockLibrary(tx, scope);
      if (creationKey) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["content-folder-create", scope.organizationId, creationKey])}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(contentFolders)
          .where(
            and(
              eq(contentFolders.organizationId, scope.organizationId),
              eq(contentFolders.creationKey, creationKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (
            existing.createdBy !== userId ||
            existing.creationFingerprint !== fingerprint ||
            existing.teamBindingId !== scope.teamBindingId ||
            existing.brandId !== scope.brandId
          )
            return { kind: "conflict" as const };
          if (existing.deletedAt) return { kind: "removed" as const };
          return { kind: "replayed" as const, row: existing };
        }
      }
      const [row] = await tx
        .insert(contentFolders)
        .values({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
          name,
          createdBy: userId,
          creationKey,
          creationFingerprint: creationKey ? fingerprint : undefined,
        })
        .returning();
      if (audit) await audit(tx, row);
      return { kind: "created" as const, row };
    });
  },

  updateFolder(
    scope: Scope,
    folderId: string,
    name: string,
    userId: string,
    expectedName?: string,
    audit?: FolderAudit,
  ) {
    return withTenantDbContext({ ...scope, userId }, async (tx) => {
      await lockLibrary(tx, scope);
      const [current] = await tx
        .select()
        .from(contentFolders)
        .where(and(...folderConditions(scope, folderId)))
        .for("update");
      if (!current) return { kind: "missing" as const };
      if (current.name === name)
        return { kind: "replayed" as const, row: current };
      if (expectedName !== undefined && current.name !== expectedName)
        return { kind: "conflict" as const, row: current };
      const [row] = await tx
        .update(contentFolders)
        .set({ name, updatedAt: new Date() })
        .where(and(...folderConditions(scope, folderId)))
        .returning();
      if (audit) await audit(tx, row);
      return { kind: "updated" as const, row };
    });
  },

  deleteFolder(
    scope: Scope,
    folderId: string,
    userId: string,
    expectedName?: string,
    audit?: FolderAudit,
  ) {
    return withTenantDbContext({ ...scope, userId }, async (tx) => {
      await lockLibrary(tx, scope);
      const [current] = await tx
        .select()
        .from(contentFolders)
        .where(and(...folderConditions(scope, folderId)))
        .for("update");
      if (!current) return { kind: "missing" as const };
      if (expectedName !== undefined && current.name !== expectedName)
        return { kind: "conflict" as const, row: current };
      const documents = and(
        eq(contentDocuments.folderId, folderId),
        ...scopeConditions(scope),
      );
      // Copy snapshots inside PostgreSQL rather than loading every document body into memory.
      await tx.execute(sql`insert into ${contentDocumentVersions} (document_id, organization_id, version, title, body, status, language, tags, change_summary, created_by)
        select ${contentDocuments.id}, ${contentDocuments.organizationId}, ${contentDocuments.currentVersion} + 1, ${contentDocuments.title}, ${contentDocuments.body}, ${contentDocuments.status}, ${contentDocuments.language}, ${contentDocuments.tags}, ${"文件夹删除，移至未归档"}, ${userId}::uuid
        from ${contentDocuments} where ${documents}`);
      await tx
        .update(contentDocuments)
        .set({
          folderId: null,
          currentVersion: sql`${contentDocuments.currentVersion} + 1`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(documents);
      const [row] = await tx
        .update(contentFolders)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(...folderConditions(scope, folderId)))
        .returning();
      if (audit) await audit(tx, row);
      return { kind: "deleted" as const, row };
    });
  },
};

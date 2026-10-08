import { createHash } from "node:crypto";
import { publicationBodyHtml } from "@geo/core";
import { and, eq, sql } from "drizzle-orm";
import {
  withPlatformDbContext,
  withTenantDbContext,
  type DatabaseTransaction,
} from "./context";
import {
  answerbitBrandMappings,
  answerbitTeamBindings,
  articleGenerationJobs,
  contentDocuments,
  publicationOrderContents,
  publicationOrders,
} from "./schema";

export type PublicationSubmissionInput = {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
  channelId: string;
  title: string;
  contentUrl?: string;
  contentHtml?: string;
  sourceJobId?: string;
  sourceDocumentId?: string;
  note: string;
  idempotencyKey: string;
  createdBy: string;
};

export function publicationCreationFingerprint(
  input: PublicationSubmissionInput,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        organizationId: input.organizationId,
        teamBindingId: input.teamBindingId,
        brandId: input.brandId,
        channelId: input.channelId,
        createdBy: input.createdBy,
        title: input.title.trim(),
        contentUrl: input.contentUrl?.trim() ?? null,
        contentHtml: input.contentHtml?.trim() ?? null,
        sourceJobId: input.sourceJobId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        note: input.note.trim(),
      }),
    )
    .digest("hex");
}

export async function lockPublicationSubmission(
  tx: DatabaseTransaction,
  input: PublicationSubmissionInput,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${input.idempotencyKey}))`,
  );
}

// @project-doc docs/domains/balance_and_publication.md#publication_manuscripts
export async function readPublicationSubmissionReplay(
  tx: DatabaseTransaction,
  input: PublicationSubmissionInput,
) {
  const [row] = await tx
    .select({ order: publicationOrders, content: publicationOrderContents })
    .from(publicationOrders)
    .leftJoin(
      publicationOrderContents,
      eq(publicationOrderContents.orderId, publicationOrders.id),
    )
    .where(
      and(
        eq(publicationOrders.organizationId, input.organizationId),
        eq(publicationOrders.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  const replay = row.order;
  const matches = row.content
    ? row.content.fingerprintVersion === 1 &&
      row.content.creationFingerprint === publicationCreationFingerprint(input)
    : replay.brandId === input.brandId &&
      replay.channelId === input.channelId &&
      replay.title === input.title &&
      replay.createdBy === input.createdBy &&
      (replay.sourceJobId ?? undefined) === input.sourceJobId &&
      (replay.sourceDocumentId ?? undefined) === input.sourceDocumentId &&
      (replay.contentUrl ?? undefined) === input.contentUrl;
  if (!matches)
    return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
  return { ok: true as const, order: replay, replayed: true as const };
}

export function findPublicationSubmissionReplay(
  input: PublicationSubmissionInput,
) {
  return withTenantDbContext(
    {
      organizationId: input.organizationId,
      teamBindingId: input.teamBindingId,
      brandId: input.brandId,
      userId: input.createdBy,
    },
    async (tx) => {
      await lockPublicationSubmission(tx, input);
      return readPublicationSubmissionReplay(tx, input);
    },
  );
}

export function safePublicationContentUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && value.length <= 2000
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function resolvePublicationManuscript(
  tx: DatabaseTransaction,
  input: PublicationSubmissionInput,
  provider: string,
) {
  if (
    (input.sourceJobId && input.sourceDocumentId) ||
    (input.contentHtml && (input.sourceJobId || input.sourceDocumentId))
  )
    return { ok: false as const, code: "CONTENT_SOURCE_CONFLICT" as const };
  const [scope] = await tx
    .select({ id: answerbitBrandMappings.id })
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
        eq(answerbitBrandMappings.organizationId, input.organizationId),
        eq(answerbitBrandMappings.teamBindingId, input.teamBindingId),
        eq(answerbitBrandMappings.brandId, input.brandId),
        eq(answerbitTeamBindings.status, "active"),
      ),
    )
    .limit(1);
  if (!scope) return { ok: false as const, code: "SOURCE_NOT_READY" as const };
  const contentUrl = safePublicationContentUrl(input.contentUrl?.trim());
  if (input.contentUrl && !contentUrl)
    return { ok: false as const, code: "CONTENT_URL_INVALID" as const };
  let contentHtml = input.contentHtml?.trim() || null;
  let sourceKind: typeof publicationOrderContents.$inferInsert.sourceKind =
    contentHtml ? "inline_html" : "url";
  let sourceDocumentVersion: number | null = null;
  if (input.sourceDocumentId) {
    const [document] = await tx
      .select()
      .from(contentDocuments)
      .where(
        and(
          eq(contentDocuments.id, input.sourceDocumentId),
          eq(contentDocuments.organizationId, input.organizationId),
          eq(contentDocuments.teamBindingId, input.teamBindingId),
          eq(contentDocuments.brandId, input.brandId),
        ),
      )
      .limit(1)
      .for("share");
    if (!document || document.status !== "ready" || !document.body.trim())
      return { ok: false as const, code: "SOURCE_NOT_READY" as const };
    contentHtml = publicationBodyHtml(document.body) ?? null;
    sourceKind = "document";
    sourceDocumentVersion = document.currentVersion;
  } else if (input.sourceJobId) {
    const [job] = await tx
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, input.sourceJobId),
          eq(articleGenerationJobs.organizationId, input.organizationId),
          eq(articleGenerationJobs.teamBindingId, input.teamBindingId),
          eq(articleGenerationJobs.brandId, input.brandId),
        ),
      )
      .limit(1)
      .for("share");
    if (!job || job.status !== "succeeded" || !job.articleBody?.trim())
      return { ok: false as const, code: "SOURCE_NOT_READY" as const };
    contentHtml = publicationBodyHtml(job.articleBody) ?? null;
    sourceKind = "generated";
  }
  if (
    (!contentHtml && !contentUrl) ||
    (provider === "frog_media" && !contentHtml)
  )
    return { ok: false as const, code: "CONTENT_REQUIRED" as const };
  if (contentHtml && contentHtml.length > 500_000)
    return { ok: false as const, code: "CONTENT_TOO_LARGE" as const };
  return {
    ok: true as const,
    content: {
      organizationId: input.organizationId,
      teamBindingId: input.teamBindingId,
      brandId: input.brandId,
      title: input.title.trim(),
      sourceKind,
      contentHtml,
      contentUrl,
      submissionNote: input.note.trim(),
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourceDocumentVersion,
      sourceJobId: input.sourceJobId ?? null,
      fingerprintVersion: 1,
      creationFingerprint: publicationCreationFingerprint(input),
    },
  };
}

async function readManuscript(
  tx: DatabaseTransaction,
  orderId: string,
  scope?: { organizationId: string; brandId: string; teamBindingId: string },
) {
  const [row] = await tx
    .select({ order: publicationOrders, content: publicationOrderContents })
    .from(publicationOrders)
    .leftJoin(
      publicationOrderContents,
      eq(publicationOrderContents.orderId, publicationOrders.id),
    )
    .where(
      and(
        eq(publicationOrders.id, orderId),
        ...(scope
          ? [
              eq(publicationOrders.organizationId, scope.organizationId),
              eq(publicationOrders.brandId, scope.brandId),
            ]
          : []),
      ),
    )
    .limit(1);
  if (
    !row ||
    (scope && row.content && row.content.teamBindingId !== scope.teamBindingId)
  )
    return undefined;
  const { order, content } = row;
  return {
    orderId: order.id,
    title: content?.title ?? order.title,
    submittedAt: (content?.createdAt ?? order.createdAt).toISOString(),
    snapshotStatus: content
      ? ("available" as const)
      : ("legacy_unavailable" as const),
    source: content
      ? {
          kind: content.sourceKind,
          ...(content.sourceDocumentId
            ? {
                documentId: content.sourceDocumentId,
                documentVersion: content.sourceDocumentVersion!,
              }
            : {}),
          ...(content.sourceJobId ? { jobId: content.sourceJobId } : {}),
        }
      : {
          kind: order.sourceDocumentId
            ? ("document" as const)
            : order.sourceJobId
              ? ("generated" as const)
              : safePublicationContentUrl(order.contentUrl)
                ? ("url" as const)
                : ("unknown" as const),
          ...(order.sourceDocumentId
            ? { documentId: order.sourceDocumentId }
            : {}),
          ...(order.sourceJobId ? { jobId: order.sourceJobId } : {}),
        },
    contentHtml: content?.contentHtml ?? null,
    contentUrl: safePublicationContentUrl(
      content ? content.contentUrl : order.contentUrl,
    ),
    submissionNote: content?.submissionNote ?? null,
  };
}

export function findTenantPublicationManuscript(input: {
  orderId: string;
  organizationId: string;
  teamBindingId: string;
  brandId: string;
  userId: string;
}) {
  return withTenantDbContext(
    input,
    (tx) => readManuscript(tx, input.orderId, input),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export function findAdminPublicationManuscript(
  orderId: string,
  userId: string,
) {
  return withPlatformDbContext(
    { userId },
    (tx) => readManuscript(tx, orderId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

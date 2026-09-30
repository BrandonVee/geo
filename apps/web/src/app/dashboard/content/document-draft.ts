import { z } from "zod";

const draftSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    updatedAt: z.number().int().nonnegative(),
    values: z.object({
      title: z.string().max(10_000).optional(),
      body: z.string().max(4_000_000).optional(),
      status: z.enum(["draft", "ready"]),
      source: z.enum(["manual", "imported"]),
      sourceUrl: z.string().max(10_000).optional(),
      folderId: z.string().uuid().optional(),
      language: z.string().max(32),
      tags: z.array(z.string().max(1000)).max(100),
      changeSummary: z.string().max(10_000).optional(),
    }),
  })
  .refine(
    (draft) => Boolean(draft.documentId) === Boolean(draft.expectedVersion),
  );

export type DocumentDraft = z.infer<typeof draftSchema>;
export type DocumentDraftScope = {
  userId: string;
  organizationId: string;
  teamBindingId: string;
  brandId: string;
};
const prefix = (scope: DocumentDraftScope) =>
  `geo.document.${JSON.stringify([scope.userId, scope.organizationId, scope.teamBindingId, scope.brandId])}.`;
const key = (
  scope: DocumentDraftScope,
  draft: Pick<DocumentDraft, "documentId" | "values">,
) => `${prefix(scope)}${draft.documentId ?? `new-${draft.values.source}`}`;
const lifetime = 24 * 60 * 60 * 1000;

// @project-doc docs/domains/geo_operations.md#article_jobs
export function readDocumentDrafts(
  scope: DocumentDraftScope,
  now = Date.now(),
): DocumentDraft[] {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    ).filter((value): value is string =>
      Boolean(value?.startsWith(prefix(scope))),
    );
    const result: DocumentDraft[] = [];
    for (const storedKey of keys) {
      let parsed;
      try {
        parsed = draftSchema.safeParse(
          JSON.parse(sessionStorage.getItem(storedKey) ?? "null"),
        );
      } catch {}
      if (
        !parsed?.success ||
        parsed.data.updatedAt > now ||
        now - parsed.data.updatedAt > lifetime ||
        key(scope, parsed.data) !== storedKey
      ) {
        sessionStorage.removeItem(storedKey);
        continue;
      }
      result.push(parsed.data);
    }
    return result.sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

export function saveDocumentDraft(
  scope: DocumentDraftScope,
  draft: DocumentDraft,
): boolean {
  try {
    // Preserve temporarily invalid form input too; validate when offering recovery.
    sessionStorage.setItem(key(scope, draft), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeDocumentDraft(
  scope: DocumentDraftScope,
  draft: Pick<DocumentDraft, "documentId" | "values">,
  expected?: DocumentDraft,
) {
  try {
    if (expected) {
      const stored = draftSchema.safeParse(
        JSON.parse(sessionStorage.getItem(key(scope, draft)) ?? "null"),
      );
      if (
        !stored.success ||
        JSON.stringify(stored.data) !== JSON.stringify(expected)
      )
        return;
    }
    sessionStorage.removeItem(key(scope, draft));
  } catch {}
}

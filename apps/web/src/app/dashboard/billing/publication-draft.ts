import { z } from "zod";

const draftSchema = z.object({
  values: z.object({
    channelId: z.string().optional(),
    title: z.string().max(255).optional(),
    contentUrl: z.string().optional(),
    contentHtml: z.string().max(500_000).optional(),
    note: z.string().max(2000).optional(),
  }),
  bodyFormat: z.enum(["text", "html"]),
  sourceJobId: z.string().uuid().optional(),
  sourceDocumentId: z.string().uuid().optional(),
  attempt: z
    .object({ fingerprint: z.string(), key: z.string().uuid() })
    .optional(),
  updatedAt: z.number(),
});
export type PublicationDraft = z.infer<typeof draftSchema>;
export type DraftScope = {
  userId: string;
  organizationId: string;
  brandId: string;
};
const draftKey = (scope: DraftScope) =>
  `geo.publication.${scope.userId}.${scope.organizationId}.${scope.brandId}`;

// @project-doc docs/domains/geo_operations.md#publication_drafts
export function readPublicationDraft(
  scope: DraftScope,
): PublicationDraft | undefined {
  try {
    const stored = sessionStorage.getItem(draftKey(scope));
    if (!stored) return;
    const parsed = draftSchema.safeParse(JSON.parse(stored));
    if (parsed.success && Date.now() - parsed.data.updatedAt < 86_400_000)
      return parsed.data;
    sessionStorage.removeItem(draftKey(scope));
  } catch {
    // Storage restrictions never prevent posting an article.
  }
}
export function writePublicationDraft(
  scope: DraftScope,
  draft: PublicationDraft,
) {
  try {
    sessionStorage.setItem(draftKey(scope), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function clearPublicationDraft(scope: DraftScope) {
  try {
    sessionStorage.removeItem(draftKey(scope));
  } catch {
    // A cleared form remains usable without browser persistence.
  }
}

export { publicationBodyHtml } from "@geo/core";

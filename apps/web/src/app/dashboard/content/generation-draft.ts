import { z } from "zod";
import { createArticleJobSchema } from "@geo/contracts";

export type GenerationDraftScope = {
  userId: string;
  organizationId: string;
  teamBindingId: string;
  brandId: string;
};
export const generationScopeKey = (scope: GenerationDraftScope) =>
  `geo.generation.${JSON.stringify([scope.userId, scope.organizationId, scope.teamBindingId, scope.brandId])}`;
const modeSchema = z.enum(["standard", "reference"]);
const formSchema = z.object({
  templateType: z.string().max(32),
  language: z.enum(["zh-CN", "zh-TW", "en-US", "ja-JP"]),
  prompts: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        query_str: z.string().max(2000),
        title_name: z.string().max(500),
      }),
    )
    .max(20),
  tags: z
    .array(
      z.object({
        value: z.string().max(1000),
        label: z.string().max(1000),
        upstream: z.boolean().default(false),
      }),
    )
    .max(20),
  supplement: z.string().max(50000),
  highRefUrl: z.string().max(10000),
});
const submittedSchema = z.object({
  mode: modeSchema,
  form: formSchema,
  input: createArticleJobSchema,
});
const pendingSchema = submittedSchema.extend({
  key: z.string().uuid(),
  editable: z.boolean(),
  previous: z.array(submittedSchema),
});
const draftSchema = z.object({
  activeMode: modeSchema,
  forms: z.object({
    standard: formSchema.optional(),
    reference: formSchema.optional(),
  }),
  pending: pendingSchema.optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type GenerationMode = z.infer<typeof modeSchema>;
export type GenerationForm = z.infer<typeof formSchema>;
export type GenerationSubmission = z.infer<typeof submittedSchema>;
export type PendingGeneration = z.infer<typeof pendingSchema>;
export type GenerationDraft = z.infer<typeof draftSchema>;
export const emptyGenerationForm = (): GenerationForm => ({
  language: "zh-CN",
  templateType: "",
  prompts: [],
  tags: [],
  supplement: "",
  highRefUrl: "",
});
export const emptyGenerationDraft = (): GenerationDraft => ({
  activeMode: "standard",
  forms: {},
  updatedAt: Date.now(),
});
export const hasGenerationInput = (form: GenerationForm) =>
  Boolean(
    form.prompts.length ||
      form.tags.length ||
      form.supplement ||
      form.highRefUrl,
  );
export const generationFormFingerprint = (form: GenerationForm) =>
  JSON.stringify({
    templateType: form.templateType,
    language: form.language,
    promptIds: form.prompts.map((prompt) => prompt.id),
    tags: form.tags,
    supplement: form.supplement,
    highRefUrl: form.highRefUrl,
  });
const lifetime = 86_400_000;
const maxStoredLength = 4_000_000;
const sameScope = (
  scope: GenerationDraftScope,
  input: GenerationSubmission["input"],
) =>
  scope.organizationId === input.organizationId &&
  scope.teamBindingId === input.teamBindingId &&
  scope.brandId === input.brandId;

// @project-doc docs/domains/geo_operations.md#article_jobs
export function readGenerationDraft(
  scope: GenerationDraftScope,
  now = Date.now(),
): GenerationDraft | undefined {
  try {
    const stored = sessionStorage.getItem(generationScopeKey(scope));
    if (!stored) return;
    if (stored.length > maxStoredLength) throw new Error("Draft too large");
    const draft = draftSchema.parse(JSON.parse(stored));
    if (
      draft.updatedAt > now ||
      (!draft.pending && now - draft.updatedAt > lifetime)
    )
      throw new Error("Draft expired");
    if (
      draft.pending &&
      [draft.pending, ...draft.pending.previous].some(
        (entry) => !sameScope(scope, entry.input),
      )
    )
      throw new Error("Draft scope mismatch");
    return draft;
  } catch {
    try {
      sessionStorage.removeItem(generationScopeKey(scope));
    } catch {}
  }
}
export function writeGenerationDraft(
  scope: GenerationDraftScope,
  draft: GenerationDraft,
): boolean {
  try {
    const stored = JSON.stringify(draft);
    if (stored.length > maxStoredLength) return false;
    sessionStorage.setItem(generationScopeKey(scope), stored);
    return true;
  } catch {
    return false;
  }
}

export function startGenerationSubmission(
  draft: GenerationDraft,
  submission: GenerationSubmission,
  generateKey: () => string = () => crypto.randomUUID(),
): GenerationDraft {
  if (draft.pending && !draft.pending.editable) return draft;
  const previous = draft.pending
    ? [
        ...draft.pending.previous,
        {
          mode: draft.pending.mode,
          form: draft.pending.form,
          input: draft.pending.input,
        },
      ]
    : [];
  return {
    ...draft,
    pending: {
      ...submission,
      input: createArticleJobSchema.parse(submission.input),
      key: draft.pending?.key ?? generateKey(),
      editable: false,
      previous: previous.filter(
        (entry, index) =>
          previous.findIndex(
            (other) =>
              JSON.stringify(other.input) === JSON.stringify(entry.input),
          ) === index,
      ),
    },
    updatedAt: Date.now(),
  };
}
export function finishGenerationSubmission(
  draft: GenerationDraft,
  submitted: GenerationSubmission,
  keepForm = false,
): { draft: GenerationDraft; keepEditing: boolean } {
  const saved = draft.forms[submitted.mode] ?? emptyGenerationForm();
  const changed =
    generationFormFingerprint(saved) !==
    generationFormFingerprint(submitted.form);
  return {
    draft: {
      ...draft,
      pending: undefined,
      forms: {
        ...draft.forms,
        [submitted.mode]: keepForm || changed ? saved : emptyGenerationForm(),
      },
      updatedAt: Date.now(),
    },
    keepEditing: keepForm || changed || draft.activeMode !== submitted.mode,
  };
}
export const editableGenerationErrors = new Set([
  "VALIDATION_ERROR",
  "ARTICLE_TEMPLATE_UNAVAILABLE",
  "ARTICLE_REFERENCE_REQUIRED",
  "ARTICLE_REFERENCE_NOT_ALLOWED",
  "FEATURE_PRICE_CHANGED",
]);

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  idempotencyKeySchema,
  articleLanguageSchema,
  traceArticleSchema,
  type TraceArticleInput,
} from "@geo/contracts";
import {
  generationScopeKey,
  type GenerationDraftScope,
} from "./generation-draft";

const formSchema = z.object({
  title: z.string().max(500),
  urls: z.string().max(50000),
  language: articleLanguageSchema,
  tags: z.array(z.string().max(128)).max(50),
});
type Form = z.infer<typeof formSchema>;
const attemptSchema = z.object({ input: traceArticleSchema, form: formSchema });
const storedSchema = z.object({
  form: formSchema,
  updatedAt: z.number().nonnegative(),
  pending: attemptSchema
    .extend({
      key: idempotencyKeySchema,
      editable: z.boolean(),
      previous: z.array(attemptSchema),
    })
    .optional(),
});
type Draft = z.infer<typeof storedSchema>;
type Pending = NonNullable<Draft["pending"]>;
const blank = (): Draft => ({
  form: { title: "", urls: "", language: "zh-CN", tags: [] },
  updatedAt: Date.now(),
});
const identity = (input: TraceArticleInput) =>
  JSON.stringify({ ...input, expectedPoints: undefined });

// @project-doc docs/domains/geo_operations.md#article_tracking
export function useTrackingDraft(
  scope: GenerationDraftScope,
  canWrite: boolean,
) {
  const scopeKey = generationScopeKey(scope).replace(
    "geo.generation.",
    "geo.tracking.",
  );
  const usable = Boolean(
    canWrite && scope.organizationId && scope.teamBindingId && scope.brandId,
  );
  const current = useRef<{ key: string; draft: Draft } | undefined>(undefined);
  const [entry, setEntry] = useState<{ key: string; draft: Draft }>();
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    if (!usable) {
      current.current = undefined;
      setEntry(undefined);
      return;
    }
    let draft = blank();
    try {
      const stored = sessionStorage.getItem(scopeKey);
      if (stored) {
        if (stored.length > 4_000_000) throw new Error("Draft too large");
        const parsed = storedSchema.parse(JSON.parse(stored));
        const [, organizationId, teamBindingId, brandId] = JSON.parse(
          scopeKey.slice("geo.tracking.".length),
        );
        if (
          parsed.pending &&
          [parsed.pending, ...parsed.pending.previous].some(
            ({ input }) =>
              input.organizationId !== organizationId ||
              input.teamBindingId !== teamBindingId ||
              input.brandId !== brandId,
          )
        )
          throw new Error("Scope mismatch");
        if (
          parsed.updatedAt > Date.now() ||
          (!parsed.pending && Date.now() - parsed.updatedAt > 86_400_000)
        )
          throw new Error("Draft expired");
        draft = parsed;
      }
    } catch {
      try {
        sessionStorage.removeItem(scopeKey);
      } catch {}
    }
    current.current = { key: scopeKey, draft };
    setEntry({ key: scopeKey, draft });
    setStorageFailed(false);
  }, [scopeKey, usable]);
  const update = useCallback(
    (change: (draft: Draft) => Draft) => {
      const active = current.current;
      if (!active || active.key !== scopeKey || !usable) return;
      const draft = { ...change(active.draft), updatedAt: Date.now() };
      active.draft = draft;
      setEntry({ key: scopeKey, draft });
      try {
        const stored = JSON.stringify(draft);
        if (stored.length > 4_000_000) throw new Error("Draft too large");
        sessionStorage.setItem(scopeKey, stored);
        setStorageFailed(false);
      } catch {
        setStorageFailed(true);
      }
      return draft;
    },
    [scopeKey, usable],
  );
  const draft = entry?.key === scopeKey && usable ? entry.draft : blank();
  const dirty = Boolean(
    draft.pending ||
      draft.form.title ||
      draft.form.urls ||
      draft.form.tags.length,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const patch = useCallback(
    (change: Partial<Form>) =>
      update((draft) => ({ ...draft, form: { ...draft.form, ...change } })),
    [update],
  );
  const begin = (input: TraceArticleInput) =>
    update((draft) => {
      if (draft.pending && !draft.pending.editable) return draft;
      const previous = draft.pending
        ? [
            ...draft.pending.previous,
            { input: draft.pending.input, form: draft.pending.form },
          ]
        : [];
      return {
        ...draft,
        pending: {
          input,
          form: draft.form,
          key: draft.pending?.key ?? crypto.randomUUID(),
          editable: false,
          previous: previous.filter(
            (attempt, index) =>
              previous.findIndex(
                (other) => identity(other.input) === identity(attempt.input),
              ) === index,
          ),
        },
      };
    })?.pending;
  const finish = (attempt: Pending) => {
    let changed = true;
    update((draft) => {
      if (draft.pending?.key !== attempt.key) return draft;
      changed = JSON.stringify(draft.form) !== JSON.stringify(attempt.form);
      return {
        ...draft,
        pending: undefined,
        form: changed ? draft.form : blank().form,
      };
    });
    return changed;
  };
  return {
    ...draft,
    ready: entry?.key === scopeKey && usable,
    storageFailed,
    patch,
    begin,
    finish,
    allowCorrection: (key: string) =>
      update((draft) => ({
        ...draft,
        pending:
          draft.pending?.key === key
            ? { ...draft.pending, editable: true }
            : draft.pending,
      })),
    release: () => update((draft) => ({ ...draft, pending: undefined })),
    resume: (key: string, input: TraceArticleInput) =>
      update((draft) => ({
        ...draft,
        form:
          draft.form.title || draft.form.urls || draft.form.tags.length
            ? draft.form
            : {
                title: input.title,
                urls: input.urls.join("\n"),
                language: input.language,
                tags: input.tagIds,
              },
        pending: {
          key,
          input,
          form: {
            title: input.title,
            urls: input.urls.join("\n"),
            language: input.language,
            tags: input.tagIds,
          },
          editable: false,
          previous: [],
        },
      })),
  };
}

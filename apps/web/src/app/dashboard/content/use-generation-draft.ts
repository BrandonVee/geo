"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyGenerationDraft,
  emptyGenerationForm,
  finishGenerationSubmission,
  generationScopeKey,
  readGenerationDraft,
  startGenerationSubmission,
  writeGenerationDraft,
  type GenerationDraft,
  type GenerationDraftScope,
  type GenerationForm,
  type GenerationMode,
  type GenerationSubmission,
} from "./generation-draft";

export function useGenerationDraft(
  scope: GenerationDraftScope,
  canWrite: boolean,
) {
  const { userId, organizationId, teamBindingId, brandId } = scope;
  const storedScope = useMemo(
    () => ({ userId, organizationId, teamBindingId, brandId }),
    [userId, organizationId, teamBindingId, brandId],
  );
  const key = generationScopeKey(storedScope);
  const usable = Boolean(
    canWrite && scope.organizationId && scope.teamBindingId && scope.brandId,
  );
  const current = useRef<
    | {
        key: string;
        scope: GenerationDraftScope;
        draft: GenerationDraft;
      }
    | undefined
  >(undefined);
  const [entry, setEntry] = useState<{ key: string; draft: GenerationDraft }>();
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    if (!usable) {
      current.current = undefined;
      setEntry(undefined);
      return;
    }
    const draft = readGenerationDraft(storedScope) ?? emptyGenerationDraft();
    current.current = { key, scope: storedScope, draft };
    setEntry({ key, draft });
    setStorageFailed(false);
  }, [key, usable, storedScope]);
  const update = useCallback(
    (change: (draft: GenerationDraft) => GenerationDraft) => {
      const active = current.current;
      if (!active || active.key !== key || !usable) return;
      const draft = { ...change(active.draft), updatedAt: Date.now() };
      active.draft = draft;
      setStorageFailed(!writeGenerationDraft(active.scope, draft));
      setEntry({ key, draft });
      return draft;
    },
    [key, usable],
  );
  const patchForm = useCallback(
    (changes: Partial<GenerationForm>) =>
      update((draft) => ({
        ...draft,
        forms: {
          ...draft.forms,
          [draft.activeMode]: {
            ...(draft.forms[draft.activeMode] ?? emptyGenerationForm()),
            ...changes,
          },
        },
      })),
    [update],
  );
  const addPrompt = useCallback(
    (prompt: GenerationForm["prompts"][number]) =>
      update((draft) => {
        const form = draft.forms[draft.activeMode] ?? emptyGenerationForm();
        return {
          ...draft,
          forms: {
            ...draft.forms,
            [draft.activeMode]: {
              ...form,
              prompts: form.prompts.some((item) => item.id === prompt.id)
                ? form.prompts
                : [...form.prompts, prompt].slice(0, 20),
            },
          },
        };
      }),
    [update],
  );
  const switchMode = useCallback(
    (mode: GenerationMode) =>
      update((draft) => {
        const previous = draft.forms[draft.activeMode] ?? emptyGenerationForm();
        return {
          ...draft,
          activeMode: mode,
          forms: {
            ...draft.forms,
            [mode]: draft.forms[mode] ?? {
              ...previous,
              templateType: "",
              highRefUrl: "",
            },
          },
        };
      }),
    [update],
  );
  const begin = useCallback(
    (submission: GenerationSubmission) =>
      update((draft) => startGenerationSubmission(draft, submission))?.pending,
    [update],
  );
  const finish = useCallback(
    (submission: GenerationSubmission & { key: string }, keepForm = false) => {
      let keepEditing = true;
      update((draft) => {
        if (draft.pending?.key !== submission.key) return draft;
        const result = finishGenerationSubmission(draft, submission, keepForm);
        keepEditing = result.keepEditing;
        return result.draft;
      });
      return keepEditing;
    },
    [update],
  );
  const allowCorrection = useCallback(
    (submissionKey: string) =>
      update((draft) => ({
        ...draft,
        pending:
          draft.pending?.key === submissionKey
            ? { ...draft.pending, editable: true }
            : draft.pending,
      })),
    [update],
  );
  const draft =
    entry?.key === key && usable ? entry.draft : emptyGenerationDraft();
  return {
    ready: entry?.key === key && usable,
    draft,
    form: draft.forms[draft.activeMode] ?? emptyGenerationForm(),
    storageFailed,
    patchForm,
    addPrompt,
    switchMode,
    begin,
    finish,
    allowCorrection,
    clearForm: () => {
      if (!draft.pending) patchForm(emptyGenerationForm());
    },
  };
}

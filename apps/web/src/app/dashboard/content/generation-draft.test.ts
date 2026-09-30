import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArticleJobSchema } from "@geo/contracts";
import {
  emptyGenerationForm,
  finishGenerationSubmission,
  generationScopeKey,
  readGenerationDraft,
  startGenerationSubmission,
  writeGenerationDraft,
  type GenerationDraft,
  type GenerationSubmission,
} from "./generation-draft";

const scope = {
  userId: "user-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  teamBindingId: "22222222-2222-4222-8222-222222222222",
  brandId: "brand-1",
};
const key = "33333333-3333-4333-8333-333333333333";
const form = {
  ...emptyGenerationForm(),
  templateType: "1",
  supplement: "最初素材",
  prompts: [{ id: "prompt-1", query_str: "原问题", title_name: "产品" }],
  tags: [{ value: "tag-1", label: "品牌故事", upstream: true }],
};
const submission: GenerationSubmission = {
  mode: "standard",
  form,
  input: createArticleJobSchema.parse({
    organizationId: scope.organizationId,
    teamBindingId: scope.teamBindingId,
    brandId: scope.brandId,
    expectedPoints: 3,
    templateType: 1,
    promptIds: ["prompt-1"],
    supplementalKnowledge: "最初素材",
    tagIds: ["tag-1"],
    contentTags: ["品牌故事"],
  }),
};
const draft: GenerationDraft = {
  activeMode: "standard",
  forms: { standard: form },
  updatedAt: 1000,
};
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("文章生成草稿与待确认提交", () => {
  it("按用户、企业、内部绑定和品牌隔离，保留问题及标签显示名", () => {
    expect(writeGenerationDraft(scope, draft)).toBe(true);
    expect(readGenerationDraft(scope, 1000)).toEqual(draft);
    for (const changed of [
      { userId: "other" },
      { organizationId: "other" },
      { teamBindingId: "other" },
      { brandId: "other" },
    ])
      expect(
        readGenerationDraft({ ...scope, ...changed }, 1000),
      ).toBeUndefined();
  });
  it("普通草稿 24 小时过期；未确认请求不因到期丢失提交键", () => {
    writeGenerationDraft(scope, draft);
    expect(readGenerationDraft(scope, 1000 + 86_400_001)).toBeUndefined();
    const pending = {
      ...startGenerationSubmission(draft, submission, () => key),
      updatedAt: 1000,
    };
    writeGenerationDraft(scope, pending);
    expect(readGenerationDraft(scope, 1000 + 86_400_001)?.pending?.key).toBe(
      key,
    );
  });
  it("刷新后修改表单或报价，不改变原待确认请求", () => {
    const pending = startGenerationSubmission(draft, submission, () => key);
    const edited = {
      ...pending,
      forms: { standard: { ...form, supplement: "后续输入" } },
    };
    writeGenerationDraft(scope, edited);
    const restored = readGenerationDraft(scope)!;
    const tried = startGenerationSubmission(
      restored,
      {
        ...submission,
        form: edited.forms.standard,
        input: {
          ...submission.input,
          expectedPoints: 50,
          supplementalKnowledge: "后续输入",
        },
      },
      () => "new-key",
    );
    expect(tried.pending?.key).toBe(key);
    expect(tried.pending?.input).toEqual(submission.input);
    expect(tried.forms.standard?.supplement).toBe("后续输入");
  });
  it("明确错误后的修正沿用原键，并保留可确认的原请求", () => {
    const pending = startGenerationSubmission(draft, submission, () => key);
    const corrected = startGenerationSubmission(
      { ...pending, pending: { ...pending.pending!, editable: true } },
      {
        ...submission,
        input: { ...submission.input, templateType: 2 },
        form: { ...form, templateType: "2" },
      },
      () => "must-not-rotate",
    );
    expect(corrected.pending?.key).toBe(key);
    expect(corrected.pending?.input.templateType).toBe(2);
    expect(corrected.pending?.previous[0].input).toEqual(submission.input);
    writeGenerationDraft(scope, corrected);
    expect(readGenerationDraft(scope)?.pending).toEqual(corrected.pending);
  });
  it("确认响应只清除已提交且未修改的草稿，保留另一生成方式", () => {
    const reference = {
      ...form,
      templateType: "2",
      highRefUrl: "https://example.com/reference",
    };
    const pending = startGenerationSubmission(
      { ...draft, forms: { standard: form, reference } },
      submission,
      () => key,
    );
    const result = finishGenerationSubmission(pending, submission);
    expect(result.keepEditing).toBe(false);
    expect(result.draft.pending).toBeUndefined();
    expect(result.draft.forms.standard?.supplement).toBe("");
    expect(result.draft.forms.reference).toEqual(reference);
  });
  it("确认后保留后续编辑或另一方式；失败任务保留原输入供再次提交", () => {
    const pending = startGenerationSubmission(draft, submission, () => key);
    const edited = {
      ...pending,
      forms: { standard: { ...form, supplement: "后续素材" } },
    };
    const confirmed = finishGenerationSubmission(edited, submission);
    expect(confirmed.keepEditing).toBe(true);
    expect(confirmed.draft.forms.standard?.supplement).toBe("后续素材");
    expect(
      finishGenerationSubmission(
        { ...pending, activeMode: "reference" },
        submission,
      ).keepEditing,
    ).toBe(true);
    const failed = finishGenerationSubmission(pending, submission, true);
    expect(failed.draft.forms.standard).toEqual(form);
    expect(
      startGenerationSubmission(
        failed.draft,
        submission,
        () => "44444444-4444-4444-8444-444444444444",
      ).pending?.key,
    ).not.toBe(key);
  });
  it("范围不符、未来时间和损坏内容不作为可恢复请求", () => {
    const pending = startGenerationSubmission(draft, submission, () => key);
    writeGenerationDraft(scope, {
      ...pending,
      pending: {
        ...pending.pending!,
        input: { ...submission.input, brandId: "other" },
      },
    });
    expect(readGenerationDraft(scope)).toBeUndefined();
    writeGenerationDraft(scope, { ...draft, updatedAt: 1001 });
    expect(readGenerationDraft(scope, 1000)).toBeUndefined();
    storage.set(generationScopeKey(scope), "broken-json");
    expect(readGenerationDraft(scope)).toBeUndefined();
  });
  it("存储被禁用时仍保留内存中的原请求，不产生新键", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    expect(readGenerationDraft(scope)).toBeUndefined();
    const pending = startGenerationSubmission(draft, submission, () => key);
    expect(writeGenerationDraft(scope, pending)).toBe(false);
    expect(
      startGenerationSubmission(pending, submission, () => "other").pending
        ?.key,
    ).toBe(key);
  });
});
